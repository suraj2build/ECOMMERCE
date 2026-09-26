# M16 — Warehouse / Fulfilment Acceptance Criteria

**Spec(s):** `specs/15-warehouse-fulfilment.md`
**Status:** IMPLEMENTED (M16 build, 2026-09-24) — **M16 BUILD COMPLETE,
AWAITING INDEPENDENT REVIEW.** This agent does not self-certify M16.
**2026-09-26 addendum (EXC-004 Option 2 repair):** `PickTask`/
`OrderFulfilment` were generalized (nullable `exchangeId`, a same-row
CHECK on `PickTask` and a cross-table trigger pair for
`OrderFulfilment`) to also serve an Exchange replacement as an
alternate fulfilment source, alongside their original `OrderLine`
anchoring — every acceptance criterion below, and every M16 invariant
it certifies, is unchanged and re-proven green
(`test/integration/warehouse.test.ts`, unmodified, still passes in
full); see `blueprint/DECISION_REGISTER.md` `EXC-004` for the full
design record.

## Business acceptance

- [x] Pick lists can be generated per order/location, and pack
      confirmation triggers the ship handoff. "Warehouse work creation"
      is automatic — one `PickTask` per `OrderLine` is created inside the
      same transaction as order creation (`OrderService.
      createOrderFromCheckoutSession` -> `WarehouseService.
      createPickTasksForOrder`). `GET /api/v1/warehouse/pick-tasks`
      (bounded/paginated, `locationId`/`status`/`orderId` filters) is the
      actionable-work queue. Pack confirmation (`markFulfilmentPacked`)
      is now followed by an explicit `markFulfilmentReadyToShip` hand-off
      step before `markFulfilmentShipped` can run — the "shipment
      hand-off boundary" the M16 build required, without implementing
      M17's own carrier-integration scope.
- [x] Split-shipment packing works — a subset of an order's lines can be
      packed/shipped independently. Unchanged, M15-certified behaviour,
      now gated on M16's own picking step first — proven end to end by
      `test/integration/warehouse.test.ts` scenario N and
      `order.test.ts`'s own "Split shipment (FLOW 8)" describe block
      (updated to pick before pack, still green).

## Functional acceptance

- [x] Pick exception (item missing/damaged at pick) posts an authorized
      inventory adjustment (`InventoryService.postAdjustment`, now
      accepting an external transaction so the adjustment, the `PickTask`
      state change, and the order-exception flag commit atomically) and
      triggers the order-exception path (`OrderLine.status = EXCEPTION`,
      `Order.status = EXCEPTION`) with the existing M15 audit/notification
      surface. See `test/integration/warehouse.test.ts` scenarios G, L, M.

## Data integrity

- [x] Every pick/pack action that consumes inventory posts the
      corresponding ledger transaction — a short/exception pick posts a
      negative `ADJUSTMENT` for the exact shortfall (never a guessed
      partial figure for a full miss); a normal pick posts none (no stock
      movement occurs at pick time, only at ship time, unchanged from
      M15).

## Authorization

- [x] Only Warehouse Operator/Manager roles can record pick/pack
      actions. Four new, independent permissions (`warehouse:read`,
      `warehouse:pick`, `warehouse:pack`, `warehouse:exception:manage`) —
      distinct from `order:fulfil` (M15's own pack/ship/deliver gate,
      unchanged) — granted to `WAREHOUSE_MANAGER`/`WAREHOUSE_OPERATOR` in
      `packages/db/prisma/seed.ts`. Every warehouse route requires
      `requireStaffAuth` + the specific permission; IDOR/BOLA-style
      substitution attempts (guessing another order's/line's id, a
      well-formed-but-nonexistent id, a malformed id, no auth at all) are
      all covered — `test/integration/warehouse.test.ts` scenario K.

## Positive scenarios

1. [x] Standard pick → pack → ready-to-ship → ship handoff for a
   single-location order — `warehouse.test.ts` scenario A plus
   `order.test.ts`'s split-shipment test (now routed through picking).
2. [x] Pick exception on one line of a multi-line order → that line
   routes to exception handling, other lines proceed — proven at the
   `PickTask`/`OrderLine` level (`warehouse.test.ts` scenario G) and
   already-certified at the multi-line-order level by M15's own
   "the remaining line proceeds unaffected" test (`order.test.ts`).

## Negative scenarios / edge cases

1. [x] Attempt to pack more than the allocated quantity for a line →
   blocked at the pick layer itself (`pickedQuantity > allocatedQuantity`
   is rejected with a clean 400 before any state changes,
   `warehouse.test.ts` scenario D) and, for the "short-picked line still
   attempted to pack" case, at the pack layer (`assignLinesToFulfilment`
   requires `PICKED`, rejecting a `SHORT_PICKED`/`EXCEPTION` line,
   `warehouse.test.ts` scenario G).

