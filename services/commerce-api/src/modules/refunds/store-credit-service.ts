import type { FastifyInstance } from 'fastify';
import { Prisma, type PrismaClient, type StoreCreditAccount } from '@fcp/db';
import { ValidationError, ConflictError } from '@fcp/shared';
import { recordAudit } from '../audit/service.js';
import type { CartOwnerIdentity } from '../cart/identity.js';

export interface IssueStoreCreditInput {
  identity: CartOwnerIdentity;
  amount: number;
  reason: string;
  referenceType?: string;
  referenceId?: string;
  idempotencyKey: string;
  actorStaffId?: string;
}

/**
 * Store credit ledger (REF-002, specs/33-store-credit-gift-cards.md).
 * A separate financial/customer-balance concept from loyalty
 * (specs/22-loyalty.md) - structurally distinct tables (StoreCreditAccount/
 * StoreCreditEntry never share a table with any loyalty model), and this
 * service never writes to the loyalty ledger, nor does anything in the
 * loyalty domain (which doesn't exist in this codebase yet - M23 remains
 * unauthorized) ever call this one.
 *
 * Ledger discipline mirrors ADR-0012 (inventory) at the scale this
 * concept actually needs: `StoreCreditAccount.balance` is a denormalized
 * cache, always mutated in the SAME transaction as, and by the exact
 * amount of, the `StoreCreditEntry` row that justifies it - the entry is
 * the source of truth, the balance is a read optimization kept in
 * lockstep, never independently written.
 *
 * Only ISSUE exists (see the StoreCreditEntryType schema comment) - this
 * service has no redeem/expire method because no checkout-redemption or
 * expiry flow exists yet (REF-002: store credit does NOT expire - there
 * is deliberately no expiry job anywhere in this codebase to remove).
 */
export class StoreCreditService {
  constructor(private readonly fastify: FastifyInstance) {}

  private get prisma(): PrismaClient {
    return this.fastify.prisma;
  }

  /**
   * Row-locks (creating if absent) the StoreCreditAccount for an identity.
   * MUST run inside a transaction - same idiom as
   * InventoryService.lockBalance: locking BEFORE reading/incrementing the
   * cached balance is what makes two concurrent issuances to the SAME
   * account (e.g. two returns on the same customer's different orders,
   * QC-passed within the same second) serialize correctly instead of
   * racing a lost update.
   *
   * Deliberately does NOT catch a unique-constraint violation on the
   * `create()` call itself - once ANY statement inside a Postgres
   * transaction fails, the ENTIRE transaction is aborted and every
   * subsequent statement in that same transaction (including a recovery
   * SELECT) fails with 25P02 "current transaction is aborted" - there is
   * no way to recover mid-transaction the way a P2002 catch-and-resolve
   * can elsewhere in this codebase (those all catch OUTSIDE their
   * `$transaction` call, never inside the callback). A concurrent
   * first-ever-account race is instead handled by `issue()` retrying the
   * WHOLE transaction once, after the loser's rollback and the winner's
   * commit - see that method's own docblock.
   */
  private async lockOrCreateAccount(tx: Prisma.TransactionClient, identity: CartOwnerIdentity): Promise<StoreCreditAccount> {
    if (!identity.customerId && !identity.guestSessionId) {
      throw new ValidationError('A store credit account requires either a customerId or a guestSessionId');
    }

    const existingId = identity.customerId
      ? await tx.storeCreditAccount.findUnique({ where: { customerId: identity.customerId }, select: { id: true } })
      : await tx.storeCreditAccount.findUnique({ where: { guestSessionId: identity.guestSessionId }, select: { id: true } });

    const accountId = existingId
      ? existingId.id
      : (
          await tx.storeCreditAccount.create({
            data: { customerId: identity.customerId ?? null, guestSessionId: identity.guestSessionId ?? null },
            select: { id: true },
          })
        ).id;

    const rows = await tx.$queryRaw<StoreCreditAccount[]>`
      SELECT * FROM "store_credit_accounts" WHERE "id" = ${accountId} FOR UPDATE`;
    return rows[0]!;
  }

