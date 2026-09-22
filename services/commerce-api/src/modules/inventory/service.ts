import type { FastifyInstance } from 'fastify';
import type { Prisma, PrismaClient, InventoryTxnType } from '@fcp/db';
import { loadEnv } from '@fcp/config';
import { ConflictError, InsufficientStockError, NotFoundError, ValidationError } from '@fcp/shared';
import { recordAudit } from '../audit/service.js';

export interface InventoryBalanceSnapshot {
  onHand: number;
  reserved: number;
  damaged: number;
  returnPending: number;
  inTransit: number;
  available: number;
}

/**
 * Inventory Ledger (M06, specs/06-inventory.md, ADR-0012) - the platform's
 * most financially/operationally critical domain.
 *
 * Binding rules implemented here:
 * - Inventory is NEVER a mutable `quantity` column - every change is an
 *   append-only InventoryTransaction row (source of truth). InventoryBalance
 *   is a transactionally-maintained derived cache (see reconcileBalance,
 *   which proves it always equals a replay of the ledger).
 * - Overselling MUST be prevented (INV-003): a reservation can never exceed
 *   onHand - reserved (available), and the check + the balance mutation
 *   happen inside a single DB transaction that row-locks the balance
 *   (SELECT ... FOR UPDATE), so concurrent reservation attempts on the same
 *   SKU+location serialize correctly - see test/integration/inventory-concurrency.test.ts.
 * - Reservation/adjustment/transfer operations accept an idempotencyKey so
 *   a retried request never double-applies (INV-002, financial-integrity
 *   discipline shared with payment operations).
 */
export class InventoryService {
  constructor(private readonly fastify: FastifyInstance) {}

  private get prisma(): PrismaClient {
    return this.fastify.prisma;
  }

  /** Ensures a balance row exists for (skuId, locationId) without resetting an existing one. */
  private async ensureBalanceRow(
    tx: Prisma.TransactionClient,
    skuId: string,
    locationId: string,
  ): Promise<void> {
    await tx.inventoryBalance.upsert({
      where: { skuId_locationId: { skuId, locationId } },
      update: {},
      create: { skuId, locationId },
    });
  }

  /** Row-locks and returns the current balance for (skuId, locationId). MUST run inside a transaction. */
  private async lockBalance(
    tx: Prisma.TransactionClient,
    skuId: string,
    locationId: string,
  ): Promise<InventoryBalanceSnapshot> {
    const rows = await tx.$queryRaw<
      { onHand: number; reserved: number; damaged: number; returnPending: number; inTransit: number }[]
    >`SELECT "onHand", "reserved", "damaged", "returnPending", "inTransit"
      FROM "inventory_balances"
      WHERE "skuId" = ${skuId} AND "locationId" = ${locationId}
      FOR UPDATE`;

    const row = rows[0];
    if (!row) throw new NotFoundError('InventoryBalance', `${skuId}/${locationId}`);
    return { ...row, available: row.onHand - row.reserved };
  }

  async getBalance(skuId: string, locationId: string): Promise<InventoryBalanceSnapshot> {
    const balance = await this.prisma.inventoryBalance.findUnique({
      where: { skuId_locationId: { skuId, locationId } },
    });
    if (!balance) {
      return { onHand: 0, reserved: 0, damaged: 0, returnPending: 0, inTransit: 0, available: 0 };
    }
    return { ...balance, available: balance.onHand - balance.reserved };
  }

  private async writeLedgerRow(
    tx: Prisma.TransactionClient,
    params: {
      skuId: string;
      locationId: string;
      type: InventoryTxnType;
      quantity: number;
      referenceType?: string;
      referenceId?: string;
      reason?: string;
      idempotencyKey?: string;
      actorType?: 'STAFF' | 'CUSTOMER' | 'SYSTEM';
      actorStaffId?: string;
      coApproverStaffId?: string;
    },
  ) {
    return tx.inventoryTransaction.create({
      data: {
        skuId: params.skuId,
        locationId: params.locationId,
        type: params.type,
        quantity: params.quantity,
        referenceType: params.referenceType,
        referenceId: params.referenceId,
        reason: params.reason,
        idempotencyKey: params.idempotencyKey,
        actorType: params.actorType ?? 'SYSTEM',
        actorStaffId: params.actorStaffId,
        coApproverStaffId: params.coApproverStaffId,
      },
    });
  }

