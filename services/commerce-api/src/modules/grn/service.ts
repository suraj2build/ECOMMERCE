import type { FastifyInstance } from 'fastify';
import type { Prisma, PrismaClient, QcResult } from '@fcp/db';
import { loadEnv } from '@fcp/config';
import { formatSequenceNumber, NotFoundError, ValidationError } from '@fcp/shared';
import { recordAudit } from '../audit/service.js';
import { ProcurementService } from '../procurement/service.js';
import { InventoryService } from '../inventory/service.js';

export interface GrnLineInput {
  poLineId: string;
  skuId: string;
  receivedQty: number;
  acceptedQty: number;
  damagedQty: number;
  rejectedQty: number;
  qcNotes?: string;
}

export interface CreateGrnInput {
  poId: string;
  locationId: string;
  lines: GrnLineInput[];
  managerSignoffStaffId?: string;
}

/**
 * Goods Receipt / QC (M05, specs/05-grn.md). Every accepted unit posts a
 * `RECEIPT` inventory transaction; every damaged/rejected unit posts a
 * `QC_FAIL` (damaged) transaction - onHand (sellable) is never touched by
 * a failed unit (GRN-003). The GRN row, the PO-line receivedQty roll-up,
 * and the inventory ledger postings all commit inside one DB transaction,
 * so a GRN never exists half-applied.
 */
export class GrnService {
  private readonly procurement: ProcurementService;
  private readonly inventory: InventoryService;

  constructor(private readonly fastify: FastifyInstance) {
    this.procurement = new ProcurementService(fastify);
    this.inventory = new InventoryService(fastify);
  }

  private get prisma(): PrismaClient {
    return this.fastify.prisma;
  }

