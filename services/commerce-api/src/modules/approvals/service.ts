import type { ApprovalKind, Prisma, PrismaClient } from '@fcp/db';
import { ConflictError, ValidationError, verifyPassword, type PermissionKey } from '@fcp/shared';
import { z } from 'zod';
import { recordAudit } from '../audit/service.js';
import { verifyMfaToken } from '../auth/mfa.js';
import { readMfaSeedOrDeny } from '../auth/service.js';

/**
 * One approval rule for every action that needs a second person
 * (AO-D4, Product Owner 2026-10-05; docs/admin/APPROVALS.md):
 *
 * - purchase-order approval (approver vs submitter),
 * - stock adjustments at/above the co-approval threshold,
 * - receiving QC sign-off at/above its threshold,
 * - pick shortfalls at/above the adjustment threshold.
 *
 * The approver must be an active staff member holding the approving
 * permission, and must be someone other than the requester, approving from
 * their own login: naming someone is never their approval (Product Owner
 * review, 2026-10-05). Purchase orders wait in SUBMITTED for that person;
 * adjustments, receiving sign-off and pick shortfalls wait as approval
 * requests (./queue.ts). The one
 * exception is owner approval: when an org:manage holder has switched it
 * on, a staff member named as an owner may approve their own action by
 * giving a written reason and re-entering their password (plus their MFA
 * code when they have MFA set up). Independent approval stays available
 * whether or not owner approval is on.
 *
 * Every approval, independent or self, is written to `approval_records`
 * in the same transaction as the action it approves.
 */

export const selfApprovalSchema = z.object({
  reason: z.string().max(1000),
  password: z.string().min(1).max(200),
  mfaCode: z.string().max(12).optional(),
});
export type SelfApprovalInput = z.infer<typeof selfApprovalSchema>;

export interface ApprovalDecision {
  kind: ApprovalKind;
  requestedByStaffId: string;
  approvedByStaffId: string;
  selfApproved: boolean;
  reason: string | null;
  /** The approval request this decision approves, claimed when the decision is recorded. */
  requestId?: string;
}

/** The approval request was decided (or withdrawn) by someone else first. */
export class ApprovalAlreadyDecidedError extends ConflictError {
  constructor() {
    super('This request has already been decided');
  }
}

const NOUN: Record<ApprovalKind, string> = {
  PURCHASE_ORDER: 'purchase order',
  STOCK_ADJUSTMENT: 'stock adjustment',
  RECEIVING_QC: 'receiving QC sign-off',
  PICK_SHORTFALL: 'pick shortfall write-off',
};

export const MIN_REASON_LENGTH = 10;
const FAILED_CONFIRMATION_LIMIT = 5;
const FAILED_CONFIRMATION_WINDOW_MS = 15 * 60_000;

type Db = PrismaClient | Prisma.TransactionClient;

export async function holdsPermission(db: Db, staffUserId: string, permission: PermissionKey) {
  const staff = await db.staffUser.findUnique({
    where: { id: staffUserId },
    select: {
      id: true,
      isActive: true,
      roles: { select: { role: { select: { permissions: { select: { permission: { select: { key: true } } } } } } } },
    },
  });
  if (!staff || !staff.isActive) return false;
  return staff.roles.some((r) => r.role.permissions.some((p) => p.permission.key === permission));
}

export class ApprovalPolicyService {
  constructor(private readonly prisma: PrismaClient) {}

  async getPolicy(viewerStaffId?: string) {
    const [policy, owners] = await Promise.all([
      this.prisma.approvalPolicy.findUnique({ where: { id: 'default' }, include: { updatedByStaff: { select: { fullName: true } } } }),
      this.prisma.approvalOwner.findMany({ include: { staffUser: { select: { id: true, fullName: true, isActive: true } } }, orderBy: { createdAt: 'asc' } }),
    ]);
    return {
      ownerApprovalEnabled: policy?.ownerApprovalEnabled ?? false,
      owners: owners.map((o) => ({ id: o.staffUser.id, fullName: o.staffUser.fullName, isActive: o.staffUser.isActive })),
      updatedAt: policy?.updatedAt ?? null,
      updatedBy: policy?.updatedByStaff?.fullName ?? null,
      viewerIsOwner: viewerStaffId ? owners.some((o) => o.staffUserId === viewerStaffId) : false,
      minReasonLength: MIN_REASON_LENGTH,
    };
  }

  /** True when `staffUserId` may approve their own actions right now. */
  async ownerApprovalAllowedFor(staffUserId: string, db: Db = this.prisma): Promise<boolean> {
    const [policy, owner] = await Promise.all([
      db.approvalPolicy.findUnique({ where: { id: 'default' } }),
      db.approvalOwner.findUnique({ where: { staffUserId } }),
    ]);
    return Boolean(policy?.ownerApprovalEnabled && owner);
  }

