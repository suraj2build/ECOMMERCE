import type { FastifyInstance } from 'fastify';
import { Prisma, type ApprovalKind, type ApprovalRequestStatus, type PickExceptionType, type PrismaClient } from '@fcp/db';
import { AppError, ConflictError, ForbiddenError, NotFoundError, ValidationError, type PermissionKey } from '@fcp/shared';
import { recordAudit } from '../audit/service.js';
import { ApprovalPolicyService, ApprovalAlreadyDecidedError, holdsPermission, type ApprovalDecision } from './service.js';
import { InventoryService } from '../inventory/service.js';
import { GrnService, type CreateGrnInput } from '../grn/service.js';
import { WarehouseService } from '../warehouse/service.js';

/**
 * Approval requests (Product Owner review, 2026-10-05): when someone other
 * than the requester has to approve a stock adjustment, a receiving QC
 * sign-off or a pick shortfall, naming them is not their approval. The
 * action waits here, unapplied, until that person approves it from their
 * own login; then it runs exactly as submitted, re-checked against the
 * state at that moment. Owner self-approval is a separate path and never
 * creates a request (ApprovalPolicyService.decide).
 *
 * Purchase orders already work this way through their own status
 * (submitted -> approved by someone else), so they do not use this table.
 */

export type QueuedKind = Exclude<ApprovalKind, 'PURCHASE_ORDER'>;

/** Who may request, and who may approve, each kind. */
export const REQUEST_RULES: Record<QueuedKind, { requesterPermission: PermissionKey; approverPermission: PermissionKey; noun: string }> = {
  STOCK_ADJUSTMENT: { requesterPermission: 'inventory:adjust', approverPermission: 'inventory:adjust:coapprove', noun: 'stock adjustment' },
  RECEIVING_QC: { requesterPermission: 'grn:create', approverPermission: 'grn:qc:manager_signoff', noun: 'receiving QC sign-off' },
  PICK_SHORTFALL: { requesterPermission: 'warehouse:pick', approverPermission: 'inventory:adjust:coapprove', noun: 'pick shortfall write-off' },
};

export interface AdjustmentPayload {
  skuId: string;
  locationId: string;
  quantityDelta: number;
  reason: string;
  idempotencyKey?: string;
}

export type GrnPayload = Omit<CreateGrnInput, 'managerSignoffStaffId' | 'selfApproval'>;

export interface PickPayload {
  pickTaskId: string;
  idempotencyKey: string;
  outcome: 'SHORT' | 'EXCEPTION';
  pickedQuantity?: number;
  exceptionType?: PickExceptionType;
  exceptionReason?: string;
  scannedBarcode?: string;
}

type Payload = AdjustmentPayload | GrnPayload | PickPayload;

/** A claim older than this belongs to a process that died; the approver can try again. */
const CLAIM_STALE_MS = 5 * 60_000;

const include = {
  requestedByStaff: { select: { fullName: true } },
  approverStaff: { select: { fullName: true } },
} satisfies Prisma.ApprovalRequestInclude;

type RequestRow = Prisma.ApprovalRequestGetPayload<{ include: typeof include }>;

export function viewRequest(r: RequestRow) {
  return {
    id: r.id,
    kind: r.kind,
    status: r.status,
    requestedByStaffId: r.requestedByStaffId,
    requestedBy: r.requestedByStaff.fullName,
    approverStaffId: r.approverStaffId,
    approver: r.approverStaff.fullName,
    summary: r.summary,
    createdAt: r.createdAt,
    decidedAt: r.decidedAt,
    decisionNote: r.decisionNote,
    failureReason: r.failureReason,
    resultEntityType: r.resultEntityType,
    resultEntityId: r.resultEntityId,
  };
}
export type ApprovalRequestView = ReturnType<typeof viewRequest>;

export class ApprovalQueueService {
  private readonly policy: ApprovalPolicyService;

  constructor(private readonly fastify: FastifyInstance) {
    this.policy = new ApprovalPolicyService(fastify.prisma);
  }

