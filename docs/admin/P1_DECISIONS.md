# P1 console: open decisions, known limitations, external dependencies

Recorded by the P1 Commerce Operations Console build (2026-09-30). None of
the items below was guessed or implemented; each is left for the Product
Owner or a later, separately authorized pass.

## DECISION_REQUIRED

### D-1 — Customer lookup for loyalty corrections by Finance

- **Decision:** may a role that holds `loyalty:adjust` but not
  `customer_service:manage` (today: FINANCE) look up customers, and with
  which fields?
- **Affected workflow:** Loyalty tools → manual adjustment.
  `POST /loyalty/adjust` needs a customer id; the only customer lookup is
  Customer 360 (`customer_service:manage`). Finance can therefore run the
  loyalty sweeps but cannot find a customer to adjust.
- **Safe options:** (a) keep as is — Customer Service performs manual
  adjustments; (b) grant Finance `customer_service:manage` (exposes the
  full Customer 360 view); (c) add a narrower lookup gated by
  `loyalty:adjust` returning id and name only for an exact mobile match.
- **Why blocked:** it widens customer-data access (DPDP data
  minimization), which is a policy choice, not an engineering one. The
  console shows Finance an explanatory notice instead of a form.

### D-2 — Promotion gift-card compatibility is not settable

- **Decision:** should staff be able to mark a promotion as not combinable
  with gift cards?
- **Affected workflow:** Promotions → create. `Promotion.giftCardCompatible`
  exists (M30) and `PromotionService.createPromotion` accepts it, but the
  `POST /promotions` request schema does not include it, so every promotion
  is created combinable with gift cards (the column default).
- **Safe options:** (a) keep the default for all promotions; (b) add the
  field to the route schema (a one-line M24/M30 route change with a test).
- **Why blocked:** changing a certified route's contract without a
  demonstrated defect is outside P1, and whether gift cards should ever be
  excluded is a commercial choice. The console shows the value read-only.

### D-3 — Manual loyalty deductions are not bounded by the balance

- **Decision:** may a manual negative adjustment take a loyalty balance
  below zero?
- **Affected workflow:** Loyalty tools → manual adjustment.
  `LoyaltyService.manualAdjust` increments `LoyaltyAccount.balance` by the
  signed delta with no floor, and no database constraint prevents a
  negative balance (store credit and gift cards both have one).
- **Safe options:** (a) reject a deduction larger than the available
  balance; (b) cap it at the available balance and record the shortfall,
  as the LOY-006 exceptional-reversal path does; (c) allow negative
  balances as customer debt (the policy LOY-006 explicitly declined to
  invent).
- **Why blocked:** this is the same unresolved question LOY-006 left open
  for the post-vest exceptional path. The console warns the operator to
  check the balance first and does not enforce a rule itself.

### D-4 — Ledger reconciliation cannot check balances that had adjustments

- **Decision:** should manual adjustments record their direction on the
  ledger so reconciliation can replay them?
- **Affected workflow:** Inventory → Reconciliation.
  `InventoryService.reconcileBalance` excludes ADJUSTMENT rows from the
  replay (their quantity is stored unsigned) and reports `matches: true`
  whenever any exist, so any SKU/location that was ever adjusted always
  "matches".
- **Safe options:** (a) keep as is and treat reconciliation as meaningful
  only for never-adjusted balances (the console explains this); (b) store
  the adjustment sign (a schema/ledger change) and replay adjustments.
- **Why blocked:** option (b) changes inventory-ledger semantics, which P1
  must not do. The console shows the service's verdict with the caveat.
