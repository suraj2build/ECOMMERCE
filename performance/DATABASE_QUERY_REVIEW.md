# Database Query / Index Review (M32 Performance/Scale, 6A)

## Method

Reviewed the Prisma query shape of every explicitly-named hot path
(`acceptance/m32-performance-load.md`: PLP/search browsing, PDP views,
cart/checkout, order placement, inventory availability, order lookup)
by reading the actual service code, then ran `EXPLAIN ANALYZE` against
a representative-scale seeded catalog to get real query plans - not
speculative index additions. Dataset: 2,000 styles x 2 colours x 4
sizes = 16,000 SKUs, 16,000 inventory-balance rows (see
`packages/db/prisma/perf-seed.ts` for the generator and the scale
rationale documented in its own header comment - the lower half of the
approved 10,000-50,000 SKU range, sized to this sandbox's fixed
resource allowance rather than its upper bound).

## Confirmed fast, properly indexed (no change needed)

| Query | Plan | Time |
|---|---|---|
| `SELECT * FROM styles WHERE id = ?` (PDP style lookup) | Index Scan on `styles_pkey` | 0.071ms |
| `SELECT * FROM skus WHERE styleId = ? AND isActive` (PDP variant list) | Bitmap Index Scan on `skus_styleId_idx` | 0.072ms |
| `SELECT count(*) FROM styles WHERE lifecycleState = 'PUBLISHED'` | Index Only Scan on `styles_lifecycleState_idx` | 0.359ms |
| `SELECT ... FROM inventory_balances WHERE skuId=? AND locationId=? FOR UPDATE` (the M06 reservation row-lock - the single most concurrency-critical query in this codebase) | Index Scan on the composite PK `inventory_balances_pkey` | 0.096ms |
| `InventoryService.getAvailableToSellBySku` (`groupBy` on `skuId IN (...)`, PDP availability) | Seq Scan on `inventory_balances` (16,015 rows) -> Hash Join | 5.3ms |

The `getAvailableToSellBySku` seq-scan is a genuinely CORRECT planner
choice at this scale, not a missing index: the query pulls a small
number of matching rows (one style's SKUs) out of a still-small table
(16k rows fits in a handful of disk pages), and Postgres's own cost
model correctly judges a full scan cheaper than N individual index
probes for a hash join's build side. This is exactly the kind of
plan-shape check this review exists to make BEFORE adding a
speculative index - the table's own composite PK `(skuId, locationId)`
already covers the point-lookup path (see the row above), and adding
another index for this groupBy would add write overhead to every
inventory mutation for no measured read benefit at this scale. Revisit
only if `inventory_balances` grows into the hundreds of thousands of
rows (a genuinely different regime) with real measured evidence at that
point, not speculatively now.

## Genuine N+1 findings

### FIXED: `CatalogService.listPublicStyles` (public home/PLP listing)

**Severity: high** - this is the single highest-traffic route in the
entire application (unauthenticated, hit by every visitor). The
original implementation called `getActivePrice(style.id)` ONCE PER
STYLE on the page via `Promise.all` - for the default page size (24,
over-fetched to 48 to account for styles lacking an active price), that
is 48 separate price-lookup queries fired for a single page load.
Under concurrent traffic this multiplies badly: 50 simultaneous PLP
requests would fire ~2,400 individual queries in that instant alone.

Fixed with `CatalogService.getActivePricesByStyleIds` - one batched
query (`WHERE styleId IN (...) AND colourId IS NULL AND ...`), grouped
and sorted in JS using the EXACT SAME specificity/markdown/recency
tie-break logic `getActivePrice` already uses (verified byte-for-byte
identical sort comparator), so behavior is unchanged, only the query
count drops from N to 1. `getActivePrice` itself (the single-style
version, used by PDP/cart/checkout/exchanges/channels, none of which
loop over many styles per request) is untouched.

### FIXED: `OrderService.listOrdersForCustomer` (storefront order history)

**Severity: low-to-moderate, naturally bounded** - called `toView(o.id)`
(a heavy multi-join `findUniqueOrThrow`) once PER order via
`Promise.all`. Unlike the PLP finding, this is NOT attacker-amplifiable
or traffic-amplifiable in the same way - it's bounded by one
customer's own historical order count, which cannot be driven
arbitrarily high without that customer genuinely placing that many real
orders over time. Still a real inefficiency worth closing given how
contained the fix is: extracted the shared include shape
(`ORDER_VIEW_INCLUDE`) and view-builder (`buildOrderView`) out of
`toView`, then `listOrdersForCustomer` now does ONE `findMany` with
that same include and maps every row through the identical builder -
exactly one query regardless of order count. `toView`/`getOrder` (the
single-order path used by order-detail pages) is behaviorally
unchanged - re-verified by `order.test.ts`'s full 32-test suite,
including the "Storefront: customer order history" test that exercises
this exact method, all green.

### Documented, NOT fixed this pass (bounded impact, smallest-safe-repair discipline)

- **`CrossSellService.listCrossSell`** (PDP cross-sell strip): same
  `getActivePrice`-in-a-loop shape, but bounded by `limit` (a small,
  fixed cross-sell count, typically single digits) rather than a full
  page size - materially smaller blast radius than the PLP finding.
  Fired once per PDP view alongside the main PDP query. Recommended
  follow-up: the same `getActivePricesByStyleIds` batching pattern
  applied here, in a future pass.
- **`SearchIndexService`'s reindex loop** (`getActivePrice` per style
  during a full catalog reindex): a background/staff-triggered BATCH
  operation, not a live user-request path - total reindex THROUGHPUT
  matters here, not single-request latency, so this is a lower priority
  than either fixed finding above. Same batching pattern would help a
  future full-catalog reindex complete faster at higher SKU counts.
- **`RazorpayPaymentProvider`'s `console.error` logging call** - not a
  query-performance finding, cross-referenced here only because it was
  found during this same code-reading pass; see
  `security/PAYMENT_SECURITY_REVIEW.md` for the full write-up (a
  logging-hygiene finding, not fixed for the same "would require
  threading a logger through a provider-abstraction boundary" reason).

## Indexing philosophy for this pass

**No speculative index was added anywhere in this review.** Every index
already in the schema (108 `@@index`/`@@unique` declarations, an
already heavily-indexed schema built up over 30+ milestones) that this
review's own EXPLAIN ANALYZE queries touched was confirmed to be
correctly used by the planner. The one query showing a sequential scan
(`getAvailableToSellBySku`) was confirmed CORRECT for its actual data
volume, not a gap - adding an index there would be exactly the kind of
unjustified speculative addition this milestone's own instruction
("any new index must have a demonstrated query reason... do not add
speculative indexes everywhere") explicitly prohibits.