  private get prisma(): PrismaClient {
    return this.fastify.prisma;
  }

  /**
   * Queues an action for `approverStaffId`. The approver must be an active
   * staff member holding the approving permission and someone other than
   * the requester (the requester approving their own action is owner
   * approval, handled immediately elsewhere). Re-sending the same request
   * while it is open returns the open one.
   */
  async request(params: {
    kind: QueuedKind;
    requestedByStaffId: string;
    approverStaffId: string;
    payload: Payload;
    summary: Record<string, unknown>;
    subjectKey?: string;
  }): Promise<ApprovalRequestView> {
    const rule = REQUEST_RULES[params.kind];
    if (params.approverStaffId === params.requestedByStaffId) {
      throw new ValidationError(`You cannot send your own ${rule.noun} to yourself for approval`);
    }
    if (!(await holdsPermission(this.prisma, params.approverStaffId, rule.approverPermission))) {
      throw new ValidationError(`The approver for this ${rule.noun} must be an active staff member with the ${rule.approverPermission} permission`);
    }
    try {
      const created = await this.prisma.$transaction(async (tx) => {
        const row = await tx.approvalRequest.create({
          data: {
            kind: params.kind,
            requestedByStaffId: params.requestedByStaffId,
            approverStaffId: params.approverStaffId,
            subjectKey: params.subjectKey ?? null,
            payload: params.payload as unknown as Prisma.InputJsonValue,
            summary: params.summary as Prisma.InputJsonValue,
          },
          include,
        });
        await recordAudit(tx, {
          actorType: 'STAFF',
          actorStaffId: params.requestedByStaffId,
          action: 'approval.requested',
          entityType: 'ApprovalRequest',
          entityId: row.id,
          newValue: { kind: params.kind, approverStaffId: params.approverStaffId, ...params.summary },
        });
        return row;
      });
      return viewRequest(created);
    } catch (err) {
      if (params.subjectKey && err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const open = await this.prisma.approvalRequest.findFirst({ where: { kind: params.kind, subjectKey: params.subjectKey, status: 'PENDING' }, include });
        if (open && open.requestedByStaffId === params.requestedByStaffId && open.approverStaffId === params.approverStaffId && samePayload(open.payload, params.payload)) {
          return viewRequest(open);
        }
        throw new ConflictError(
          open ? `This is already waiting for ${open.approverStaff.fullName} to approve it` : 'This is already waiting for approval',
        );
      }
      throw err;
    }
  }

  async list(params: { box: 'inbox' | 'outbox' | 'all'; viewerStaffId: string; status?: ApprovalRequestStatus; take?: number; skip?: number }) {
    const where: Prisma.ApprovalRequestWhereInput = {
      ...(params.box === 'inbox' ? { approverStaffId: params.viewerStaffId } : {}),
      ...(params.box === 'outbox' ? { requestedByStaffId: params.viewerStaffId } : {}),
      ...(params.status ? { status: params.status } : {}),
    };
    const take = Math.min(Math.max(params.take ?? 50, 1), 200);
    const [total, rows] = await Promise.all([
      this.prisma.approvalRequest.count({ where }),
      this.prisma.approvalRequest.findMany({ where, include, orderBy: { createdAt: 'desc' }, take, skip: params.skip ?? 0 }),
    ]);
    return { total, requests: rows.map(viewRequest) };
  }

  async get(id: string, viewer: { staffUserId: string; canSeeAll: boolean }) {
    const row = await this.prisma.approvalRequest.findUnique({ where: { id }, include });
    if (!row || (!viewer.canSeeAll && row.requestedByStaffId !== viewer.staffUserId && row.approverStaffId !== viewer.staffUserId)) {
      throw new NotFoundError('ApprovalRequest', id);
    }
    return viewRequest(row);
  }