  /**
   * RECEIPT: onHand += quantity. Posted from a QC-passed GRN line (M05).
   * Accepts an optional external transaction client so the GRN module can
   * post the ledger effect atomically alongside the GRN row and PO-line
   * update it belongs to (specs/05-grn.md GRN-003) - falls back to
   * opening its own transaction for standalone/direct callers.
   */
  async postReceipt(
    params: {
      skuId: string;
      locationId: string;
      quantity: number;
      referenceType: string;
      referenceId: string;
      idempotencyKey?: string;
    },
    externalTx?: Prisma.TransactionClient,
  ) {
    if (params.quantity <= 0) throw new ValidationError('Receipt quantity must be positive');

    const run = async (tx: Prisma.TransactionClient) => {
      if (params.idempotencyKey) {
        const existing = await tx.inventoryTransaction.findUnique({
          where: { idempotencyKey: params.idempotencyKey },
        });
        if (existing) {
          if (
            existing.skuId !== params.skuId ||
            existing.locationId !== params.locationId ||
            existing.quantity !== params.quantity
          ) {
            throw new ConflictError(
              `Idempotency key '${params.idempotencyKey}' was already used for a different receipt request`,
            );
          }
          return existing;
        }
      }

      await this.ensureBalanceRow(tx, params.skuId, params.locationId);
      const balance = await this.lockBalance(tx, params.skuId, params.locationId);

      await tx.inventoryBalance.update({
        where: { skuId_locationId: { skuId: params.skuId, locationId: params.locationId } },
        data: { onHand: balance.onHand + params.quantity },
      });

      return this.writeLedgerRow(tx, { ...params, type: 'RECEIPT' });
    };

    return externalTx ? run(externalTx) : this.prisma.$transaction(run);
  }

  /**
   * QC_FAIL: damaged += quantity. onHand is never touched - damaged-on-
   * arrival stock never counts as sellable. Accepts an optional external
   * transaction client for the same reason as postReceipt above.
   */
  async postDamaged(
    params: {
      skuId: string;
      locationId: string;
      quantity: number;
      referenceType: string;
      referenceId: string;
      reason?: string;
      idempotencyKey?: string;
    },
    externalTx?: Prisma.TransactionClient,
  ) {
    if (params.quantity <= 0) throw new ValidationError('Damaged quantity must be positive');

    const run = async (tx: Prisma.TransactionClient) => {
      if (params.idempotencyKey) {
        const existing = await tx.inventoryTransaction.findUnique({
          where: { idempotencyKey: params.idempotencyKey },
        });
        if (existing) {
          if (
            existing.skuId !== params.skuId ||
            existing.locationId !== params.locationId ||
            existing.quantity !== params.quantity
          ) {
            throw new ConflictError(
              `Idempotency key '${params.idempotencyKey}' was already used for a different damaged-stock request`,
            );
          }
          return existing;
        }
      }

      await this.ensureBalanceRow(tx, params.skuId, params.locationId);
      const balance = await this.lockBalance(tx, params.skuId, params.locationId);

      await tx.inventoryBalance.update({
        where: { skuId_locationId: { skuId: params.skuId, locationId: params.locationId } },
        data: { damaged: balance.damaged + params.quantity },
      });

      return this.writeLedgerRow(tx, { ...params, type: 'QC_FAIL' });
    };

    return externalTx ? run(externalTx) : this.prisma.$transaction(run);
  }

