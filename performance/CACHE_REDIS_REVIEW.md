# Cache / Redis Usage Review (M32 Performance/Scale, 6D)

## Method

Grepped every `fastify.redis`/`this.redis` usage across
`services/commerce-api/src` to enumerate the COMPLETE set of Redis
consumers in this codebase - not a sample, the full list.

## Complete Redis usage inventory

| Consumer | Key pattern | TTL | What it stores | Mutable-truth risk |
|---|---|---|---|---|
| `StaffSessionStore` (`modules/auth/staff-session.ts`) | `staff-session:<sha256(token)>` | `STAFF_SESSION_TTL_SECONDS` (8h default), set via Redis `EX` on write | `{ staffUserId }` only - a session pointer, never business data | None - Postgres (`StaffUser`/`RolePermission`) remains the sole source of truth for WHO the session belongs to and WHAT they can do; `requireStaffAuth` re-resolves permissions from Postgres on every request (see `security/AUTH_SESSION_SECURITY.md`), Redis never caches a permission decision |
| `@fastify/rate-limit` (M31, `plugins/rate-limit.ts`) | `fcp-rl:<key>` (library-managed) | Per-route window (1-15 min, see `plugins/rate-limit.ts`/`auth/routes.ts`) | Request counters only | None - purely a throttling counter, never read back as application data |

**That is the entire Redis footprint of this application.** No product
data, price, inventory balance, cart, checkout session, order, payment
state, or any other financial/business-mutable record is ever cached in
Redis anywhere in this codebase.

## Key ownership

Both consumers above own their own key namespace exclusively
(`staff-session:*`, `fcp-rl:*`) - no key collision risk, no shared
namespace requiring a documented ownership convention beyond what's
already in each module's own code.

## Invalidation

Neither consumer needs an explicit invalidation strategy beyond TTL
expiry: staff sessions are actively `DEL`eted on logout/deactivation
(`StaffSessionStore.revoke`/`revokeAllForUser`) rather than left to
passively expire in the common case; rate-limit counters are
self-resetting per window by design (that's the entire point of a
rate limiter) and never need manual invalidation.

## Failure behavior

- **Staff sessions**: if Redis is unavailable, `StaffSessionStore.resolve`
  fails (the underlying `redis.get` call throws/rejects) - every staff
  request fails closed (no session = no access), never fails open to
  "let everyone in." This is the CORRECT fail-safe direction for an
  authorization-critical store.
- **Rate limiting**: `plugins/rate-limit.ts` sets `skipOnError: true`
  deliberately (see that file's own docblock) - a Redis outage makes
  the rate limiter fail OPEN (requests are allowed through unthrottled)
  rather than 500ing every request platform-wide. This is a
  documented, deliberate availability-over-throttling trade-off for an
  INFRASTRUCTURE failure specifically (not attacker behavior) - the
  correct choice for a secondary defence-in-depth control, the opposite
  of the correct choice for the primary session store above.

## Why no caching layer exists for catalog/pricing/inventory data

This is a DELIBERATE architectural property, not a gap this review is
flagging: `InventoryBalance` (onHand/reserved) is the M06-certified
ledger-authoritative source that the entire platform's oversell-
prevention guarantee depends on - caching it (even with a short TTL)
would reintroduce exactly the staleness risk the row-lock-based
concurrency design (`SELECT ... FOR UPDATE`) exists to eliminate.
`Price`/`Style` lifecycle state changes take effect immediately for
every subsequent read (no cache to invalidate = no propagation delay).
The M32 database-query review (`performance/DATABASE_QUERY_REVIEW.md`)
found the actual bottleneck in this area was query SHAPE (N+1 patterns
in `listPublicStyles`/`listOrdersForCustomer`, now fixed), not missing
caching - the right fix for an N+1 is fewer queries, not caching each
of the N.

## Recommendation for a future pass (not built here)

If real production load ever shows the PDP/PLP read path itself
(after the N+1 fixes) is still a bottleneck, the safe next step would
be a short-TTL (seconds, not minutes) cache of the fully-assembled
PUBLIC read view (not the raw inventory/price rows) - e.g. cache
`listPublicStyles`'s own output for 5-10 seconds - which bounds
staleness to a known, small, product-acceptable window without ever
caching the ledger-authoritative rows themselves. This is a
recommendation for a future, separately-scoped pass with real
production traffic data to size the TTL against, not something this
pass builds speculatively.