  /**
   * The named approver approves: the action runs now, as its requester,
   * with this approval recorded in the same transaction (the request is
   * claimed there, so two approvals of one request cannot both apply).
   * If the action is no longer possible (stock changed, the task was
   * picked, the PO closed), the request is marked failed with the reason.
   */
  async approve(id: string, actorStaffId: string) {
    const row = await this.loadForDecision(id, actorStaffId, 'approve');
    const rule = REQUEST_RULES[row.kind as QueuedKind];
    if (!(await holdsPermission(this.prisma, row.requestedByStaffId, rule.requesterPermission))) {
      const reason = `${row.requestedByStaff.fullName} can no longer make this ${rule.noun} (their access changed), so it was not applied`;
      await this.markFailed(row.id, actorStaffId, reason);
      throw new ValidationError(reason);
    }
    const decision: ApprovalDecision = {
      ...(await this.policy.decide({
        kind: row.kind,
        requestedByStaffId: row.requestedByStaffId,
        approverStaffId: actorStaffId,
        actingStaffId: actorStaffId,
        permission: rule.approverPermission,
      })),
      requestId: row.id,
    };

    // Claim the request before acting, so two approvals of it at once
    // (a double click, two tabs) cannot both run the action: the second is
    // refused here.
    const claim = await this.prisma.approvalRequest.updateMany({
      where: { id: row.id, status: 'PENDING', approverStaffId: actorStaffId, OR: [{ claimedAt: null }, { claimedAt: { lt: new Date(Date.now() - CLAIM_STALE_MS) } }] },
      data: { claimedAt: new Date() },
    });
    if (claim.count !== 1) throw new ConflictError('This request is already being approved, or has been decided');

    let result: { entityType: string; entityId: string; skuIds: string[] };
    try {
      result = await this.execute(row, decision);
    } catch (err) {
      if (err instanceof ApprovalAlreadyDecidedError) throw new ConflictError('This request has already been decided');
      if (err instanceof AppError && err.statusCode < 500) {
        await this.markFailed(row.id, actorStaffId, err.message);
      } else {
        await this.prisma.approvalRequest.updateMany({ where: { id: row.id, status: 'PENDING' }, data: { claimedAt: null } });
      }
      throw err;
    }
    const after = await this.prisma.approvalRequest.findUniqueOrThrow({ where: { id: row.id }, include });
    if (after.status === 'PENDING') {
      // The action had already been applied earlier under the same key, so
      // nothing new was approved now.
      await this.markFailed(row.id, actorStaffId, 'This had already been applied earlier; nothing new was approved');
    }
    for (const skuId of result.skuIds) await this.fastify.searchIndex.indexStyleForSku(skuId);
    return viewRequest(await this.prisma.approvalRequest.findUniqueOrThrow({ where: { id: row.id }, include }));
  }

  async reject(id: string, actorStaffId: string, note: string) {
    const trimmed = note.trim();
    if (trimmed.length < 3) throw new ValidationError('Say why you are rejecting this, so the requester knows what to change');
    const row = await this.loadForDecision(id, actorStaffId, 'reject');
    return this.close(row.id, actorStaffId, 'REJECTED', { decisionNote: trimmed }, 'approval.rejected');
  }

  async cancel(id: string, actorStaffId: string) {
    const row = await this.prisma.approvalRequest.findUnique({ where: { id }, include });
    if (!row) throw new NotFoundError('ApprovalRequest', id);
    if (row.requestedByStaffId !== actorStaffId) throw new ForbiddenError('Only the person who sent this request can withdraw it');
    if (row.status !== 'PENDING') throw new ConflictError(`This request is already ${row.status.toLowerCase()}`);
    return this.close(row.id, actorStaffId, 'CANCELLED', {}, 'approval.cancelled');
  }

  private async loadForDecision(id: string, actorStaffId: string, verb: 'approve' | 'reject') {
    const row = await this.prisma.approvalRequest.findUnique({ where: { id }, include });
    if (!row) throw new NotFoundError('ApprovalRequest', id);
    if (row.approverStaffId !== actorStaffId) {
      throw new ForbiddenError(`Only ${row.approverStaff.fullName}, who was asked to approve this, can ${verb} it`);
    }
    if (row.status !== 'PENDING') throw new ConflictError(`This request is already ${row.status.toLowerCase()}`);
    return row;
  }

