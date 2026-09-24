# M16 — Warehouse / Fulfilment Acceptance Criteria

**Spec(s):** `specs/15-warehouse-fulfilment.md`
**Status:** IMPLEMENTED (M16 build, 2026-09-24) — **M16 BUILD COMPLETE,
AWAITING INDEPENDENT REVIEW.** This agent does not self-certify M16.

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
(M16 build, 2026-09-24): full clean-state suite (lint, typecheck, build,
unit, integration — including the full pre-existing M00–M15 suite with
zero regressions, migration-from-zero, seed, Playwright E2E) green. Per
the M16 build instruction's own explicit stop condition, this agent does
**not** self-certify M16 — status is **`M16 BUILD COMPLETE — AWAITING
INDEPENDENT REVIEW`**, and **M17 and beyond remain unauthorized** until a
new, separate, explicit START BUILD instruction. See
`blueprint/DECISION_REGISTER.md` `SEC-001` for the consolidated
pre-production security & privacy gate this build instruction required
be tracked, and `WH-003` for the full state-machine/data-model design
record.