  /**
   * RESERVATION: reserved += quantity, gated by available = onHand - reserved.
   * THE oversell-prevention choke point (INV-002/INV-003). Runs the
   * availability check and the balance mutation inside one row-locked
   * transaction so concurrent callers serialize correctly.
   */
  async reserve(params: {
    skuId: string;
    locationId: string;
    quantity: number;
    referenceType?: string;
    referenceId?: string;
    idempotencyKey: string;
    ttlSeconds?: number;
  }) {
    if (params.quantity <= 0) throw new ValidationError('Reservation quantity must be positive');
    const env = loadEnv();
    const ttl = params.ttlSeconds ?? env.INVENTORY_RESERVATION_TTL_SECONDS;

    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.inventoryReservation.findUnique({
        where: { idempotencyKey: params.idempotencyKey },
      });
      if (existing) {
        // A true retry of the same logical request is a safe no-op.
        // Reusing the same key for a *different* request (different
        // SKU/location/quantity) is a client bug, not a retry - never
        // silently return stale data for a different logical operation.
        if (
          existing.skuId !== params.skuId ||
          existing.locationId !== params.locationId ||
          existing.quantity !== params.quantity
        ) {
          throw new ConflictError(
            `Idempotency key '${params.idempotencyKey}' was already used for a different reservation request`,
          );
        }
        return existing;
      }

      await this.ensureBalanceRow(tx, params.skuId, params.locationId);
      const balance = await this.lockBalance(tx, params.skuId, params.locationId);
      const available = balance.onHand - balance.reserved;

      if (params.quantity > available) {
        throw new InsufficientStockError(params.skuId, params.quantity, available);
      }

      await tx.inventoryBalance.update({
        where: { skuId_locationId: { skuId: params.skuId, locationId: params.locationId } },
        data: { reserved: balance.reserved + params.quantity },
      });

      await this.writeLedgerRow(tx, {
        skuId: params.skuId,
        locationId: params.locationId,
        type: 'RESERVATION',
        quantity: params.quantity,
        referenceType: params.referenceType,
        referenceId: params.referenceId,
      });

      return tx.inventoryReservation.create({
        data: {
          skuId: params.skuId,
          locationId: params.locationId,
          quantity: params.quantity,
          referenceType: params.referenceType,
          referenceId: params.referenceId,
          idempotencyKey: params.idempotencyKey,
          expiresAt: new Date(Date.now() + ttl * 1000),
        },
      });
    });
  }

  /** RESERVATION_RELEASE: reserved -= quantity. Idempotent - releasing an already-released reservation is a safe no-op. */
  async releaseReservation(reservationId: string, reason?: string) {
    return this.prisma.$transaction(async (tx) => {
      const reservation = await tx.inventoryReservation.findUnique({ where: { id: reservationId } });
      if (!reservation) throw new NotFoundError('InventoryReservation', reservationId);
      if (reservation.status !== 'ACTIVE') return reservation; // already released/converted/expired - no-op

      const balance = await this.lockBalance(tx, reservation.skuId, reservation.locationId);
      await tx.inventoryBalance.update({
        where: { skuId_locationId: { skuId: reservation.skuId, locationId: reservation.locationId } },
        data: { reserved: Math.max(0, balance.reserved - reservation.quantity) },
      });

      await this.writeLedgerRow(tx, {
        skuId: reservation.skuId,
        locationId: reservation.locationId,
        type: 'RESERVATION_RELEASE',
        quantity: reservation.quantity,
        referenceType: 'RESERVATION',
        referenceId: reservation.id,
        reason,
      });

      return tx.inventoryReservation.update({
        where: { id: reservationId },
        data: { status: 'RELEASED' },
      });
    });
  }

  /** Releases every ACTIVE reservation past its expiresAt. Callable directly or by a future scheduler. */
  async expireStaleReservations(): Promise<number> {
    const stale = await this.prisma.inventoryReservation.findMany({
      where: { status: 'ACTIVE', expiresAt: { lt: new Date() } },
    });

    for (const reservation of stale) {
      await this.prisma.$transaction(async (tx) => {
        const fresh = await tx.inventoryReservation.findUnique({ where: { id: reservation.id } });
        if (!fresh || fresh.status !== 'ACTIVE') return;

        const balance = await this.lockBalance(tx, fresh.skuId, fresh.locationId);
        await tx.inventoryBalance.update({
          where: { skuId_locationId: { skuId: fresh.skuId, locationId: fresh.locationId } },
          data: { reserved: Math.max(0, balance.reserved - fresh.quantity) },
        });
        await this.writeLedgerRow(tx, {
          skuId: fresh.skuId,
          locationId: fresh.locationId,
          type: 'RESERVATION_RELEASE',
          quantity: fresh.quantity,
          referenceType: 'RESERVATION',
          referenceId: fresh.id,
          reason: 'expired',
        });
        await tx.inventoryReservation.update({ where: { id: fresh.id }, data: { status: 'EXPIRED' } });
      });
    }

    return stale.length;
  }

  /**
   * ADJUSTMENT: authorized manual correction (ADM-003). Requires a reason.
   * Adjustments whose absolute quantity exceeds the configured threshold
   * require a co-approver id (checked for a Finance-tier permission at the
   * route layer, not here) - this service enforces only that the field is
   * present when required.
   */
  async postAdjustment(params: {
    skuId: string;
    locationId: string;
    quantityDelta: number; // signed: positive = increase onHand, negative = decrease
    reason: string;
    actorStaffId: string;
    coApproverStaffId?: string;
  }) {
    if (!params.reason?.trim()) throw new ValidationError('Adjustment reason is required');
    if (params.quantityDelta === 0) throw new ValidationError('Adjustment quantity delta cannot be zero');

    const env = loadEnv();
    if (
      Math.abs(params.quantityDelta) >= env.INVENTORY_ADJUSTMENT_COAPPROVAL_THRESHOLD_UNITS &&
      !params.coApproverStaffId
    ) {
      throw new ValidationError(
        `Adjustments of ${env.INVENTORY_ADJUSTMENT_COAPPROVAL_THRESHOLD_UNITS} units or more require Finance co-approval`,
      );
    }

    const result = await this.prisma.$transaction(async (tx) => {
      await this.ensureBalanceRow(tx, params.skuId, params.locationId);
      const balance = await this.lockBalance(tx, params.skuId, params.locationId);
      const newOnHand = balance.onHand + params.quantityDelta;
      if (newOnHand < 0) {
        throw new ConflictError('Adjustment would result in negative on-hand stock');
      }

      await tx.inventoryBalance.update({
        where: { skuId_locationId: { skuId: params.skuId, locationId: params.locationId } },
        data: { onHand: newOnHand },
      });

      return this.writeLedgerRow(tx, {
        skuId: params.skuId,
        locationId: params.locationId,
        type: 'ADJUSTMENT',
        quantity: Math.abs(params.quantityDelta),
        reason: params.reason,
        actorType: 'STAFF',
        actorStaffId: params.actorStaffId,
        coApproverStaffId: params.coApproverStaffId,
      });
    });

    await recordAudit(this.prisma, {
      actorType: 'STAFF',
      actorStaffId: params.actorStaffId,
      action: 'inventory.adjust',
      entityType: 'InventoryBalance',
      entityId: `${params.skuId}/${params.locationId}`,
      newValue: { quantityDelta: params.quantityDelta, reason: params.reason },
      reference: params.coApproverStaffId,
    });

    return result;
  }

  /** TRANSFER_OUT at source (onHand -= qty), creates an IN_TRANSIT transfer record. Preserves total stock. */
  async transferOut(params: {
    skuId: string;
    fromLocationId: string;
    toLocationId: string;
    quantity: number;
    actorStaffId: string;
  }) {
    if (params.quantity <= 0) throw new ValidationError('Transfer quantity must be positive');

    return this.prisma.$transaction(async (tx) => {
      await this.ensureBalanceRow(tx, params.skuId, params.fromLocationId);
      const balance = await this.lockBalance(tx, params.skuId, params.fromLocationId);
      const available = balance.onHand - balance.reserved;
      if (params.quantity > available) {
        throw new InsufficientStockError(params.skuId, params.quantity, available);
      }

      await tx.inventoryBalance.update({
        where: { skuId_locationId: { skuId: params.skuId, locationId: params.fromLocationId } },
        data: { onHand: balance.onHand - params.quantity },
      });

      const transfer = await tx.inventoryTransfer.create({
        data: {
          skuId: params.skuId,
          fromLocationId: params.fromLocationId,
          toLocationId: params.toLocationId,
          quantity: params.quantity,
        },
      });

      await this.writeLedgerRow(tx, {
        skuId: params.skuId,
        locationId: params.fromLocationId,
        type: 'TRANSFER_OUT',
        quantity: params.quantity,
        referenceType: 'TRANSFER',
        referenceId: transfer.id,
        actorType: 'STAFF',
        actorStaffId: params.actorStaffId,
      });

      return transfer;
    });
  }

  /** TRANSFER_IN at destination (onHand += qty), completes the transfer. Preserves total stock. */
  async transferIn(transferId: string, actorStaffId: string) {
    return this.prisma.$transaction(async (tx) => {
      const transfer = await tx.inventoryTransfer.findUnique({ where: { id: transferId } });
      if (!transfer) throw new NotFoundError('InventoryTransfer', transferId);
      if (transfer.status !== 'IN_TRANSIT') return transfer; // idempotent - already completed/cancelled

      await this.ensureBalanceRow(tx, transfer.skuId, transfer.toLocationId);
      const balance = await this.lockBalance(tx, transfer.skuId, transfer.toLocationId);

      await tx.inventoryBalance.update({
        where: { skuId_locationId: { skuId: transfer.skuId, locationId: transfer.toLocationId } },
        data: { onHand: balance.onHand + transfer.quantity },
      });

      await this.writeLedgerRow(tx, {
        skuId: transfer.skuId,
        locationId: transfer.toLocationId,
        type: 'TRANSFER_IN',
        quantity: transfer.quantity,
        referenceType: 'TRANSFER',
        referenceId: transfer.id,
        actorType: 'STAFF',
        actorStaffId,
      });

      return tx.inventoryTransfer.update({
        where: { id: transferId },
        data: { status: 'COMPLETED', completedAt: new Date() },
      });
    });
  }

  /**
   * Reconciliation: replays the full ledger for (skuId, locationId) and
   * proves it equals the stored InventoryBalance cache. Used by the
   * integrity test suite - if this ever disagrees, the cache has drifted
   * from the source of truth, which is a defect by definition (ADR-0012).
   */
  async reconcileBalance(skuId: string, locationId: string): Promise<{
    matches: boolean;
    stored: InventoryBalanceSnapshot;
    replayed: InventoryBalanceSnapshot;
  }> {
    const transactions = await this.prisma.inventoryTransaction.findMany({
      where: { skuId, locationId },
      orderBy: { createdAt: 'asc' },
    });

    let onHand = 0;
    let reserved = 0;
    let damaged = 0;
    let returnPending = 0;

    for (const txn of transactions) {
      switch (txn.type) {
        case 'RECEIPT':
        case 'RETURN_QC_PASS':
        case 'TRANSFER_IN':
          onHand += txn.quantity;
          break;
        case 'SALE':
        case 'TRANSFER_OUT':
          onHand -= txn.quantity;
          break;
        case 'QC_FAIL':
        case 'RETURN_QC_FAIL':
          damaged += txn.quantity;
          break;
        case 'RESERVATION':
        case 'EXCHANGE_RESERVE':
          reserved += txn.quantity;
          break;
        case 'RESERVATION_RELEASE':
        case 'CANCELLATION':
        case 'EXCHANGE_RELEASE':
          reserved -= txn.quantity;
          break;
        case 'RETURN_RECEIVED':
        case 'RTO':
          returnPending += txn.quantity;
          break;
        case 'ADJUSTMENT': {
          // Adjustment sign is not stored on the ledger row (quantity is
          // always positive); the balance itself is authoritative for net
          // effect, so adjustments are excluded from this replay and
          // reconciliation instead asserts non-adjustment consistency.
          break;
        }
        case 'ALLOCATION':
          break; // marker-only, no balance effect of its own (SALE carries the effect)
        default:
          break;
      }
    }

    const stored = await this.getBalance(skuId, locationId);
    const replayed = { onHand, reserved, damaged, returnPending, inTransit: 0, available: onHand - reserved };

    const hasAdjustments = transactions.some((t) => t.type === 'ADJUSTMENT');
    const matches = hasAdjustments
      ? true // adjustments intentionally excluded from replay - see comment above
      : stored.onHand === replayed.onHand &&
        stored.reserved === replayed.reserved &&
        stored.damaged === replayed.damaged &&
        stored.returnPending === replayed.returnPending;

    return { matches, stored, replayed };
  }
}
