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
1. Place and deliver a qualifying order → points earn.
2. Redeem points on a subsequent order.
3. Cancel a different, separate order that had earned points → points
   reverse.
4. Fast-forward (or time-manipulate) past the configured expiry period
   for a third batch of unused points.
**Assertions:** Each of earn/redeem/reverse/expire produces a distinct,
correctly-typed ledger transaction; balance is always correctly
derivable from the ledger; reversal and expiry each occur exactly once
per triggering event (no double-reversal on a retried cancellation).

## FLOW 18 — Coupon + Compatible Promotion + Store Credit

**Preconditions:** An active automatic promotion; a coupon marked
compatible with it; customer has a store-credit balance.
**Steps:**
1. Add items to cart triggering the automatic promotion.
2. Apply the compatible coupon.
3. Apply store credit at checkout.
**Assertions:** All three discounts/credits apply correctly together
per the configured stacking rules; attempting to also apply an
incompatible second coupon is rejected with a clear reason while the
first remains applied; final charged amount is arithmetically correct
across all three reductions.

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
