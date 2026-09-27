# End-to-End Commerce Flows — Automated Acceptance Scenarios

**Purpose:** The definitive set of cross-domain E2E scenarios future
automated tests must implement (Playwright for customer-facing flows,
API-level integration tests for backend-only flows). Each flow lists
preconditions, steps, and pass/fail assertions. These are referenced
from every relevant `acceptance/mNN-*.md` document and are the primary
input to `acceptance/m33-e2e-certification.md`.

**None of these flows are implemented yet** — this document specifies
what must be built and automated once implementation is authorized. No
test code exists as of this writing.

---

## FLOW 1 — Supplier → PO → Approval → GRN → QC → Inventory Available

**Preconditions:** Supplier exists; Style/SKU exists.
**Steps:**
1. Create a PO for 100 units of a SKU against the supplier, above the
   approval threshold.
2. Attempt to approve as the same user who submitted → **rejected**.
3. Approve as a second, authorized user → PO `approved`.
4. Receive 60 units via GRN, all QC-pass.
5. Receive remaining 40 units via a second GRN, all QC-pass.
**Assertions:** PO reaches `fully_received`. Inventory ledger shows two
`receipt` transactions totaling 100 units. `AVAILABLE` for the SKU
increases by exactly 100. Every step is audited.

## FLOW 2 — Product → Enrichment → Pricing → Publish → Search → PLP → PDP

**Preconditions:** Brand exists.
**Steps:**
1. Create a Style in `draft`, add required attributes, size chart,
   media.
2. Move to `ready_for_enrichment` → `ready_for_qa`.
3. Set MRP + selling price.
4. Merchandiser publishes.
**Assertions:** Product is indexed in search within the target latency;
appears correctly in PLP with correct price/availability; PDP renders
with correct structured data, size chart, and media gallery.

## FLOW 3 — Customer → Cart → Checkout → Inventory Reservation → Prepaid Payment → Order → Allocation

**Preconditions:** Published, in-stock SKU.
**Steps:**
1. Guest adds item to cart (assert: no reservation created).
2. Proceeds to checkout, enters address, PIN serviceable.
3. Checkout begins → reservation created.
4. Completes Razorpay payment (sandbox) → `captured`.
**Assertions:** Order reaches `confirmed`, inventory `allocation`
transaction posted, invoice generated, notification sent. Reservation
never existed before step 3.

## FLOW 4 — COD Order

**Preconditions:** Published, in-stock SKU; COD-eligible PIN code.
**Steps:**
1. Guest checkout selecting COD as payment method.
2. Order accepted.
**Assertions:** Inventory is committed/reserved **at order acceptance**
(not merely at checkout start) — verify the reservation transaction's
timestamp/trigger matches order acceptance, not cart/checkout-start.
Payment state is `initiated -> confirmed` (no `captured` state used).
Order proceeds to allocation identically to the prepaid path from that
point forward.

## FLOW 5 — Payment Failure → Reservation Release

**Preconditions:** Published, in-stock, low-stock (e.g., 1 unit) SKU.
**Steps:**
1. Checkout begins → reservation created.
2. Simulate Razorpay payment failure.
3. Wait for (or fast-forward) the configured reservation timeout.
**Assertions:** Reservation is released; `AVAILABLE` returns to its
pre-checkout value; a second customer can now successfully reserve and
purchase the same unit.

## FLOW 6 — Last-Unit Concurrency / Oversell Prevention

**Preconditions:** SKU with exactly 1 unit `AVAILABLE`.
**Steps:**
1. Simulate two customers initiating checkout for that SKU at
   effectively the same instant (concurrent requests).
**Assertions:** Exactly one reservation succeeds; the other receives an
immediate, clear out-of-stock response. The inventory ledger contains
exactly one `reservation` transaction for that unit — never two. This
test **must** run under genuine concurrency (parallel requests), not
sequential simulation.

## FLOW 7 — Partial Cancellation