  private async close(id: string, actorStaffId: string, status: ApprovalRequestStatus, extra: { decisionNote?: string; failureReason?: string }, action: string) {
    const updated = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.approvalRequest.updateMany({
        where: { id, status: 'PENDING' },
        data: { status, decidedAt: new Date(), decidedByStaffId: actorStaffId, ...extra },
      });
      if (claimed.count !== 1) throw new ConflictError('This request has already been decided');
      await recordAudit(tx, { actorType: 'STAFF', actorStaffId, action, entityType: 'ApprovalRequest', entityId: id, newValue: { status, ...extra } });
      return tx.approvalRequest.findUniqueOrThrow({ where: { id }, include });
    });
    return viewRequest(updated);
  }

  private async markFailed(id: string, actorStaffId: string, reason: string) {
    await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.approvalRequest.updateMany({
        where: { id, status: 'PENDING', approverStaffId: actorStaffId },
        data: { status: 'FAILED', decidedAt: new Date(), decidedByStaffId: actorStaffId, failureReason: reason },
      });
      if (claimed.count === 1) {
        await recordAudit(tx, { actorType: 'STAFF', actorStaffId, action: 'approval.failed', entityType: 'ApprovalRequest', entityId: id, newValue: { failureReason: reason } });
      }
    });
  }

  /** Runs the queued action as its requester with `decision` (which claims the request inside the action's transaction). */
  private async execute(row: RequestRow, decision: ApprovalDecision): Promise<{ entityType: string; entityId: string; skuIds: string[] }> {
    switch (row.kind) {
      case 'STOCK_ADJUSTMENT': {
        const p = row.payload as unknown as AdjustmentPayload;
        const txn = await new InventoryService(this.fastify).postAdjustment({
          ...p,
          actorStaffId: row.requestedByStaffId,
          coApproverStaffId: decision.approvedByStaffId,
          approval: decision,
        });
        return { entityType: 'InventoryTransaction', entityId: txn.id, skuIds: [p.skuId] };
      }
      case 'RECEIVING_QC': {
        const p = row.payload as unknown as GrnPayload;
        const grn = await new GrnService(this.fastify).createGoodsReceipt({ ...p, managerSignoffStaffId: decision.approvedByStaffId }, row.requestedByStaffId, decision);
        return { entityType: 'GoodsReceipt', entityId: grn.id, skuIds: [...new Set(p.lines.map((l) => l.skuId))] };
      }
      case 'PICK_SHORTFALL': {
        const p = row.payload as unknown as PickPayload;
        const task = await new WarehouseService(this.fastify).recordPickOutcome({
          pickTaskId: p.pickTaskId,
          staffId: row.requestedByStaffId,
          idempotencyKey: p.idempotencyKey,
          outcome: p.outcome,
          pickedQuantity: p.pickedQuantity,
          exceptionType: p.exceptionType,
          exceptionReason: p.exceptionReason,
          scannedBarcode: p.scannedBarcode,
          coApproverStaffId: decision.approvedByStaffId,
          approval: decision,
        });
        return { entityType: 'PickTask', entityId: p.pickTaskId, skuIds: task && 'skuId' in task && typeof task.skuId === 'string' ? [task.skuId] : [] };
      }
      default:
        throw new ValidationError(`Unsupported approval kind ${row.kind}`);
    }
  }
}

function samePayload(a: unknown, b: unknown): boolean {
  return JSON.stringify(sortKeys(a)) === JSON.stringify(sortKeys(b));
}
function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === 'object') {
    return Object.fromEntries(Object.entries(v as Record<string, unknown>).filter(([, x]) => x !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, sortKeys(x)]));
  }
  return v;
}
