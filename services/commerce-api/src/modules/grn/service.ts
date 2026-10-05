import type { FastifyInstance } from 'fastify';
import type { Prisma, PrismaClient, QcResult } from '@fcp/db';
import { loadEnv } from '@fcp/config';
import { formatSequenceNumber, NotFoundError, ValidationError } from '@fcp/shared';
import { recordAudit } from '../audit/service.js';
import { ApprovalPolicyService, type ApprovalDecision, type SelfApprovalInput } from '../approvals/service.js';
import { ProcurementService, poStatusWords } from '../procurement/service.js';
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
  /** Owner approval details when the receiver signs off their own QC failure (AO-D4). */
  selfApproval?: SelfApprovalInput;
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

  /**
   * Checks a receipt without posting anything and says whether its QC
   * failures need a sign-off (GRN-004), with a summary for the approver.
   * The route uses this to queue a receipt for the named manager's own
   * approval (approvals/queue.ts) before any stock moves.
   */
  async checkGoodsReceipt(input: CreateGrnInput) {
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

    const po = await this.prisma.purchaseOrder.findUnique({ where: { id: input.poId }, include: { lines: { include: { sku: { select: { skuCode: true } } } } } });
    if (!po) throw new NotFoundError('PurchaseOrder', input.poId);
    if (!['APPROVED', 'PARTIALLY_RECEIVED'].includes(po.status)) {
      throw new ValidationError(`Goods can only be received against an approved purchase order; this one is ${poStatusWords(po.status)}`);
    }

    const env = loadEnv();
    let signoffFailedQty = 0;

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
      if (failedQty >= env.GRN_QC_FAIL_MANAGER_SIGNOFF_THRESHOLD_UNITS) signoffFailedQty = Math.max(signoffFailedQty, failedQty);
    }
    const location = await this.prisma.location.findUnique({ where: { id: input.locationId }, select: { name: true } });
    const summary = {
      poNumber: po.poNumber,
      location: location?.name ?? null,
      failedUnits: signoffFailedQty,
      lines: input.lines.map((l) => ({
        skuCode: po.lines.find((pl) => pl.id === l.poLineId)?.sku.skuCode ?? l.skuId,
        receivedQty: l.receivedQty,
        acceptedQty: l.acceptedQty,
        damagedQty: l.damagedQty,
        rejectedQty: l.rejectedQty,
        qcNotes: l.qcNotes ?? null,
      })),
    };
    return { signoffFailedQty, summary };
  }

  /**
   * Posts a receipt. `approvedSignoff` is the decision of an approved
   * approval request (approvals/queue.ts): the named manager approved from
   * their own login. Without it, a sign-off can only be the receiver's own
   * owner approval; naming someone else is refused here (the route queues
   * it instead).
   */
  async createGoodsReceipt(input: CreateGrnInput, actorStaffId: string, approvedSignoff?: ApprovalDecision) {
    const { signoffFailedQty } = await this.checkGoodsReceipt(input);
    const env = loadEnv();
    // QC-fail dispositions at/above the threshold need a named sign-off
    // (GRN-004) under the shared approval policy (AO-D4).
    let signoff: ApprovalDecision | undefined;
    if (approvedSignoff) {
      signoff = approvedSignoff;
    } else if (signoffFailedQty > 0) {
      if (!input.managerSignoffStaffId) {
        throw new ValidationError(
          `${signoffFailedQty} units on one line failed QC (damaged or rejected), which needs a manager's QC sign-off. Choose who signs off; they confirm from their own login (or sign off yourself if owner approval lets you).`,
        );
      }
      signoff = await new ApprovalPolicyService(this.prisma).decide({
        kind: 'RECEIVING_QC',
        requestedByStaffId: actorStaffId,
        approverStaffId: input.managerSignoffStaffId,
        actingStaffId: actorStaffId,
        permission: 'grn:qc:manager_signoff',
        selfApproval: input.selfApproval,
      });
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

      if (signoff) {
        await ApprovalPolicyService.record(tx, signoff, { entityType: 'GoodsReceipt', entityId: grn.id, detail: { grnNumber: grn.grnNumber, failedQty: signoffFailedQty } });
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

  async getGoodsReceipt(id: string) {
    const grn = await this.prisma.goodsReceipt.findUnique({
      where: { id },
      // receivedBy is selected field-by-field: including the relation
      // whole returned the staff member's passwordHash and mfaSecret
      // (found by the P1 admin build; see security/AUTHORIZATION_SWEEP.md).
      include: {
        lines: true,
        po: true,
        location: true,
        receivedBy: { select: { id: true, fullName: true, email: true } },
      },
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
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
    });
  }
}