**Preconditions:** Multi-line order, `confirmed`, pre-shipment.
**Steps:**
1. Customer cancels one line of a two-line order.
**Assertions:** Cancelled line's inventory is released via ledger
entry; its portion of the payment is refunded using its original
transaction value; the remaining line proceeds unaffected through
fulfilment.

## FLOW 8 — Pick → Pack → Ship → Deliver

**Preconditions:** Order `allocated`.
**Steps:**
1. Generate pick list, pick items.
2. Pack (including a split-shipment case: pack and ship one line
   before the other is ready).
3. Ship via carrier adapter (mock/sandbox).
4. Mark delivered (via webhook or manual confirmation).
**Assertions:** Order state progresses correctly through each stage;
inventory posts the `sale/fulfilment` transaction at the defined
trigger point; customer sees correct tracking status at each stage,
including two independently-tracked shipments for the split case.

## FLOW 9 — Return → Warehouse QC → Prepaid Refund

**Preconditions:** Order `delivered`, within return window, prepaid.
**Steps:**
1. Customer initiates return with mandatory reason.
2. Reverse pickup scheduled and completed.
3. Warehouse receives, QC passes.
**Assertions:** Inventory posts `return_received` then `return_qc_pass`
then `receipt` (restock); refund issues to original payment method
using the **original transaction price**; credit note generated;
customer notified at each stage.

## FLOW 10 — COD Return → Store Credit

**Preconditions:** Order `delivered`, within return window, COD.
**Steps:**
1. Customer initiates return; QC passes.
**Assertions:** Refund issues as **store credit** (never bank/UPI
transfer for a COD order); store-credit ledger entry references the
originating return; store credit does not expire.

## FLOW 11 — Size Exchange

**Preconditions:** Order `delivered`, within exchange window;
replacement size in stock.
**Steps:**
1. Customer requests exchange to a different size, same price.
**Assertions:** Replacement SKU reserved at request time; original SKU
released on return receipt+QC; no payment/credit settlement needed
(equal price); Exchange entity links both sides of the transaction.

## FLOW 12 — Colour Exchange

**Preconditions:** Same as FLOW 11, different colour requested.
**Steps:** Same shape as FLOW 11, substituting colour for size.
**Assertions:** Same as FLOW 11.

## FLOW 13 — Exchange Requiring Additional Payment

**Preconditions:** Replacement SKU costs more than the original.
**Steps:**
1. Customer requests exchange to the higher-priced replacement.
2. Completes the online payment-difference flow.
**Assertions:** Exchange does not complete until payment succeeds;
payment-difference collection is idempotent; on success, replacement
SKU allocation proceeds and original SKU is released on return
receipt.

## FLOW 14 — Exchange Producing Store Credit

**Preconditions:** Replacement SKU costs less than the original.
**Steps:**
1. Customer requests exchange to the lower-priced replacement.
**Assertions:** Price difference is issued as store credit,
idempotently, linked to the Exchange entity.

## FLOW 15 — RTO

**Preconditions:** Order `out_for_delivery`.
**Steps:**
1. Simulate repeated failed delivery attempts up to the configured
   limit.
2. Carrier reports RTO.
**Assertions:** Order transitions to RTO state. For a prepaid order:
refund flow triggers automatically. For a COD order: closure without
refund (no payment was ever collected). Inventory posts `receipt` once
stock is physically confirmed back at the warehouse (subject to QC
disposition).

## FLOW 16 — Partial Return / Refund

**Preconditions:** Multi-line delivered order.
**Steps:**
1. Customer returns one line only.
2. Return passes QC.
**Assertions:** Only the returned line's original transaction value is
refunded; the rest of the order is unaffected; shipping-cost/promotion
apportionment (if applicable) is computed consistently with the
documented rule, not ad hoc.

## FLOW 17 — Loyalty Earn / Redeem / Reverse / Expire

**Preconditions:** Loyalty program active; customer has an order
history.
**Steps:**
1. Place a qualifying order → points earn.
2. Redeem points on a subsequent order.
3. Cancel a different, separate order that had earned points → points
   reverse.
