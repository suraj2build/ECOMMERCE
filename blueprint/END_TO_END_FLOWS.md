# End-to-End Business Flow Map

**Status update (2026-09-22):** This document was originally written
during the pre-decision Blueprint V2 audit, when every flow below
depended on genuinely unresolved decisions marked **UNDEFINED**. The
Product Owner's 2026-09-22 decision session resolved nearly all of
them (105 of 112 registered decisions are now `DECIDED`). This
document has been updated in place: every `UNDEFINED` marker below now
reads either **DECIDED** (with the resolution and its decision ID) or,
for the small remaining set of compliance-verification items,
**UNDER_REVIEW** (never treated as settled). **For the current,
authoritative, testable version of these same 20 flows** (this
document's original 17 plus 3 more), see
`acceptance/e2e-commerce-flows.md` — that document is the one future
automated tests implement. This document remains useful as the
original cross-domain trigger/actor/impact analysis that justified
each flow's decision priorities.

**Purpose:** A complete cross-domain workflow map for the platform's
primary flow and its exception/post-purchase flows. For each flow:
trigger, actor, preconditions, major state transitions, systems/domains
touched, inventory impact, payment impact, customer impact, audit
requirements, and decision status.

---

## Part 1 — Primary flow

### 1. Supplier → Purchase Order → Approval

- **Trigger:** Buyer creates a PO against a supplier for a set of
  styles/colors/sizes.
- **Actor:** Buying role (`ADM-001` — **DECIDED**, role list finalized).
- **Preconditions:** Supplier exists and is active (`specs/03`); styles
  exist in Product Master or are created alongside the PO.
- **Major state transitions:** `draft -> submitted -> approved |
  rejected` (approval hierarchy: **DECIDED**, `PO-001` — approval
  workflow required, configurable value-based thresholds).
- **Systems touched:** Suppliers, Purchase Orders, Product Master
- **Inventory impact:** None yet — a PO is a commitment, not a ledger
  event (ADR-0012).
- **Payment impact:** None directly (may create an accounts-payable
  commitment — out of current scope; not modeled in `/specs`).
- **Customer impact:** None (internal-only flow).
- **Audit requirements:** Full approval trail (who approved, when, at
  what threshold) — feeds `specs/30-audit-compliance.md`.
- **Decision status:** `PO-001`, `SUP-001`, `PO-003` — all **DECIDED**.

### 2. Receipt → GRN → QC

- **Trigger:** Physical goods arrive against an approved PO.
- **Actor:** Warehouse Operator/Manager role.
- **Preconditions:** PO is `approved`.
- **Major state transitions:** GRN `open -> received (full|partial) ->
  QC pending -> QC passed | QC failed -> closed` (QC criteria:
  **DECIDED**, `GRN-001` — QC required, per-category checklist content
  is configurable, not a build blocker).
- **Systems touched:** Purchase Orders, GRN, Inventory
- **Inventory impact:** QC-passed quantities post a `receipt` ledger
  transaction (ADR-0012); QC-failed quantities post a `damaged`
  transaction or are excluded pending resolution — **DECIDED**
  (`GRN-002`, `INV-006`: configurable resolution path per exception
  type; damaged/return-pending stock never auto-re-enters sellable
  stock without QC).
- **Payment impact:** None directly (may inform supplier payment
  release — out of current scope).
- **Customer impact:** None.
- **Audit requirements:** GRN record must reference the originating PO
  and every ledger transaction it produced.
- **Decision status:** `GRN-001`, `GRN-002`, `PO-002`, `INV-001` — all
  **DECIDED**.

### 3. Inventory → Product Enrichment → Pricing → Catalog → Publish

- **Trigger:** Stock exists (post-GRN) and/or a new style needs
  enrichment for sale.
- **Actor:** Catalog/Merchandising staff.
- **Preconditions:** Product Master record exists with required
  attributes (`PROD-002`); pricing set (`CAT-001`).
- **Major state transitions:** Product `draft -> ready_for_enrichment
  -> ready_for_qa -> published` (states **DECIDED**, `PROD-003` — this
  exact six-state lifecycle was adopted); Catalog listing
  `unpublished -> published` (publish gate ownership **DECIDED**,
  `CAT-002` — requires **both** the automated QA-completeness gate
  **and** an explicit Merchandiser publish action).
- **Systems touched:** Product Master, Inventory (availability read),
  Catalog/Merchandising
- **Inventory impact:** Read-only (availability check before allowing
  publish).
- **Payment impact:** None.
- **Customer impact:** None until published — then the product becomes
  visible/purchasable.
- **Audit requirements:** Publish/unpublish events are logged with
  actor and timestamp.
- **Decision status:** `PROD-001` through `PROD-004`, `CAT-001`,
  `CAT-002`, `CAT-003` — all **DECIDED**. (`TAX-003`, the HSN
  mandatoriness threshold touching this flow's product data, remains
  **UNDER_REVIEW**.)

### 4. Search → PDP → Cart → Checkout

- **Trigger:** Customer discovers a product via search/PLP and adds it
  to cart, then proceeds to checkout.
- **Actor:** Customer (guest or authenticated)
- **Preconditions:** Product is published and (for cart) selected
  variant has available stock.
- **Major state transitions:** Cart `empty -> populated -> checkout_in_progress`;
  reservation attaches **only at checkout start, never at add-to-cart**
  (**DECIDED**, `INV-002`).
- **Systems touched:** Search/Discovery, PDP, Cart, Inventory
  (availability + reservation), Checkout
- **Inventory impact:** `reservation` ledger transaction — timing
  **DECIDED** (`INV-002`: short-lived, checkout-start only; COD reserves
  at order acceptance instead).
- **Payment impact:** None yet.
- **Customer impact:** Direct — this is the primary conversion path.
- **Audit requirements:** Standard analytics event trail (not
  compliance-critical at this stage).
- **Decision status:** `SRCH-001`, `PDP-001`, `CART-001`, `CART-002`,
  `CHK-001`, `CHK-002`, `CHK-003`, `CHK-004` — all **DECIDED**.
  (`CHK-002`'s underlying GST rate correctness still depends on
  `TAX-001`–`003`, **UNDER_REVIEW** — the tax-computation *engine* is
  decided and built configurable specifically so this doesn't block
  the flow.)

### 5. Payment

- **Trigger:** Customer submits checkout.
- **Actor:** Customer; payment provider (Razorpay or COD)
- **Preconditions:** Cart valid, address serviceable (`IND-002`), tax
  computed (engine per `CHK-002`; legal rate correctness pending
  `TAX-001`–`003`).
- **Major state transitions:** Payment `initiated -> authorized ->
  captured | failed` (COD: `initiated -> confirmed`, no capture step) —
  **DECIDED**, `PAY-002` (payment state machine fixed, and explicitly
  kept separate from order state — see
  `blueprint/ORDER_PAYMENT_INTEGRITY.md`).
- **Systems touched:** Payment (provider abstraction, ADR-0011),
  Checkout
- **Inventory impact:** None directly — inventory was already reserved
  in step 4.
- **Payment impact:** Direct — this is the payment domain's core event.
- **Customer impact:** Direct — payment failure must be recoverable
  (retry, alternate method) without losing the cart.
- **Audit requirements:** Every payment state transition is logged
  with the provider's reference ID, for reconciliation.
- **Decision status:** `PAY-001` through `PAY-005`, `IND-001`,
  `IND-004` — all **DECIDED**.

### 6. Order → Inventory Reservation → Allocation

- **Trigger:** Payment succeeds (or COD order is confirmed).
- **Actor:** System (automated)
- **Preconditions:** Payment state is `captured` or COD `confirmed`.
- **Major state transitions:** Order `pending -> confirmed -> allocated`
  (business shape **DECIDED**, `ORD-001` — exact state-enum naming is
  an engineering implementation detail, not a further business
  decision); inventory `reserved -> allocated` (**DECIDED**, `ORD-005`
  — conversion happens at payment capture or COD acceptance).
- **Systems touched:** Order Management, Inventory, Payment (read)
- **Inventory impact:** `allocation` ledger transaction, converting a
  reservation into a firm commitment.
- **Payment impact:** Read-only trigger.
- **Customer impact:** Order confirmation communicated (feeds
  `specs/29-notifications.md`).
- **Audit requirements:** Order creation must be traceable to the exact
  cart/payment/inventory-reservation records it originated from.
- **Decision status:** `ORD-001`, `ORD-005` — **DECIDED**. Invoice
  generation belongs here (**DECIDED** at the engineering-scaffolding
  level — versioned/configurable template, per
  `specs/32-india-tax-invoicing.md`); its legal format (`TAX-004`)
  remains **UNDER_REVIEW**.

### 7. Warehouse: Pick → Pack → Ship → Deliver

- **Trigger:** Order is `allocated`.
- **Actor:** Warehouse staff; carrier
- **Preconditions:** Allocated stock physically available at the
  fulfilling location.
- **Major state transitions:** Order `allocated -> picking -> packed ->
  shipped -> out_for_delivery -> delivered` (business shape **DECIDED**,
  part of `ORD-001`, including split-shipment support).
- **Systems touched:** Warehouse/Fulfilment, Shipping/Tracking, Order
  Management, Inventory
- **Inventory impact:** `sale`/fulfilment ledger transaction — trigger
  point **DECIDED** (engineering default: posts at pack completion,
  when the item leaves sellable custody, per `specs/06-inventory.md`
  `INV-001`).
- **Payment impact:** None directly (COD collection happens at
  delivery — see `IND-001`).
- **Customer impact:** Tracking visibility (`specs/16-shipping-tracking.md`).
- **Audit requirements:** Full pick/pack/ship/deliver trail per order
  line, including any pick exceptions (`WH-002`).
- **Decision status:** `WH-001`, `WH-002`, `SHIP-001` through
  `SHIP-004` — all **DECIDED** (`SHIP-001`'s specific carrier selection
  is deferred operational configuration, not a blocking decision).

### 8. Customer History → Loyalty

- **Trigger:** Order reaches `delivered`.
- **Actor:** System (automated)
- **Preconditions:** Loyalty program exists — **DECIDED**, `LOY-001`:
  yes, points + tiers model.
- **Major state transitions:** Loyalty ledger `earn` transaction posted
  (ADR-0013) at the qualifying-purchase trigger (`LOY-002` —
  **DECIDED**: based on qualifying purchase value; exact rate is a
  configurable business parameter); customer order history updated.
- **Systems touched:** Customer 360, Loyalty, Order Management
- **Inventory impact:** None.
- **Payment impact:** None.
- **Customer impact:** Loyalty balance visible in account
  (`specs/21-customer-profile.md`).
- **Audit requirements:** Every earn transaction is traceable to its
  originating order for later reversal if the order is
  cancelled/returned.
- **Decision status:** `LOY-001` through `LOY-005` — all **DECIDED**.

---

## Part 2 — Exception / post-purchase flows

### 9. Cancellation

- **Trigger:** Customer or CS agent requests cancellation.
- **Actor:** Customer (self-service) or CS agent (`CAN-002`)
- **Preconditions:** Order is in a cancellable state — **DECIDED**,
  `CAN-001`: allowed **before shipment**, subject to configurable
  state/policy rules.
- **Major state transitions:** Order `-> cancelled` (or
  `partially_cancelled` — `ORD-002`, **DECIDED**: partial cancellation
  required).
- **Systems touched:** Order Management, Inventory, Payment, Loyalty
- **Inventory impact:** `release` ledger transaction reversing the
  reservation/allocation.
- **Payment impact:** Triggers refund flow (see Refund below) if
  payment was captured.
- **Customer impact:** Direct — cancellation confirmation notification.
- **Audit requirements:** Cancellation reason (`CAN-003` — **DECIDED**:
  optional, not mandatory), actor, and timestamp; must reconcile
  against the reversed inventory and payment records.
- **Decision status:** `CAN-001`, `CAN-002`, `CAN-003`, `ORD-002` — all
  **DECIDED**. `TAX-005` (credit-note legal format) remains
  **UNDER_REVIEW**; the requirement that a credit note is generated is
  itself **DECIDED**.

### 10. Return

- **Trigger:** Customer requests a return after delivery.
- **Actor:** Customer (self-service or assisted, `RET-003`)
- **Preconditions:** Order is `delivered`; within return window
  (`RET-001` — **DECIDED**: 7 days default, configurable by
  category, non-returnable categories supported); item not excluded by
  category.
- **Major state transitions:** Return `requested -> pickup_scheduled ->
  received -> QC_pending -> QC_passed | QC_failed -> closed`
  (`RET-002` — **DECIDED**: return reason mandatory, warehouse QC
  required before refund eligibility; per-category condition checklist
  content is configurable).
- **Systems touched:** Order Management, Returns, Inventory, Shipping
  (reverse logistics, `RET-004`)
- **Inventory impact:** `return_pending` transaction on pickup, then
  `receipt` (if QC passed and restocked) or `damaged`/write-off (if QC
  failed) — disposition rule **DECIDED** (`INV-006`: never automatic
  re-entry to sellable stock without QC; specific disposition choice
  at QC time is a configurable workflow outcome).
- **Payment impact:** Triggers refund flow once accepted.
- **Customer impact:** Direct — status visibility throughout.
- **Audit requirements:** Return reason, QC outcome, and disposition
  are all traceable.
- **Decision status:** `RET-001` through `RET-004`, `INV-006` — all
  **DECIDED**.

### 11. Refund

- **Trigger:** Cancellation or accepted return.
- **Actor:** System (automated) or Finance (manual review for edge
  cases)
- **Preconditions:** Triggering cancellation/return has reached the
  state that authorizes refund.
- **Major state transitions:** Refund `initiated -> processed | failed`
  via the payment abstraction (`PAY-001`); for COD, mechanism
  **DECIDED** (`REF-001`: **store credit**, never bank/UPI transfer).
- **Systems touched:** Payment, Order Management, (possibly) Loyalty
  (earn reversal), `specs/33-store-credit-gift-cards.md` (store-credit
  ledger)
- **Inventory impact:** None directly (already handled by the
  triggering cancellation/return).
- **Payment impact:** Direct — this is the refund domain's core event.
- **Customer impact:** Direct — refund confirmation and timeline
  communicated.
- **Audit requirements:** Refund must reference the original payment
  and, per `TAX-005` (**UNDER_REVIEW** for exact format), a GST credit
  note.
- **Decision status:** `REF-001` through `REF-004` — all **DECIDED**.
  `TAX-005` remains **UNDER_REVIEW**.

### 12. Exchange

- **Trigger:** Customer requests a different size/color in place of a
  return-for-refund.
- **Actor:** Customer (self-service or assisted)
- **Preconditions:** Same as Return, plus replacement SKU availability.
- **Major state transitions:** **DECIDED at the model level**
  (`EXC-001`) — a **first-class Exchange entity**, not a linked
  return+new-order pair, to preserve financial/inventory auditability
  across a single coherent operation.
- **Systems touched:** Returns, Order Management, Inventory (release
  original SKU, reserve replacement SKU), Payment (if price difference,
  `EXC-002`)
- **Inventory impact:** Release of original SKU + reservation of
  replacement SKU, both as explicit ledger transactions — never a
  silent net-zero adjustment (ADR-0012 consequence). Replacement SKU is
  reserved **at exchange-request time** (resolving the
  replacement-SKU-timing gap this document originally flagged).
- **Payment impact:** Price difference: customer pays via online
  payment flow if the replacement costs more; issued as store credit if
  it costs less (`EXC-002` — **DECIDED**).
- **Customer impact:** Direct.
- **Audit requirements:** Full traceability linking original order,
  return, and replacement.
- **Decision status:** `EXC-001`, `EXC-002`, `EXC-003` — all
  **DECIDED**.

### 13. RTO (Return to Origin)

- **Trigger:** Delivery fails after repeated attempts, or the customer
  refuses delivery.
- **Actor:** Carrier (system-reported)
- **Preconditions:** Order is `out_for_delivery` or `delivery_attempted`.
- **Major state transitions:** Order `-> RTO_in_transit -> RTO_received`
  (business shape **DECIDED**, part of `ORD-001`; RTO on a prepaid
  order triggers refund, RTO on COD triggers closure without refund —
  `ORD-003`, **DECIDED**).
- **Systems touched:** Shipping/Tracking, Order Management, Inventory,
  Payment (refund if prepaid)
- **Inventory impact:** `receipt`-style ledger transaction once RTO
  stock physically returns to the warehouse, subject to the same QC
  disposition rule as Return (`INV-006`).
- **Payment impact:** Prepaid → refund flow; COD → logistics-only
  reconciliation, no payment was ever collected.
- **Customer impact:** Notification of failed delivery/RTO.
- **Audit requirements:** RTO reason (address issue, customer refusal,
  etc.) is captured — feeds procurement/serviceability decisions over
  time.
- **Decision status:** `ORD-003`, `SHIP-004`, `INV-006` — all
  **DECIDED**.

### 14. Damaged item (discovered post-delivery, pre-return)

- **Trigger:** Customer reports item arrived damaged.
- **Actor:** Customer, CS agent
- **Preconditions:** Order `delivered`, within the standard return
  window (`RET-001`).
- **Major state transitions:** **DECIDED (engineering default,
  2026-09-22):** this scenario is not distinctly addressed by the
  Product Owner's decision instruction, and no dedicated decision ID
  was ever registered for it. Absent a distinct business rule, it
  routes into the standard Return flow (flow 10) with a distinct reason
  code, using the standard return window and QC process — no separate
  expedited path is built unless the Product Owner specifies one later.
  This is a safe, non-blocking default per the "configurable, don't
  block" principle (see `CLAUDE.md` §4) — it can be refined into a
  distinct flow later without a redesign.
- **Systems touched:** Returns, Inventory, Customer Service
- **Inventory impact:** Damaged-on-arrival stock should generally not
  be restocked as sellable — write-off or return-to-supplier
  (`INV-006`, `GRN-002` pattern reused).
- **Payment impact:** Refund or replacement, per the Return/Exchange
  flow it routes into.
- **Customer impact:** High-sensitivity — damaged-on-arrival is a
  trust-critical scenario; expedited handling remains a Customer
  Service operational choice, not a system-enforced distinct path at
  this time.
- **Audit requirements:** Photo evidence capture (if required by
  operational policy) and reason code, for supplier quality feedback
  loops.
- **Decision status:** No dedicated decision ID; resolved via the
  engineering default above. Not a blocker for any milestone.

### 15. Partial delivery / partial return / partial refund

- **Trigger:** A multi-item order ships/returns/refunds incompletely.
- **Actor:** System (automated), warehouse, customer
- **Preconditions:** None — `ORD-002` (**DECIDED**) confirms partial
  operations are supported.
- **Major state transitions:** **DECIDED**, `ORD-002`: partial
  cancellation and split shipments are both required.
- **Systems touched:** Order Management, Inventory, Payment, Shipping
- **Inventory impact:** Per-line ledger transactions rather than
  whole-order.
- **Payment impact:** Partial refund calculation uses the original
  per-line transaction value (`REF-003`, **DECIDED**); shipping-cost/
  promotion apportionment across remaining lines is an engineering
  computation detail (proportional apportionment, engineering default),
  not a further open business question.
- **Customer impact:** Communication clarity is critical here (a
  customer must understand which items shipped/returned/refunded).
- **Audit requirements:** Line-level audit trail.
- **Decision status:** `ORD-002`, `REF-003` — **DECIDED**.

### 16. Payment failure / payment pending / duplicate payment

- **Trigger:** Payment attempt fails, times out in a pending state, or
  a webhook is delivered more than once for the same event.
- **Actor:** System (automated), payment provider
- **Preconditions:** A checkout/payment attempt is in progress.
- **Major state transitions:**
  - Failure: Payment `initiated -> failed`; reservation releases per
    `INV-002`'s configured timeout — **DECIDED**, `PAY-005`.
  - Pending: Payment `initiated -> pending` (e.g., UPI collect request
    awaiting customer action) — timeout/retry policy **DECIDED**
    (`PAY-005`: configurable).
  - Duplicate: Webhook deduplication ensures a second delivery of the
    same event does not re-trigger capture/refund — **DECIDED and
    binding**, `PAY-003` (P0, financial-integrity requirement).
- **Systems touched:** Payment, Checkout, Order Management, Inventory
  (reservation release on failure)
- **Inventory impact:** A failed/expired payment releases its
  reservation (`INV-002`) rather than leaving stock locked
  indefinitely.
- **Payment impact:** Core to this scenario.
- **Customer impact:** Failure/pending states are clearly communicated
  with a retry path that doesn't lose the cart.
- **Audit requirements:** Every payment event (including duplicates
  that were correctly deduplicated) is logged for reconciliation, even
  though only the first is "processed."
- **Decision status:** `PAY-003`, `PAY-005`, `INV-002` — all
  **DECIDED**.

### 17. Inventory shortage (post-order allocation failure)

- **Trigger:** An order is confirmed/paid, but at allocation or pick
  time the expected stock is not actually available.
- **Actor:** System (detects shortfall), warehouse staff, CS agent
- **Preconditions:** Order `confirmed` or `allocated`, but physical
  stock check fails.
- **Major state transitions:** Order line `-> shortage_exception` —
  **DECIDED** (engineering default per `ORD-004`: routes to a defined
  exception state requiring CS/warehouse intervention, tracked and
  audited).
- **Systems touched:** Order Management, Inventory, Customer Service,
  Payment (partial refund if the line can't be fulfilled), Loyalty
  (partial earn reversal)
- **Inventory impact:** This scenario should be rare given `INV-002`/
  `INV-003`'s binding oversell-prevention and concurrency requirements
  — its *handling* when it does occur is defined per `ORD-004` above.
- **Payment impact:** Partial refund for the unfulfillable line, using
  `REF-003`'s original-transaction-value rule.
- **Customer impact:** High-sensitivity — needs clear, prompt
  communication.
- **Audit requirements:** Every shortage event is logged and feeds back
  into procurement/safety-stock decisions (`INV-005`).
- **Decision status:** `ORD-004`, `INV-003`, `INV-005` — all
  **DECIDED**.

---

## Summary: decision status (updated 2026-09-22)

**Order (`ORD-001`) and Payment (`PAY-002`) state machines are now
`DECIDED`** at the business-shape level — this was the single largest
concentration of P0 risk on the platform when this document was first
written, and it has been resolved. Every exception flow above that
references order/payment states inherits that resolution.

**What remains `UNDER_REVIEW`** (not resolved, not blocking M00/M01,
routed to external compliance/legal verification rather than further
Product Owner decision): `TAX-001` through `TAX-005` (India GST/tax
computation and invoice/credit-note legal format), `CUST-001` (data
retention/deletion policy), `AUD-002` (applicable regulatory
requirements). See `blueprint/DECISION_REGISTER.md` for full detail and
`blueprint/READINESS.md` for the current per-milestone readiness
classification.