  /**
   * Changing the policy is itself a sensitive action: org:manage (checked by
   * the route) plus the caller's password, and it is audited with the
   * before and after state.
   */
  async updatePolicy(
    input: { ownerApprovalEnabled: boolean; ownerStaffIds: string[]; confirmation: { password: string; mfaCode?: string } },
    actorStaffId: string,
  ) {
    await this.confirmIdentity(actorStaffId, input.confirmation, 'approval_policy.update');
    const ownerIds = [...new Set(input.ownerStaffIds)];
    if (input.ownerApprovalEnabled && ownerIds.length === 0) {
      throw new ValidationError('Choose at least one owner before turning owner approval on');
    }
    const staff = await this.prisma.staffUser.findMany({ where: { id: { in: ownerIds } }, select: { id: true, isActive: true, fullName: true } });
    const missing = ownerIds.filter((id) => !staff.some((s) => s.id === id && s.isActive));
    if (missing.length > 0) throw new ValidationError('Owners must be active staff members');

    const before = await this.getPolicy();
    await this.prisma.$transaction(async (tx) => {
      await tx.approvalPolicy.upsert({
        where: { id: 'default' },
        create: { id: 'default', ownerApprovalEnabled: input.ownerApprovalEnabled, updatedByStaffId: actorStaffId },
        update: { ownerApprovalEnabled: input.ownerApprovalEnabled, updatedByStaffId: actorStaffId },
      });
      await tx.approvalOwner.deleteMany({ where: { staffUserId: { notIn: ownerIds } } });
      for (const staffUserId of ownerIds) {
        await tx.approvalOwner.upsert({ where: { staffUserId }, create: { staffUserId, addedByStaffId: actorStaffId }, update: {} });
      }
      await recordAudit(tx, {
        actorType: 'STAFF',
        actorStaffId,
        action: 'approval_policy.update',
        entityType: 'ApprovalPolicy',
        entityId: 'default',
        oldValue: { ownerApprovalEnabled: before.ownerApprovalEnabled, ownerStaffIds: before.owners.map((o) => o.id) },
        newValue: { ownerApprovalEnabled: input.ownerApprovalEnabled, ownerStaffIds: ownerIds },
      });
    });
    return this.getPolicy(actorStaffId);
  }

  /**
   * Decides whether `approverStaffId` may approve `requestedByStaffId`'s
   * action, as requested by the signed-in `actingStaffId`. Call before the
   * action's transaction (password checks are slow); then pass the decision
   * to {@link record} inside it.
   *
   * An independent approval is only valid when the approver is the person
   * acting: someone else can name an approver, but only the approver's own
   * login approves (the caller queues the action for them instead).
   */
  async decide(params: {
    kind: ApprovalKind;
    requestedByStaffId: string;
    approverStaffId: string;
    actingStaffId: string;
    permission: PermissionKey;
    selfApproval?: SelfApprovalInput;
  }): Promise<ApprovalDecision> {
    const { kind, requestedByStaffId, approverStaffId, permission } = params;
    const noun = NOUN[kind];
    if (!(await holdsPermission(this.prisma, approverStaffId, permission))) {
      throw new ValidationError(`The approver for this ${noun} must be an active staff member with the ${permission} permission`);
    }
    if (approverStaffId !== requestedByStaffId) {
      if (params.actingStaffId !== approverStaffId) {
        throw new ValidationError(`This ${noun} must be approved by the approver from their own login, not on their behalf`);
      }
      return { kind, requestedByStaffId, approvedByStaffId: approverStaffId, selfApproved: false, reason: null };
    }
    if (params.actingStaffId !== requestedByStaffId) {
      throw new ValidationError(`Only the person who made this ${noun} can approve it as an owner`);
    }

    // The requester is approving their own action.
    if (!(await this.ownerApprovalAllowedFor(requestedByStaffId))) {
      throw new ValidationError(
        `A ${noun} needs approval from someone other than the person who made it. ` +
          'If you run the business on your own, an owner can turn on owner approval on the Approvals page.',
      );
    }
    if (!params.selfApproval) {
      throw new ValidationError(`You are approving your own ${noun}: give a reason and re-enter your password to confirm`);
    }
    const reason = params.selfApproval.reason.trim();
    if (reason.length < MIN_REASON_LENGTH) {
      throw new ValidationError(`Give a reason of at least ${MIN_REASON_LENGTH} characters for approving your own ${noun}`);
    }
    await this.confirmIdentity(requestedByStaffId, params.selfApproval, `approval.self.${kind.toLowerCase()}`);
    return { kind, requestedByStaffId, approvedByStaffId: approverStaffId, selfApproved: true, reason };
  }

