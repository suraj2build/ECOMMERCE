import type { FastifyInstance } from 'fastify';
import { Prisma, type PrismaClient, type PickTaskStatus, type PickExceptionType } from '@fcp/db';
import { NotFoundError, ValidationError, ConflictError } from '@fcp/shared';
import { InventoryService } from '../inventory/service.js';
import { recordAudit } from '../audit/service.js';

export interface PickTaskLineSnapshot {
  id: string;
  skuId: string;
  locationId: string;
  quantity: number;
}

export interface RecordPickOutcomeParams {
  pickTaskId: string;
  staffId: string;
  idempotencyKey: string;
  outcome: 'FULL' | 'SHORT' | 'EXCEPTION';
  pickedQuantity?: number;
  exceptionType?: PickExceptionType;
  exceptionReason?: string;
  coApproverStaffId?: string;
}

/**
 * Warehouse / Fulfilment - Picking (M16, specs/15-warehouse-fulfilment.md,
 * WH-001/002).
 *
 * Scope: this service owns the pick-task lifecycle only - the actionable
 * unit of "obtain work from an allocated OrderLine" the M16 build
 * instruction requires. Packing itself (grouping picked lines into an
 * OrderFulfilment/package, and the PACKED -> READY_TO_SHIP -> SHIPPED
 * chain) remains OrderService's responsibility (M15's existing
 * assignLinesToFulfilment/markFulfilmentPacked/markFulfilmentShipped,
 * extended in M16 to gate on PICKED/READY_TO_SHIP) - OrderService already
 * owns OrderFulfilment and the ledger SALE posting at ship time, and this
 * service does not duplicate that ownership (DO NOT create a second
 * inventory or fulfilment truth).
 *
 * Concurrency: every mutating operation row-locks the PickTask (SELECT ...
 * FOR UPDATE, the same idiom InventoryService.lockReservation/lockBalance
 * already use) inside one transaction, so two pickers racing the same
 * task genuinely serialize on the database rather than both reading
 * PENDING before either commits.
 */
export class WarehouseService {
  private readonly inventory: InventoryService;

  constructor(private readonly fastify: FastifyInstance) {
    this.inventory = new InventoryService(fastify);
  }

  private get prisma(): PrismaClient {
    return this.fastify.prisma;
  }

  /**
   * Creates one PENDING PickTask per order line, inside the SAME
   * transaction as the OrderLine rows themselves (called by
   * OrderService.createOrderFromCheckoutSession) - "warehouse work
   * creation" happens the instant a line becomes ALLOCATED, never a
   * separate, forgettable manual step.
   */
  async createPickTasksForOrder(tx: Prisma.TransactionClient, orderId: string, lines: PickTaskLineSnapshot[]): Promise<void> {
    if (lines.length === 0) return;
    await tx.pickTask.createMany({
      data: lines.map((line) => ({
        orderId,
        orderLineId: line.id,
        skuId: line.skuId,
        locationId: line.locationId,
        allocatedQuantity: line.quantity,
      })),
    });
  }

  /**
   * Row-locks and returns one PickTask by id, MUST run inside a
   * transaction - see the class docblock on concurrency.
   */
  private async lockPickTask(
    tx: Prisma.TransactionClient,
    pickTaskId: string,
  ): Promise<{
    id: string;
    orderId: string;
    orderLineId: string;
    skuId: string;
    locationId: string;
    allocatedQuantity: number;
    pickedQuantity: number;
    status: PickTaskStatus;
    idempotencyKey: string | null;
  } | null> {
    const rows = await tx.$queryRaw<
      {
        id: string;
        orderId: string;
        orderLineId: string;
        skuId: string;
        locationId: string;
        allocatedQuantity: number;
        pickedQuantity: number;
        status: PickTaskStatus;
        idempotencyKey: string | null;
      }[]
    >`SELECT "id", "orderId", "orderLineId", "skuId", "locationId", "allocatedQuantity", "pickedQuantity", "status", "idempotencyKey"
      FROM "pick_tasks"
      WHERE "id" = ${pickTaskId}
      FOR UPDATE`;
    return rows[0] ?? null;
  }

  async getPickTask(id: string) {
    const task = await this.prisma.pickTask.findUnique({
      where: { id },
      include: { sku: { include: { style: true, colour: true, size: true } }, location: true, order: true },
    });
    if (!task) throw new NotFoundError('PickTask', id);
    return this.toView(task);
  }