## Adversarial certification (M16 build instruction §16)

All required scenarios covered by `test/integration/warehouse.test.ts`
(26 tests) plus the updated `order.test.ts` (28 tests, all M15 scenarios
now routed through the real HTTP picking endpoint, not a DB shortcut):
concurrent picker attempts on the same task; duplicate/replayed pick
requests (idempotency, including a fresh-process/no-in-memory-state
replay); pick quantity greater than allocation; picking a cancelled
line (both the normal cancel-then-pick-attempt path and a raw-DB-write
defense-in-depth path); pack without pick; a short-picked line rejected
at pack time; duplicate pack / already-assigned line; concurrent packing
of the same line (row-locked, deterministic winner+conflict — see the
concurrency-hardening note below); wrong order/line relationship;
unauthorized warehouse operation and IDOR/BOLA substitution; insufficient/
corrupted inventory state interacting with a pick-exception adjustment;
transactional rollback on partial failure (no partial `PickTask`/
`OrderLine`/ledger/audit trace after a rejected pick); split fulfilment
correctness; retry after a network-equivalent duplicate request; and an
explicit "never silently substitutes another SKU" proof.

**Concurrency-hardening finding (caught by this milestone's own
adversarial test suite, fixed in the same pass):**
`OrderService.assignLinesToFulfilment` (M15-original) read order-line
eligibility via a plain `findMany`, not a row lock — under genuine
concurrency (two staff members packing the same line at the same
instant) this could let both requests pass the eligibility check before
either committed. Fixed with a `SELECT ... FOR UPDATE` row lock on every
candidate line (the same idiom `InventoryService.lockReservation`/
`lockBalance` and `WarehouseService`'s own `lockPickTask` already use),
making the outcome deterministic: exactly one 201, the other a clean 409.
A second, smaller bug in `WarehouseService.recordPickOutcome`'s own
"line was cancelled underneath this pick attempt" branch was also caught
and fixed the same way — a Prisma transaction that both writes a state
change and throws rolls the write back too, so the original version was
throwing away the very `CANCELLED` marking it just wrote; fixed by
committing the state change first and throwing only after the
transaction returns.

## Independent-review repair pass (2026-09-24): shipment concurrency / inventory integrity

**Finding:** an independent reviewer of the pushed M16 implementation
found that `OrderService.markFulfilmentShipped` (and, by the same
pattern, `markFulfilmentPacked`/`markFulfilmentReadyToShip`/
`markFulfilmentDelivered`) read the target `OrderFulfilment` via a plain
`findUniqueOrThrow`, not a row lock, before checking its eligibility
status. Two genuinely concurrent SHIP requests on the same fulfilment
could both observe `READY_TO_SHIP` before either transaction committed.
`InventoryService.recordSale()`'s own reservation/balance locking does
not by itself prove exactly-once SALE posting for an `OrderLine`: a
`CONVERTED` reservation continues to satisfy `recordSale`'s quantity
check on a second call, and if aggregate reserved stock for the same
SKU/location exists from *other* orders, a naive test could pass by
coincidence rather than by genuine exactly-once semantics.

**Root cause:** the fulfilment's own status field — the actual
eligibility gate every transition method checks — was never locked
before being read, so the read-check-write sequence was not atomic
across concurrent callers.

**Repair (primary):** a new `OrderService.lockFulfilment` private helper
(`SELECT ... FOR UPDATE` on `order_fulfilments`, the same idiom
`InventoryService.lockReservation`/`lockBalance` and
`WarehouseService.lockPickTask` already use) is now the FIRST thing all
four fulfilment transition methods do, before reading `status`. A second
concurrent caller's lock acquisition genuinely blocks until the first
transaction commits, then re-reads the now-advanced status through the
same lock and takes its own pre-existing "not eligible from this status"
rejection branch — never a blind concurrent double-transition. This
closes the race at every one of PENDING→PACKED, PACKED→READY_TO_SHIP,
READY_TO_SHIP→SHIPPED, and SHIPPED→DELIVERED, not just the SHIP step the
review specifically flagged (M16 build instruction §5's own explicit
request to review adjacent transitions).

**Repair (defence-in-depth, exactly-once SALE):** a new partial unique
index, `inventory_transactions_sale_orderline_once`
(`CREATE UNIQUE INDEX ... ON inventory_transactions (referenceId) WHERE
type = 'SALE' AND referenceType = 'ORDER_LINE'`, migration
`20260924145356_add_sale_orderline_uniqueness`), makes it impossible at
the database level for more than one legitimate SALE row to ever exist
for a given `OrderLine` — enforced independently of whatever caller-side
locking is or isn't in place. Deliberately scoped narrow (not a blanket
constraint across every ledger reference) because a single multi-line
GRN legitimately posts multiple `RECEIPT` transactions sharing the same
`referenceId` (the GRN's own id) — a blanket constraint would have broken
that unrelated, correct pattern. `InventoryService.recordSale()` catches
the resulting unique-violation and rethrows it as an explicit
`InventoryIntegrityError` (409 `INVENTORY_INTEGRITY_VIOLATION`), never a
raw/opaque 500; the whole transaction rolls back, so a rejected duplicate
leaves no partial trace. There is no "legitimate retry" concept for a
sale (unlike a payment webhook redelivery) — a duplicate is always a
bug/race and is never silently absorbed or re-applied.

**Database constraint/migration:** yes — `20260924145356_add_sale_orderline_uniqueness`
(a hand-written partial unique index, the same category as the
hand-written `CHECK` constraints already in
`20260922171222_add_integrity_constraints` — not representable in
`schema.prisma`'s declarative DSL). Applied cleanly against a
freshly-dropped-and-recreated database as part of the full 15-migration
history from zero.

**Adversarial tests added** (`test/integration/order.test.ts`, "Shipment
inventory invariant hardening" and new "Adjacent fulfilment transition
concurrency" describe blocks):
- Test G: the exact scenario the review specified — Order A (reserved
  quantity 1) and an unrelated Order B (reserved quantity 5) share the
  same SKU/location, so aggregate reserved stock stays comfortably
  positive even after Order A ships; two genuinely concurrent
  (`Promise.allSettled`) SHIP requests on Order A's `READY_TO_SHIP`
  fulfilment prove all nine required invariants: exactly one accepted
  transition, `SHIPPED` fulfilment/line status, exactly one SALE ledger
  row for Order A's line (zero for Order B's), `onHand`/`reserved`
  decremented exactly once each, Order B's reservation fully intact,
  no negative inventory value, and exactly one `ship` audit entry.
- Test H: calls `InventoryService.recordSale()` directly, twice, for the
  same `OrderLine` — bypassing `OrderService`/the fulfilment lock
  entirely — proving the database-level uniqueness invariant stands on
  its own, not merely as an artefact of the row-lock fix.
- Two new tests in "Adjacent fulfilment transition concurrency": two
  concurrent pack attempts on the same `PENDING` fulfilment, and two
  concurrent deliver attempts on the same `SHIPPED` fulfilment — each
  proving exactly one 200/one clean 400 and exactly one audit entry.
- Test F's pre-existing concurrent-double-ship assertions were tightened
  from `[400, 409]` (either outcome was previously possible depending on
  timing) to a deterministic `400` for the loser, since the row lock now
  makes the outcome deterministic rather than timing-dependent.

No existing test was deleted, skipped, or weakened. Full regression
(unit 8/8, integration 302/302 across 26 files — 298 pre-existing + 4
new, zero regressions, warehouse.test.ts's 26 tests independently
re-verified unaffected, order.test.ts's full 32-test suite stable across
5 repeated runs, migration-from-zero with all 15 migrations, Playwright
E2E 18/18 desktop+mobile) all green. Still `M16 BUILD COMPLETE —
AWAITING INDEPENDENT REVIEW` — this repair pass does not self-certify
M16 either.

## Test requirements

- [x] E2E: `acceptance/e2e-commerce-flows.md` FLOW 8. Not re-exercised
      through the browser E2E suite in this pass (FLOW 8 is a staff-only
      backend workflow with no dedicated storefront UI — M15's own
      `pack`/`ship`/`deliver` routes were never given a storefront E2E
      spec either, since there is no warehouse-facing UI in this build;
      the full HTTP-layer integration coverage above is the real proof of
      correctness for a staff API with no browser surface yet).

## Definition of Done

All boxes above checked. **IMPLEMENTED, TESTED, ENGINEERING_VERIFIED**
(M16 build, 2026-09-24; independent-review repair pass, 2026-09-24 —
see the dedicated section above): full clean-state suite (lint,
typecheck, build, unit, integration — including the full pre-existing
M00–M15 suite with zero regressions, migration-from-zero across all 15
migrations, seed, Playwright E2E desktop+mobile) green after the repair.
Per the M16 build instruction's own explicit stop condition, this agent
does **not** self-certify M16 — status remains **`M16 BUILD COMPLETE —
AWAITING INDEPENDENT REVIEW`**, and **M17 and beyond remain unauthorized**
until a new, separate, explicit START BUILD instruction. See
`blueprint/DECISION_REGISTER.md` `SEC-001` for the consolidated
pre-production security & privacy gate this build instruction required
be tracked, and `WH-003` for the full state-machine/data-model design
record.