- **Independent review (2026-10-01), classification: existing
  inventory-domain defect (M06), not a P1 defect.** Reproduced against
  real Postgres through `InventoryService` itself:

  | Ledger | Stored onHand | Replayed onHand | `matches` |
  |---|---|---|---|
  | RECEIPT 10, ADJUSTMENT 5 (a +5) | 15 | 10 | true |
  | RECEIPT 10, ADJUSTMENT 3 (a −3) | 7 | 10 | true |
  | RECEIPT 10, balance corrupted to 99 | 99 | 10 | false (detected) |
  | same corruption, then one −1 adjustment | 98 | 10 | true (drift hidden) |

  Receipt, reservation/release, allocation and transfer out/in replay
  correctly when no adjustment exists. `postAdjustment` stores
  `Math.abs(quantityDelta)` and `reconcileBalance` skips ADJUSTMENT rows,
  so the schema's own invariant ("InventoryBalance must always equal the
  replay of InventoryTransaction") cannot be checked for any balance that
  was ever adjusted, including pick shortfalls, which post adjustments.
  A repair needs the ledger to record direction: a signed or
  direction column, or separate increase/decrease transaction types. Both
  are schema changes and a change to inventory-ledger semantics, so they
  need Product Owner authorization; nothing was changed.

## Independent review findings (2026-10-01)

Repaired: `GET /admin/products/styles?lifecycleState=` and
`GET /admin/purchase-orders?status=` accepted any string and passed it to
Prisma, so an unknown value answered 500 instead of 400. Both are now
validated as enums (regression test in `admin-queries.test.ts`).

D-1, D-2 and D-3 were re-verified as stated above (D-3 at runtime: a −50
manual adjustment on a zero balance is accepted and leaves −50).

Non-blocking, not changed:

- `InventoryBalance.inTransit` is never written by any code; transfers
  track in-transit stock on the `InventoryTransfer` row. The console's
  "In transit" balance column is therefore always 0. In-transit transfers
  are listed under Inventory → Transfers.
- The reconciliation screen's success banner says the stored balance
  "matches" when the service reports a match, even where adjustments make
  the two columns differ; the note under the table explains why (D-4).
- A NUL byte in a search term answers 500 (Postgres rejects it). This is a
  platform-wide behaviour shared with pre-existing routes such as
  `GET /support/customers/lookup` and `POST /suppliers`; the response is
  the generic safe error body.
- Several lists sort on a non-unique column (`updatedAt`, `createdAt`,
  supplier `name`) without an id tie-break, so rows with identical values
  can shift between pages.
- `GET /admin/catalog/collections` returns at most 200 collections and a
  collection's detail at most 500 styles, without saying when it stops;
  the co-approver picker lists at most 25 people.
- A 401 in the middle of a session shows "Your session has expired" on
  the screen but only returns to the sign-in page on the next full load.

## Known limitations (not business decisions)

- Pre-existing unbounded list routes are used as-is: `GET /promotions`,
  `GET /channels`, `GET /channels/:id/listings`. Returns and exchanges
  queues are capped at 100 by their services.
- Not part of P1: staff user management and MFA enrollment screens (login
  supports an enrolled account's MFA code), tax/GST/invoice/credit-note
  screens, marketing segments and campaigns, shoppable media and review
  moderation, pincode serviceability, search pinning, size charts,
  cross-sell, brand/location administration, return evidence upload by
  staff (viewing is supported).
- The console lists media URLs instead of rendering third-party images.

## External dependencies (unchanged by P1)

- **Carrier (SHIP-001):** only the MOCK/MOCK_SECONDARY test carriers
  exist; production refuses them. Real bookings and tracking need a
  selected carrier.
- **Payment provider:** prepaid refunds and customer-pays exchange
  settlements call Razorpay and need production credentials.
- **Channel providers:** only MOCK channel providers exist; production
  refuses them.
- **Marketing/notification provider (MKT-001):** only the mock provider.
- **Object storage:** return evidence uses the local-disk provider.
- **Tax/compliance (TAX-001–006):** GSTIN, HSN and rate values need a
  qualified professional before production use. Nothing here claims
  GST or DPDP compliance.

## Recorded for P2 (not changed)

- `apps/storefront/src/app/checkout/page.tsx` still says "Online payment is
  coming soon" although the payment domain (M14) exists. This is storefront
  copy, in P2 scope; P1 did not touch it.