  /**
   * Bounded, paginated queue listing (M16 §18 - "prevent obvious N+1/
   * unbounded queries; use pagination/bounded work queues"). Never
   * returns the full table regardless of how many orders exist.
   */
  async listPickTasks(query: { status?: PickTaskStatus; locationId?: string; orderId?: string; take?: number; skip?: number }) {
    const where = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.locationId ? { locationId: query.locationId } : {}),
      ...(query.orderId ? { orderId: query.orderId } : {}),
    };
    const take = Math.min(query.take ?? 50, 200);
    const [items, total] = await Promise.all([
      this.prisma.pickTask.findMany({
        where,
        include: { sku: { include: { style: true, colour: true, size: true } }, location: true },
        orderBy: { createdAt: 'asc' },
        take,
        skip: query.skip ?? 0,
      }),
      this.prisma.pickTask.count({ where }),
    ]);
    return { items: items.map((t) => this.toView(t)), total };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private toView(task: any) {
    return {
      id: task.id,
      orderId: task.orderId,
      orderLineId: task.orderLineId,
      skuId: task.skuId,
      styleName: task.sku?.style?.name,
      colourName: task.sku?.colour?.name,
      sizeLabel: task.sku?.size?.label,
      locationId: task.locationId,
      locationCode: task.location?.code,
      allocatedQuantity: task.allocatedQuantity,
      pickedQuantity: task.pickedQuantity,
      status: task.status,
      exceptionType: task.exceptionType,
      exceptionReason: task.exceptionReason,
      pickedByStaffId: task.pickedByStaffId,
      pickedAt: task.pickedAt,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
    };
  }

  /**
   * Records the outcome of one pick attempt. Idempotent (same
   * idempotencyKey against an already-terminal task is a safe replay of
   * the SAME response, never a re-execution); concurrency-safe (row lock
   * ensures two simultaneous pickers on the same task serialize, and only
   * one can win the PENDING -> terminal transition).
   *
   * FULL: pickedQuantity === allocatedQuantity -> PICKED, OrderLine ->
   *   PICKED (now eligible for OrderService.assignLinesToFulfilment).
   * SHORT: 0 < pickedQuantity < allocatedQuantity -> SHORT_PICKED, and
   *   (per specs/15-warehouse-fulfilment.md: "a pick exception MUST post
   *   an authorized/audited inventory adjustment and trigger the order-
   *   exception path") posts a negative ADJUSTMENT for the shortfall and
   *   flags the OrderLine EXCEPTION - Warehouse Manager/CS then resolve it
   *   via OrderService.resolveException (REINSTATE resets this same
   *   PickTask back to PENDING for a fresh pick attempt, e.g. after
   *   replenishment; CANCEL releases the allocation).
   * EXCEPTION: could not pick at all (stock not found / wrong SKU found /
   *   damaged / other) -> EXCEPTION, posts a negative ADJUSTMENT for the
   *   full allocatedQuantity (none of the correct SKU is physically
   *   available - never guesses at a partial figure) and flags the
   *   OrderLine EXCEPTION the same way.
   *
   * "Never silently substitute another SKU, colour or size": a picker who
   * finds a different item reports WRONG_SKU_FOUND against THIS task (the
   * requested SKU) - the system never auto-credits or auto-picks the
   * item actually found; that would require its own, separately-scanned
   * pick against its own order line, which this method does not fabricate.
   */
  async recordPickOutcome(params: RecordPickOutcomeParams) {
    // Prisma's $transaction callback rolls back EVERY statement it ran
    // the instant it throws - so the "line was cancelled out from under
    // this task" branch below cannot both durably mark the task CANCELLED
    // AND throw an error from inside the same transaction (a real bug
    // caught by this file's own adversarial test: the cancellation update
    // was silently rolled back, leaving the task stuck PENDING forever).
    // The transaction instead returns a typed outcome; the actual
    // rejection is thrown AFTER it commits, once the CANCELLED state is
    // durably persisted.
    const result = await this.prisma.$transaction(async (tx) => {
      const task = await this.lockPickTask(tx, params.pickTaskId);
      if (!task) throw new NotFoundError('PickTask', params.pickTaskId);

      if (task.status !== 'PENDING') {
        // A true retry of the same logical request is a safe no-op -
        // same idempotency-key discipline as every other mutating
        // operation in this codebase (InventoryService.reserve,
        // PaymentService.recordOrResumeEvent, InvoiceService credit
        // notes). A DIFFERENT key against an already-terminal task is a
        // genuine conflict: either a second, distinct picker racing in
        // (concurrent-picker scenario) or a client bug - never silently
        // re-applied.
        if (task.idempotencyKey && task.idempotencyKey === params.idempotencyKey) {
          return { kind: 'ok' as const, view: await this.getPickTaskInTx(tx, task.id) };
        }
        throw new ConflictError(
          `Pick task '${params.pickTaskId}' has already been processed (status '${task.status}') - it cannot be picked again`,
        );
      }

      // Re-verify against the live OrderLine - a line can be cancelled by
      // a staff/CS action between task creation and this pick attempt
      // (the "pick cancelled line" adversarial scenario).
      const line = await tx.orderLine.findUniqueOrThrow({ where: { id: task.orderLineId } });
      if (line.status === 'CANCELLED') {
        await tx.pickTask.update({
          where: { id: task.id },
          data: { status: 'CANCELLED', idempotencyKey: params.idempotencyKey },
        });
        await recordAudit(tx, {
          actorType: 'STAFF',
          actorStaffId: params.staffId,
          action: 'warehouse.pick.blocked_cancelled_line',
          entityType: 'PickTask',
          entityId: task.id,
          reference: task.orderId,
        });
        return { kind: 'line_cancelled' as const, orderLineId: task.orderLineId };
      }
      if (line.status !== 'ALLOCATED') {
        throw new ValidationError(
          `Order line '${task.orderLineId}' is not eligible for picking (status '${line.status}')`,
        );
      }

      let status: PickTaskStatus;
      let pickedQuantity = 0;
      let shortfall = 0;
      let exceptionType: PickExceptionType | null = null;

      if (params.outcome === 'EXCEPTION') {
        if (!params.exceptionType) throw new ValidationError('exceptionType is required for an EXCEPTION outcome');
        if (!params.exceptionReason?.trim()) throw new ValidationError('exceptionReason is required for an EXCEPTION outcome');
        status = 'EXCEPTION';
        exceptionType = params.exceptionType;
        shortfall = task.allocatedQuantity;
      } else {
        const qty = params.pickedQuantity;
        if (qty === undefined || !Number.isInteger(qty) || qty <= 0) {
          throw new ValidationError('pickedQuantity must be a positive integer');
        }
        if (qty > task.allocatedQuantity) {
          throw new ValidationError(
            `Cannot pick ${qty} units for order line '${task.orderLineId}' - only ${task.allocatedQuantity} were allocated`,
          );
        }
        pickedQuantity = qty;
        if (qty === task.allocatedQuantity) {
          status = 'PICKED';
        } else {
          status = 'SHORT_PICKED';
          shortfall = task.allocatedQuantity - qty;
          exceptionType = params.exceptionType ?? 'INSUFFICIENT_STOCK';
        }
      }

      const updated = await tx.pickTask.update({
        where: { id: task.id },
        data: {
          status,
          pickedQuantity,
          exceptionType,
          exceptionReason: params.exceptionReason,
          pickedByStaffId: params.staffId,
          pickedAt: new Date(),
          idempotencyKey: params.idempotencyKey,
        },
      });

      if (status === 'PICKED') {
        await tx.orderLine.update({ where: { id: task.orderLineId }, data: { status: 'PICKED' } });
      } else {
        // SHORT_PICKED or EXCEPTION - route to the order-exception path
        // and post the authorized/audited inventory adjustment for the
        // shortfall (specs/15-warehouse-fulfilment.md, binding).
        const reasonPrefix = status === 'SHORT_PICKED' ? 'Pick shortfall' : `Pick exception (${exceptionType})`;
        const fullReason = params.exceptionReason
          ? `${reasonPrefix}: ${params.exceptionReason}`
          : `${reasonPrefix}: picked ${pickedQuantity}/${task.allocatedQuantity}`;

        await tx.orderLine.update({
          where: { id: task.orderLineId },
          data: { status: 'EXCEPTION', exceptionReason: fullReason },
        });

        await this.inventory.postAdjustment(
          {
            skuId: task.skuId,
            locationId: task.locationId,
            quantityDelta: -shortfall,
            reason: `${reasonPrefix} on pick task '${task.id}' (order line '${task.orderLineId}')`,
            actorStaffId: params.staffId,
            coApproverStaffId: params.coApproverStaffId,
          },
          tx,
        );

        await this.recomputeOrderStatusToException(tx, task.orderId);
      }

      await recordAudit(tx, {
        actorType: 'STAFF',
        actorStaffId: params.staffId,
        action: 'warehouse.pick.record',
        entityType: 'PickTask',
        entityId: task.id,
        newValue: { status, pickedQuantity, exceptionType, allocatedQuantity: task.allocatedQuantity },
        reference: task.orderId,
      });

      return { kind: 'ok' as const, view: this.toView({ ...updated, sku: undefined, location: undefined }) };
    });

    if (result.kind === 'line_cancelled') {
      throw new ValidationError(
        `Order line '${result.orderLineId}' was cancelled - this pick task has been cancelled and cannot be picked`,
      );
    }
    return result.view;
  }

  private async getPickTaskInTx(tx: Prisma.TransactionClient, id: string) {
    const task = await tx.pickTask.findUniqueOrThrow({ where: { id } });
    return this.toView({ ...task, sku: undefined, location: undefined });
  }

  /**
   * A pick shortfall/exception is itself an order exception
   * (specs/15-warehouse-fulfilment.md) - reuses the exact same coarse
   * order-level EXCEPTION status OrderService.flagException already
   * produces, without importing OrderService (avoiding a circular
   * dependency: OrderService imports WarehouseService to create pick
   * tasks). Mirrors OrderService.computeOrderStatus's own "any EXCEPTION
   * line wins" precedence rule exactly.
   */
  private async recomputeOrderStatusToException(tx: Prisma.TransactionClient, orderId: string): Promise<void> {
    const order = await tx.order.findUniqueOrThrow({ where: { id: orderId } });
    if (order.status === 'RTO' || order.status === 'EXCEPTION') return;
    await tx.order.update({ where: { id: orderId }, data: { status: 'EXCEPTION' } });
  }
}
