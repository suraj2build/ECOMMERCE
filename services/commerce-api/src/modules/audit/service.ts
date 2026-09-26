import type { PrismaClient, Prisma } from '@fcp/db';

export interface AuditEntry {
  actorType: 'STAFF' | 'CUSTOMER' | 'SYSTEM';
  actorStaffId?: string;
  // M22: records WHICH customer acted when actorType is CUSTOMER (the
  // column previously didn't exist - see AuditLog's own schema comment).
  actorCustomerId?: string;
  action: string;
  entityType: string;
  entityId: string;
  oldValue?: unknown;
  newValue?: unknown;
  reference?: string;
}

/**
 * Single write path for audit log entries (AUD-001 - "who/what/when/old
 * value/new value/reference"). Accepts an optional transaction client so
 * callers can write the audit row atomically alongside the domain change
 * it describes - an audit entry must never exist without (or diverge
 * from) the change it records.
 */
export async function recordAudit(
  db: PrismaClient | Prisma.TransactionClient,
  entry: AuditEntry,
): Promise<void> {
  await db.auditLog.create({
    data: {
      actorType: entry.actorType,
      actorStaffId: entry.actorStaffId,
      actorCustomerId: entry.actorCustomerId,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      oldValue: entry.oldValue as Prisma.InputJsonValue | undefined,
      newValue: entry.newValue as Prisma.InputJsonValue | undefined,
      reference: entry.reference,
    },
  });
}