  private async nextGrnNumber(tx: Prisma.TransactionClient): Promise<string> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('grn_number_seq'))`;
    const year = new Date().getFullYear();
    const count = await tx.goodsReceipt.count();
    return formatSequenceNumber('GRN', year, count + 1);
  }

  async createGoodsReceipt(input: CreateGrnInput, actorStaffId: string) {
    if (input.lines.length === 0) throw new ValidationError('GRN must have at least one line');

    const poLineIds = input.lines.map((l) => l.poLineId);
    if (new Set(poLineIds).size !== poLineIds.length) {
      // A PO line's outcome can already be split via qcResult PARTIAL
      // within a single line - certification-pass finding: without this
      // check, a request repeating a poLineId lost one update in
      // ProcurementService.applyGrnReceipt and was only ever caught by
      // the database's unique constraint, surfacing as an opaque 500.
      throw new ValidationError('A GRN request cannot include the same purchase order line more than once');
    }

    const po = await this.prisma.purchaseOrder.findUnique({ where: { id: input.poId }, include: { lines: true } });
    if (!po) throw new NotFoundError('PurchaseOrder', input.poId);
    if (!['APPROVED', 'PARTIALLY_RECEIVED'].includes(po.status)) {
      throw new ValidationError(`Cannot record a GRN against a purchase order in status '${po.status}'`);
    }

    const env = loadEnv();

    for (const line of input.lines) {
      const poLine = po.lines.find((l) => l.id === line.poLineId);
      if (!poLine) {
        throw new ValidationError(`Purchase order line '${line.poLineId}' does not belong to PO '${input.poId}'`);
      }
      if (poLine.skuId !== line.skuId) {
        throw new ValidationError(`GRN line SKU does not match purchase order line '${line.poLineId}'`);
      }
      if (line.receivedQty < 0 || line.acceptedQty < 0 || line.damagedQty < 0 || line.rejectedQty < 0) {
        throw new ValidationError('GRN line quantities cannot be negative');
      }
      if (line.acceptedQty + line.damagedQty + line.rejectedQty !== line.receivedQty) {
        throw new ValidationError(
          `GRN line for SKU '${line.skuId}': acceptedQty + damagedQty + rejectedQty must equal receivedQty`,
        );
      }

      const failedQty = line.damagedQty + line.rejectedQty;
      if (failedQty >= env.GRN_QC_FAIL_MANAGER_SIGNOFF_THRESHOLD_UNITS) {
        await this.assertManagerSignoff(input.managerSignoffStaffId, failedQty);
      }
    }

    const { created, preparedLines } = await this.prisma.$transaction(async (tx) => {
      const beforeMap = await this.procurement.applyGrnReceipt(
        tx,
        input.poId,
        input.lines.map((l) => ({ poLineId: l.poLineId, receivedQty: l.receivedQty })),
      );

      const grnNumber = await this.nextGrnNumber(tx);

      const prepared = input.lines.map((line) => {
        const before = beforeMap.get(line.poLineId)!;
        const expectedQty = Math.max(0, before.orderedQty - before.receivedQtyBeforeThisGrn);
        const shortQty = Math.max(0, expectedQty - line.receivedQty);
        const excessQty = Math.max(0, line.receivedQty - expectedQty);
        const toleranceUnits = Math.floor((expectedQty * env.GRN_EXCESS_TOLERANCE_PERCENT) / 100);
        const isExcessException = excessQty > toleranceUnits;
        const qcResult: QcResult =
          line.damagedQty === 0 && line.rejectedQty === 0 && line.acceptedQty > 0
            ? 'PASS'
            : line.acceptedQty === 0
              ? 'FAIL'
              : 'PARTIAL';
        return { ...line, expectedQty, shortQty, excessQty, isExcessException, qcResult };
      });

      const grn = await tx.goodsReceipt.create({
        data: {
          grnNumber,
          poId: input.poId,
          locationId: input.locationId,
          receivedByStaffId: actorStaffId,
          lines: {
            create: prepared.map((l) => ({
              poLineId: l.poLineId,
              skuId: l.skuId,
              expectedQty: l.expectedQty,
              receivedQty: l.receivedQty,
              acceptedQty: l.acceptedQty,
              shortQty: l.shortQty,
              excessQty: l.excessQty,
              damagedQty: l.damagedQty,
              rejectedQty: l.rejectedQty,
              qcResult: l.qcResult,
              qcNotes: l.qcNotes,
            })),
          },
        },
        include: { lines: true },
      });

      for (const line of prepared) {
        if (line.acceptedQty > 0) {
          await this.inventory.postReceipt(
            {
              skuId: line.skuId,
              locationId: input.locationId,
              quantity: line.acceptedQty,
              referenceType: 'GRN',
              referenceId: grn.id,
              idempotencyKey: `grn:${grn.id}:receipt:${line.poLineId}`,
            },
            tx,
          );
        }
        const failedQty = line.damagedQty + line.rejectedQty;
        if (failedQty > 0) {
          await this.inventory.postDamaged(
            {
              skuId: line.skuId,
              locationId: input.locationId,
              quantity: failedQty,
              referenceType: 'GRN',
              referenceId: grn.id,
              reason: line.qcNotes ?? 'GRN QC failure',
              idempotencyKey: `grn:${grn.id}:damaged:${line.poLineId}`,
            },
            tx,
          );
        }
      }

      return { created: grn, preparedLines: prepared };
    });

    await recordAudit(this.prisma, {
      actorType: 'STAFF',
      actorStaffId,
      action: 'grn.create',
      entityType: 'GoodsReceipt',
      entityId: created.id,
      newValue: {
        poId: input.poId,
        lines: preparedLines.map((l) => ({
          skuId: l.skuId,
          receivedQty: l.receivedQty,
          acceptedQty: l.acceptedQty,
          damagedQty: l.damagedQty,
          rejectedQty: l.rejectedQty,
          shortQty: l.shortQty,
          excessQty: l.excessQty,
          qcResult: l.qcResult,
          isExcessException: l.isExcessException,
        })),
      },
      reference: input.poId,
    });

    return {
      ...created,
      exceptions: preparedLines
        .filter((l) => l.isExcessException || l.shortQty > 0)
        .map((l) => ({
          poLineId: l.poLineId,
          skuId: l.skuId,
          shortQty: l.shortQty,
          excessQty: l.excessQty,
          isExcessException: l.isExcessException,
        })),
    };
  }

  /** QC-fail dispositions at/above the configured threshold require a named staff member holding grn:qc:manager_signoff (GRN-004). */
  private async assertManagerSignoff(managerSignoffStaffId: string | undefined, failedQty: number): Promise<void> {
    if (!managerSignoffStaffId) {
      throw new ValidationError(
        `QC-fail disposition of ${failedQty} units requires Warehouse Manager sign-off (managerSignoffStaffId)`,
      );
    }
    const manager = await this.prisma.staffUser.findUnique({
      where: { id: managerSignoffStaffId },
      include: { roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } } },
    });
    const hasSignoff = manager?.roles.some((ur) =>
      ur.role.permissions.some((rp) => rp.permission.key === 'grn:qc:manager_signoff'),
    );
    if (!manager || !hasSignoff) {
      throw new ValidationError(
        'managerSignoffStaffId must reference a staff user with grn:qc:manager_signoff permission',
      );
    }
  }

  async getGoodsReceipt(id: string) {
    const grn = await this.prisma.goodsReceipt.findUnique({
      where: { id },
      include: { lines: true, po: true, location: true, receivedBy: true },
    });
    if (!grn) throw new NotFoundError('GoodsReceipt', id);
    return grn;
  }

  async listGoodsReceipts(params: { poId?: string; take?: number; skip?: number }) {
    return this.prisma.goodsReceipt.findMany({
      where: { poId: params.poId },
      include: { lines: true },
      take: params.take ?? 50,
      skip: params.skip ?? 0,
      orderBy: { createdAt: 'desc' },
    });
  }
}