  /**
   * Issues store credit (REF-001's COD-refund mechanism, EXC-002's
   * lower-cost-exchange settlement). Idempotent per `idempotencyKey` - a
   * retried triggering event (retried webhook, duplicated cancellation
   * request) must never issue store credit twice (specs/33's own explicit
   * requirement). The unique constraint on `StoreCreditEntry.idempotencyKey`
   * is the authoritative guard; the pre-check below is a cheap fast path.
   *
   * Retries the whole transaction (at most once) on a P2002 that is NOT
   * the entry's own idempotencyKey - i.e. a genuinely concurrent
   * first-ever-account-creation race for the same identity (two
   * DIFFERENT refunds for the same guest/customer, settling at the same
   * instant - caught by this method's own adversarial test during M20's
   * build). The loser's transaction has, by definition, already rolled
   * back completely by the time Prisma surfaces the error, so a fresh
   * transaction is a correct, safe retry: it will find the winner's
   * now-committed account via `findUnique` instead of racing `create()`
   * again.
   */
  async issue(input: IssueStoreCreditInput) {
    if (input.amount <= 0) throw new ValidationError('Store credit amount must be positive');
    if (!input.idempotencyKey?.trim()) throw new ValidationError('An idempotency key is required');

    const prior = await this.prisma.storeCreditEntry.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
    if (prior) return prior;

    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return await this.prisma.$transaction(async (tx) => {
          const account = await this.lockOrCreateAccount(tx, input.identity);

          const entry = await tx.storeCreditEntry.create({
            data: {
              accountId: account.id,
              type: 'ISSUE',
              amount: input.amount,
              reason: input.reason,
              referenceType: input.referenceType,
              referenceId: input.referenceId,
              idempotencyKey: input.idempotencyKey,
              actorStaffId: input.actorStaffId,
            },
          });

          await tx.storeCreditAccount.update({
            where: { id: account.id },
            data: { balance: { increment: input.amount } },
          });

          await recordAudit(tx, {
            actorType: input.actorStaffId ? 'STAFF' : 'SYSTEM',
            actorStaffId: input.actorStaffId,
            action: 'store_credit.issue',
            entityType: 'StoreCreditEntry',
            entityId: entry.id,
            newValue: { amount: input.amount, reason: input.reason, referenceType: input.referenceType, referenceId: input.referenceId },
            reference: input.referenceId,
          });

          return entry;
        });
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          const target = (err.meta?.target as string[] | string | undefined) ?? [];
          const onIdempotencyKey = Array.isArray(target) ? target.includes('idempotencyKey') : target === 'idempotencyKey';
          if (onIdempotencyKey) {
            const winner = await this.prisma.storeCreditEntry.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
            if (winner) return winner;
            throw new ConflictError('This idempotency key was already used for a different store-credit entry');
          }
          // Account-creation race - retry once (see docblock above).
          if (attempt === 0) continue;
        }
        throw err;
      }
    }
    throw new ConflictError('Could not issue store credit due to a repeated concurrent account-creation race');
  }

  async getBalanceForIdentity(identity: CartOwnerIdentity): Promise<{ balance: number; entries: unknown[] }> {
    const account = identity.customerId
      ? await this.prisma.storeCreditAccount.findUnique({ where: { customerId: identity.customerId }, include: { entries: { orderBy: { createdAt: 'desc' } } } })
      : identity.guestSessionId
        ? await this.prisma.storeCreditAccount.findUnique({ where: { guestSessionId: identity.guestSessionId }, include: { entries: { orderBy: { createdAt: 'desc' } } } })
        : null;
    if (!account) return { balance: 0, entries: [] };
    return { balance: Number(account.balance), entries: account.entries };
  }
}