  /**
   * Writes the approval record (and an audit row for a self-approval) inside
   * the action's transaction. A decision made on an approval request also
   * claims that request here, so the action and the request's approval
   * commit together, and a second approval of the same request fails
   * (ApprovalAlreadyDecidedError) and rolls its action back.
   */
  static async record(
    tx: Prisma.TransactionClient,
    decision: ApprovalDecision,
    entity: { entityType: string; entityId: string; detail?: Record<string, unknown> },
  ) {
    if (decision.requestId) {
      const claimed = await tx.approvalRequest.updateMany({
        where: { id: decision.requestId, status: 'PENDING', approverStaffId: decision.approvedByStaffId, requestedByStaffId: decision.requestedByStaffId, kind: decision.kind },
        data: {
          status: 'APPROVED',
          decidedAt: new Date(),
          decidedByStaffId: decision.approvedByStaffId,
          resultEntityType: entity.entityType,
          resultEntityId: entity.entityId,
        },
      });
      if (claimed.count !== 1) throw new ApprovalAlreadyDecidedError();
      await recordAudit(tx, {
        actorType: 'STAFF',
        actorStaffId: decision.approvedByStaffId,
        action: 'approval.approved',
        entityType: 'ApprovalRequest',
        entityId: decision.requestId,
        newValue: { kind: decision.kind, resultEntityType: entity.entityType, resultEntityId: entity.entityId },
      });
    }
    const row = await tx.approvalRecord.create({
      data: {
        kind: decision.kind,
        entityType: entity.entityType,
        entityId: entity.entityId,
        requestedByStaffId: decision.requestedByStaffId,
        approvedByStaffId: decision.approvedByStaffId,
        selfApproved: decision.selfApproved,
        reason: decision.reason,
        ...(decision.requestId ? { approvalRequestId: decision.requestId } : {}),
        ...(entity.detail ? { detail: entity.detail as Prisma.InputJsonValue } : {}),
      },
    });
    if (decision.selfApproved) {
      await recordAudit(tx, {
        actorType: 'STAFF',
        actorStaffId: decision.approvedByStaffId,
        action: 'approval.self_approved',
        entityType: entity.entityType,
        entityId: entity.entityId,
        newValue: { kind: decision.kind, reason: decision.reason, approvalRecordId: row.id, ...(entity.detail ?? {}) },
      });
    }
    return row;
  }

  async listRecords(params: { selfApproved?: boolean; take?: number; skip?: number }) {
    const where: Prisma.ApprovalRecordWhereInput = params.selfApproved === undefined ? {} : { selfApproved: params.selfApproved };
    const take = Math.min(Math.max(params.take ?? 50, 1), 200);
    const [total, rows] = await Promise.all([
      this.prisma.approvalRecord.count({ where }),
      this.prisma.approvalRecord.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take,
        skip: params.skip ?? 0,
        include: { requestedByStaff: { select: { fullName: true } }, approvedByStaff: { select: { fullName: true } } },
      }),
    ]);
    return {
      total,
      records: rows.map((r) => ({
        id: r.id,
        kind: r.kind,
        entityType: r.entityType,
        entityId: r.entityId,
        requestedBy: r.requestedByStaff.fullName,
        approvedBy: r.approvedByStaff.fullName,
        selfApproved: r.selfApproved,
        reason: r.reason,
        detail: r.detail,
        createdAt: r.createdAt,
      })),
    };
  }

  /**
   * Re-confirms the signed-in staff member: password, plus the MFA code
   * when they have MFA set up. Failures are audited, and after
   * FAILED_CONFIRMATION_LIMIT failures in 15 minutes further attempts are
   * refused until the window passes.
   */
  private async confirmIdentity(staffUserId: string, confirmation: { password: string; mfaCode?: string }, purpose: string) {
    // Attempts for one person run one at a time (a per-person lock), so a
    // burst of simultaneous wrong guesses cannot all slip under the limit
    // before the first failure is written.
    const failure = await this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`approval-confirm:${staffUserId}`}, 0))`;
        const since = new Date(Date.now() - FAILED_CONFIRMATION_WINDOW_MS);
        const recentFailures = await tx.auditLog.count({
          where: { actorStaffId: staffUserId, action: 'approval.confirmation_failed', createdAt: { gte: since } },
        });
        if (recentFailures >= FAILED_CONFIRMATION_LIMIT) return { locked: true as const };
        const staff = await tx.staffUser.findUnique({ where: { id: staffUserId }, select: { passwordHash: true, mfaEnabled: true, mfaSecret: true, isActive: true } });
        let message: string | null = null;
        if (!staff || !staff.isActive || !(await verifyPassword(confirmation.password, staff.passwordHash))) {
          message = 'The password is not correct';
        } else if (staff.mfaEnabled && staff.mfaSecret) {
          if (!confirmation.mfaCode) message = 'Enter the code from your authenticator app as well';
          else {
            const seed = await readMfaSeedOrDeny(this.prisma, staffUserId, staff.mfaSecret);
            if (!verifyMfaToken(confirmation.mfaCode, seed)) message = 'The authenticator code is not correct';
          }
        }
        if (message) {
          await recordAudit(tx, {
            actorType: 'STAFF',
            actorStaffId: staffUserId,
            action: 'approval.confirmation_failed',
            entityType: 'StaffUser',
            entityId: staffUserId,
            newValue: { purpose },
          });
        }
        return { locked: false as const, message };
      },
      { maxWait: 15_000, timeout: 30_000 },
    );
    if (failure.locked) throw new ValidationError('Too many incorrect confirmations. Wait 15 minutes and try again.');
    if (failure.message) throw new ValidationError(failure.message);
  }
}