4. Fast-forward (or time-manipulate) past the configured expiry period
   for a third batch of unused points.
**Assertions:** Each of earn/redeem/reverse/expire produces a distinct,
correctly-typed ledger transaction; balance is always correctly
derivable from the ledger; reversal and expiry each occur exactly once
per triggering event (no double-reversal on a retried cancellation).

**M23 implementation note (2026-09-27):** EARN triggers at order
**confirmation**, not delivery — this flow's original "place and
deliver" wording predates implementation. Triggering EARN at delivery
would make step 3 (cancellation reversal) structurally unreachable for
any order that ships, since M18's certified invariant already forbids
cancelling a shipped/delivered line — see `LOY-002`'s implementation
note in `blueprint/DECISION_REGISTER.md` for the full reasoning. Proven
end to end (steps 1-3 in the browser via `test/e2e-storefront/
loyalty.spec.ts`; step 4 against the real database plus the real
staff-gated `POST /api/v1/loyalty/sweep/expire` route in that same
spec's second test) and adversarially at the integration level
(`test/integration/loyalty.test.ts`, including genuine-concurrency
proofs for both the checkout redemption race and a double-fired expiry
sweep).

**LOY-006 vesting-lifecycle repair note (2026-09-27):** step 1's EARN
now only CALCULATES the point entitlement, PENDING — it is not
redeemable until the line is delivered and its return/exchange window
closes. This flow's own E2E test (`test/e2e-storefront/loyalty.spec.ts`)
was updated to genuinely drive that lifecycle: after step 1, the line
is delivered via the real staff pick/pack/ship/deliver routes, its
delivery date is backdated past the configured return window (the same
documented time-manipulation idiom the expiry step already used, since
waiting out a real window is not meaningful for a browser test), and
the real staff-gated vesting sweep (`POST /api/v1/loyalty/sweep/vest`)
is called before step 2 redeems the now-genuinely-available points.
Step 3's cancellation now targets step 2's own order (still PENDING,
since it was never delivered) — the normal pre-vesting cancellation
path — and asserts the balance-affecting reversal is truthfully zero
(nothing was ever credited) while the full required-reversal amount is
still recorded. See `specs/22-loyalty.md`'s `## LOY-006 RESOLUTION`
section and `acceptance/m23-loyalty.md`'s vesting-lifecycle test matrix
for the complete design record.

## FLOW 18 — Coupon + Compatible Promotion + Loyalty + Store Credit

**Preconditions:** An active automatic promotion; a coupon marked
compatible with it; customer has real earned loyalty points and a
store-credit balance; both the automatic promotion and the coupon are
marked compatible with loyalty redemption and store credit
(`Promotion.loyaltyCompatible`/`storeCreditCompatible`).
**Steps:**
1. Add items to cart triggering the automatic promotion.
2. Apply the compatible coupon.
3. Apply loyalty points at checkout.
4. Apply store credit at checkout.
**Assertions:** All four discounts/credits apply correctly together
per the configured stacking AND cross-domain compatibility rules;
attempting to also apply an incompatible second coupon is rejected
with a clear reason while the first remains applied; attempting to
combine an incompatible promotion with loyalty redemption or store
credit is rejected with a clear reason naming the promotion and the
conflicting value system; final charged amount is arithmetically
correct across all four reductions.

**M24 implementation note (2026-09-27):** proven end to end in
`test/e2e-storefront/promotions.spec.ts` — a real mobile-OTP sign-in
drives an automatic 10%-off promotion applying with no code, then an
incompatible coupon (sharing the automatic promotion's `stackGroup`)
being rejected in the browser with a "cannot be combined" message
while the automatic promotion's own discount line remains visible,
then a compatible coupon (a different `stackGroup`) successfully
stacking with it (combined discount amount explicitly waited for
before any total is read, since the real preview re-fetch is
debounced/network-backed and the "applied" chip appears optimistically
sooner), then store credit applied on top, then a real COD order
placed. Server-side, verified via Prisma that exactly the two
compatible `PromotionRedemption` rows exist for the resulting order
(never the rejected one), and that the confirmation page's
`amountPayable` equals `grandTotal` minus the applied store credit,
computed from the UI's own displayed numbers — 1/1 passing.

**LOY-006 vesting-lifecycle repair note (2026-09-27):** the loyalty-
seed purchase this flow's E2E test places (`test/e2e-storefront/
promotions.spec.ts`) now earns PENDING, not immediately-available,
points. The test was updated to genuinely deliver that line, backdate
its delivery past the return window, and call the real staff-gated
vesting sweep (`POST /api/v1/loyalty/sweep/vest`) before redeeming -
this flow continues to prove genuine loyalty+promotion stacking using
real, actually-available points, never the now-obsolete
immediately-available assumption. See `specs/22-loyalty.md`'s
`## LOY-006 RESOLUTION` section.

**M24/M25 independent-review certification-repair note (2026-09-27,
Blocker 2):** the original flow above never actually proved loyalty
redemption combined with a promotion at all — a genuine gap, since the
approved requirement ("loyalty redemption and store credit MAY combine
with promotions SUBJECT TO configurable eligibility/stacking rules")
was only ever enforced/tested for store credit. FLOW 18 is now
genuinely "Coupon + Compatible Promotion + Loyalty + Store Credit":
before the scenario above, the same signed-in customer places a
SEPARATE real COD purchase (a different, higher-priced product) that
genuinely EARNS loyalty points — never a fabricated balance — then, in
the main scenario, redeems those real points through the checkout
page's own "Points to redeem" input alongside the coupon, the
automatic promotion, and store credit, all at once. Server-side,
verified via Prisma that a real `REDEEM` `LoyaltyLedgerEntry` was
posted for the resulting order and that the confirmation page's
`amountPayable` equals `grandTotal` minus the loyalty redemption value
minus the applied store credit — 1/1 passing. See
`test/integration/promotions.test.ts` tests #18–#24 for the full
adversarial cross-domain compatibility matrix (compatible/incompatible
× automatic promotion/coupon × loyalty/store-credit) this flow's own
E2E scenario is backed by.

## FLOW 19 — Unauthorized Admin Action Blocked

**Preconditions:** Authenticated sessions for at least: Warehouse
Operator, Catalog, Marketing roles.
**Steps:** Each role attempts, via direct API call (not just UI), an
action outside its permission:
1. Warehouse Operator attempts a Finance-only action (e.g., approve a
   high-value PO).
2. Catalog role attempts to issue a refund.
3. Marketing role attempts a manual inventory adjustment.
**Assertions:** Every attempt is rejected **server-side** with 403 (or
equivalent), regardless of what the UI would or wouldn't render. Each
denied attempt is logged.

## FLOW 20 — Inventory Adjustment Audited

**Preconditions:** Authenticated Warehouse Manager and Finance
sessions.
**Steps:**
1. Warehouse Manager submits a manual inventory adjustment below the
   Finance co-approval threshold, with justification.
2. Warehouse Manager submits a manual inventory adjustment above the
   threshold, with justification.
**Assertions:** Step 1 completes with Warehouse Manager authorization
alone. Step 2 is held pending Finance co-approval and only completes
after it. Both adjustments are fully audited (who/what/when/old
value/new value/reference); an adjustment submitted **without** a
justification field is rejected in both cases.

---

## Cross-flow requirements

- Every flow above that touches payment, refund, store credit, or
  loyalty **must** include a duplicate-event variant (replay the
  triggering webhook/request) asserting the operation is idempotent —
  this is not optional polish, per `specs/13-payment.md` `PAY-003` and
  the financial-integrity requirements throughout `/acceptance`.
- Every flow must be automatable against a running local Docker
  Compose stack (`DEPLOYMENT.md`) using sandbox/mock external
  providers (Razorpay test mode, mock carrier adapter) — none may
  depend on a live third-party production service to run in CI.
