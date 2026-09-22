# End-to-End Business Flow Map

**Purpose:** A complete cross-domain workflow map for the platform's
primary flow and its exception/post-purchase flows. For each flow:
trigger, actor, preconditions, major state transitions, systems/domains
touched, inventory impact, payment impact, customer impact, audit
requirements, and open decisions. **State transitions marked
"UNDEFINED" are genuinely unresolved** — this document does not invent
them; it names where they belong (see `DECISION_REGISTER.md`).

---

## Part 1 — Primary flow

### 1. Supplier → Purchase Order → Approval

- **Trigger:** Buyer/merchandiser creates a PO against a supplier for a
  set of styles/colors/sizes.
- **Actor:** Buyer (role TBD, `ADM-001`)
- **Preconditions:** Supplier exists and is active (`specs/03`); styles
  exist in Product Master or are created alongside the PO.
- **Major state transitions:** `draft -> submitted -> approved |
  rejected` (approval hierarchy: **UNDEFINED**, `PO-001`)
- **Systems touched:** Suppliers, Purchase Orders, Product Master
- **Inventory impact:** None yet — a PO is a commitment, not a ledger
  event (ADR-0012).
- **Payment impact:** None directly (may create an accounts-payable
  commitment — out of current scope; not modeled in `/specs`).
- **Customer impact:** None (internal-only flow).
- **Audit requirements:** Full approval trail (who approved, when, at
  what threshold) — feeds `specs/30-audit-compliance.md`.
- **Open decisions:** `PO-001`, `SUP-001`, `PO-003`

### 2. Receipt → GRN → QC

- **Trigger:** Physical goods arrive against an approved PO.
- **Actor:** Warehouse staff (role TBD)
- **Preconditions:** PO is `approved`.
- **Major state transitions:** GRN `open -> received (full|partial) ->
  QC pending -> QC passed | QC failed -> closed` (QC criteria:
  **UNDEFINED**, `GRN-001`)
- **Systems touched:** Purchase Orders, GRN, Inventory
- **Inventory impact:** QC-passed quantities post a `receipt` ledger
  transaction (ADR-0012); QC-failed quantities either post a `damaged`
  transaction or are excluded from the ledger entirely pending
  resolution — **UNDEFINED** (`GRN-002`, `INV-006`).
- **Payment impact:** None directly (may inform supplier payment
  release — out of current scope).
- **Customer impact:** None.
- **Audit requirements:** GRN record must reference the originating PO
  and every ledger transaction it produced.
- **Open decisions:** `GRN-001`, `GRN-002`, `PO-002`, `INV-001`

### 3. Inventory → Product Enrichment → Pricing → Catalog → Publish

- **Trigger:** Stock exists (post-GRN) and/or a new style needs
  enrichment for sale.
- **Actor:** Catalog/merchandising staff
- **Preconditions:** Product Master record exists with required
  attributes (`PROD-002`); pricing set (`CAT-001`).
- **Major state transitions:** Product `draft -> ready_for_enrichment
  -> ready_for_qa -> published` (exact states **UNDEFINED**, `PROD-003`);
  Catalog listing `unpublished -> published` (publish gate ownership
  **UNDEFINED**, `CAT-002`)
- **Systems touched:** Product Master, Inventory (availability read),
  Catalog/Merchandising
- **Inventory impact:** Read-only (availability check before allowing
  publish, if that's the chosen gate — see `CAT-002`).
- **Payment impact:** None.
- **Customer impact:** None until published — then the product becomes
  visible/purchasable.
- **Audit requirements:** Publish/unpublish events should be logged
  with actor and timestamp.
- **Open decisions:** `PROD-001` through `PROD-004`, `CAT-001`,
  `CAT-002`, `CAT-003`

### 4. Search → PDP → Cart → Checkout

- **Trigger:** Customer discovers a product via search/PLP and adds it
  to cart, then proceeds to checkout.
- **Actor:** Customer (guest or authenticated)
- **Preconditions:** Product is published and (for cart) selected
  variant has available stock.
- **Major state transitions:** Cart `empty -> populated -> checkout_in_progress`;
  reservation state (**UNDEFINED** — see `INV-002`) may attach at
  add-to-cart or at checkout start.
- **Systems touched:** Search/Discovery, PDP, Cart, Inventory
  (availability + possible reservation), Checkout
- **Inventory impact:** Possible `reservation` ledger transaction —
  timing **UNDEFINED** (`INV-002`).
- **Payment impact:** None yet.
- **Customer impact:** Direct — this is the primary conversion path.
- **Audit requirements:** Standard analytics event trail (not
  compliance-critical at this stage).
- **Open decisions:** `SRCH-001`, `PDP-001`, `CART-001`, `CART-002`,
  `CHK-001`, `CHK-002`, `CHK-003`, `CHK-004`

### 5. Payment

- **Trigger:** Customer submits checkout.
- **Actor:** Customer; payment provider (Razorpay or COD)
- **Preconditions:** Cart valid, address serviceable (`IND-002`), tax
  computed (`TAX-001`–`003`).
- **Major state transitions:** Payment `initiated -> authorized ->
  captured | failed` (COD: `initiated -> confirmed`, no capture step) —
  proposed shape, **not yet approved** (`PAY-002`)
- **Systems touched:** Payment (provider abstraction, ADR-0011),
  Checkout
- **Inventory impact:** None directly — inventory was already reserved
  in step 4, if that's the chosen model.
- **Payment impact:** Direct — this is the payment domain's core event.
- **Customer impact:** Direct — payment failure here must be
  recoverable (retry, alternate method) without losing the cart.
- **Audit requirements:** Every payment state transition must be
  logged with the provider's reference ID, for reconciliation.
- **Open decisions:** `PAY-001`, `PAY-002`, `PAY-003`, `PAY-004`,
  `PAY-005`, `IND-001`, `IND-004`

### 6. Order → Inventory Reservation → Allocation

- **Trigger:** Payment succeeds (or COD order is confirmed).
- **Actor:** System (automated)
- **Preconditions:** Payment state is `captured` or COD `confirmed`.
- **Major state transitions:** Order `pending -> confirmed -> allocated`
  (full state machine **UNDEFINED**, `ORD-001`); inventory
  `reserved -> allocated` (**UNDEFINED**, `ORD-005`)
- **Systems touched:** Order Management, Inventory, Payment (read)
- **Inventory impact:** `allocation` ledger transaction, converting a
  reservation into a firm commitment.
- **Payment impact:** Read-only trigger.
- **Customer impact:** Order confirmation communicated (feeds
  `specs/29-notifications.md`).
- **Audit requirements:** Order creation must be traceable to the exact
  cart/payment/inventory-reservation records it originated from.
- **Open decisions:** `ORD-001`, `ORD-005`, `TAX-004` (invoice
  generation likely belongs here)

### 7. Warehouse: Pick → Pack → Ship → Deliver

- **Trigger:** Order is `allocated`.
- **Actor:** Warehouse staff; carrier
- **Preconditions:** Allocated stock physically available at the
  fulfilling location.
- **Major state transitions:** Order `allocated -> picking -> packed ->
  shipped -> out_for_delivery -> delivered` (exact states
  **UNDEFINED**, part of `ORD-001`)
- **Systems touched:** Warehouse/Fulfilment, Shipping/Tracking, Order
  Management, Inventory
- **Inventory impact:** `sale`/fulfilment ledger transaction at pack or
  ship (exact trigger point **UNDEFINED**, part of `INV-001`).
- **Payment impact:** None directly (COD collection happens at
  delivery — see `IND-001`).
- **Customer impact:** Tracking visibility (`specs/16-shipping-tracking.md`).
- **Audit requirements:** Full pick/pack/ship/deliver trail per order
  line, including any pick exceptions (`WH-002`).
- **Open decisions:** `WH-001`, `WH-002`, `SHIP-001`, `SHIP-002`,
  `SHIP-003`, `SHIP-004`

### 8. Customer History → Loyalty

- **Trigger:** Order reaches `delivered` (or another loyalty-eligible
  state — **UNDEFINED**, `LOY-002`).
- **Actor:** System (automated)
- **Preconditions:** Loyalty program exists at all (`LOY-001` — not yet
  decided).
- **Major state transitions:** Loyalty ledger `earn` transaction posted
  (ADR-0013); customer order history updated.
- **Systems touched:** Customer 360, Loyalty, Order Management
- **Inventory impact:** None.
- **Payment impact:** None.
- **Customer impact:** Loyalty balance visible in account
  (`specs/21-customer-profile.md`).
- **Audit requirements:** Every earn transaction must be traceable to
  its originating order for later reversal if the order is
  cancelled/returned.
- **Open decisions:** `LOY-001` through `LOY-005`

---

## Part 2 — Exception / post-purchase flows

### 9. Cancellation

- **Trigger:** Customer or CS agent requests cancellation.
- **Actor:** Customer (self-service) or CS agent (`CAN-002`)
- **Preconditions:** Order is in a cancellable state — **UNDEFINED**
  (`CAN-001`, depends on `ORD-001`).
- **Major state transitions:** Order `-> cancelled` (or `partially_cancelled`
  if `ORD-002` allows line-level cancellation)
- **Systems touched:** Order Management, Inventory, Payment, Loyalty
- **Inventory impact:** `release` ledger transaction reversing the
  reservation/allocation.
- **Payment impact:** Triggers refund flow (see Refund below) if
  payment was captured.
- **Customer impact:** Direct — cancellation confirmation notification.
- **Audit requirements:** Cancellation reason (`CAN-003`), actor, and
  timestamp; must reconcile against the reversed inventory and payment
  records.
- **Open decisions:** `CAN-001`, `CAN-002`, `CAN-003`, `ORD-002`,
  `TAX-005` (credit note)

### 10. Return

- **Trigger:** Customer requests a return after delivery.
- **Actor:** Customer (self-service or assisted, `RET-003`)
- **Preconditions:** Order is `delivered`; within return window
  (`RET-001`); item not excluded by category.
- **Major state transitions:** Return `requested -> pickup_scheduled ->
  received -> QC_pending -> QC_passed | QC_failed -> closed`
  (`RET-002` criteria **UNDEFINED**)
- **Systems touched:** Order Management, Returns, Inventory, Shipping
  (reverse logistics, `RET-004`)
- **Inventory impact:** `return_pending` transaction on pickup, then
  `receipt` (if QC passed and restocked) or `damaged`/write-off (if QC
  failed) — disposition rules **UNDEFINED** (`INV-006`).
- **Payment impact:** Triggers refund flow once accepted.
- **Customer impact:** Direct — status visibility throughout.
- **Audit requirements:** Return reason, QC outcome, and disposition
  must all be traceable.
- **Open decisions:** `RET-001` through `RET-004`, `INV-006`

### 11. Refund

- **Trigger:** Cancellation or accepted return.
- **Actor:** System (automated) or Finance (manual review for edge
  cases)
- **Preconditions:** Triggering cancellation/return has reached the
  state that authorizes refund.
- **Major state transitions:** Refund `initiated -> processed | failed`
  via the payment abstraction (`PAY-001`); for COD, mechanism
  **UNDEFINED** (`REF-001`).
- **Systems touched:** Payment, Order Management, (possibly) Loyalty
  (earn reversal)
- **Inventory impact:** None directly (already handled by the
  triggering cancellation/return).
- **Payment impact:** Direct — this is the refund domain's core event.
- **Customer impact:** Direct — refund confirmation and timeline
  communicated.
- **Audit requirements:** Refund must reference the original payment
  and, per `TAX-005`, likely requires a GST credit note.
- **Open decisions:** `REF-001` through `REF-004`, `TAX-005`

### 12. Exchange

- **Trigger:** Customer requests a different size/color in place of a
  return-for-refund.
- **Actor:** Customer (self-service or assisted)
- **Preconditions:** Same as Return, plus replacement SKU availability.
- **Major state transitions:** **UNDEFINED at the model level**
  (`EXC-001`) — either a linked return+new-order pair or a first-class
  exchange entity.
- **Systems touched:** Returns, Order Management, Inventory (release
  original SKU, reserve replacement SKU), Payment (if price difference,
  `EXC-002`)
- **Inventory impact:** Release of original SKU + reservation of
  replacement SKU, both as explicit ledger transactions — must not be
  modeled as a silent net-zero adjustment (ADR-0012 consequence).
- **Payment impact:** Possible additional charge or partial refund for
  price difference (`EXC-002`).
- **Customer impact:** Direct.
- **Audit requirements:** Full traceability linking original order,
  return, and new/replacement order.
- **Open decisions:** `EXC-001`, `EXC-002`, `EXC-003`

### 13. RTO (Return to Origin)

- **Trigger:** Delivery fails after repeated attempts, or the customer
  refuses delivery.
- **Actor:** Carrier (system-reported)
- **Preconditions:** Order is `out_for_delivery` or `delivery_attempted`.
- **Major state transitions:** Order `-> RTO_in_transit -> RTO_received`
  (exact states **UNDEFINED**, part of `ORD-001`)
- **Systems touched:** Shipping/Tracking, Order Management, Inventory,
  Payment (refund if prepaid)
- **Inventory impact:** `receipt`-style ledger transaction once RTO
  stock physically returns to the warehouse, restoring availability
  (subject to QC — same disposition question as Return, `INV-006`).
- **Payment impact:** For prepaid orders, triggers refund
  (`ORD-003`); for COD, no payment was collected, so this is a
  logistics-only reconciliation.
- **Customer impact:** Notification of failed delivery/RTO.
- **Audit requirements:** RTO reason (address issue, customer refusal,
  etc.) should be captured — feeds procurement/serviceability
  decisions over time.
- **Open decisions:** `ORD-003`, `SHIP-004`, `INV-006`

### 14. Damaged item (discovered post-delivery, pre-return)

- **Trigger:** Customer reports item arrived damaged.
- **Actor:** Customer, CS agent
- **Preconditions:** Order `delivered`, within a reporting window
  (window itself **UNDEFINED** — not currently in the register; treat
  as part of `RET-001` scope or a new decision if the Product Owner
  wants it distinct from standard returns).
- **Major state transitions:** Likely routes into the standard Return
  flow (9) with a distinct reason code, or may warrant an expedited
  path (no QC dispute since damage is presumed pre-existing) —
  **UNDEFINED**.
- **Systems touched:** Returns, Inventory, Customer Service
- **Inventory impact:** Damaged-on-arrival stock should generally not
  be restocked as sellable — write-off or return-to-supplier
  (`INV-006`, `GRN-002` pattern reused).
- **Payment impact:** Refund or replacement, per the Return/Exchange
  flow it routes into.
- **Customer impact:** High-sensitivity — damaged-on-arrival is a
  trust-critical scenario, likely warranting expedited resolution
  (business policy, **UNDEFINED**).
- **Audit requirements:** Photo evidence capture (if required) and
  reason code, for supplier quality feedback loops.
- **Open decisions:** New scenario surfaced by this audit — no decision
  ID assigned yet; recommend the Product Owner decide whether this is a
  Return sub-case or a distinct flow, then it can be added to the
  register.

### 15. Partial delivery / partial return / partial refund

- **Trigger:** A multi-item order ships/returns/refunds incompletely.
- **Actor:** System (automated), warehouse, customer
- **Preconditions:** `ORD-002` must first establish whether partial
  operations are even supported.
- **Major state transitions:** Entirely dependent on `ORD-002`'s
  outcome — **UNDEFINED** until then.
- **Systems touched:** Order Management, Inventory, Payment, Shipping
- **Inventory impact:** Per-line ledger transactions rather than
  whole-order — requires the order/inventory data model to support
  line-level state from the start if `ORD-002` decides in favor.
- **Payment impact:** Partial refund calculation must correctly
  apportion shipping cost and promotional discounts across remaining
  lines — currently undefined in both `ORD-002` and `REF-003`.
- **Customer impact:** Communication clarity is critical here (a
  customer must understand which items shipped/returned/refunded).
- **Audit requirements:** Line-level audit trail.
- **Open decisions:** `ORD-002`, `REF-003`

### 16. Payment failure / payment pending / duplicate payment

- **Trigger:** Payment attempt fails, times out in a pending state, or
  a webhook is delivered more than once for the same event.
- **Actor:** System (automated), payment provider
- **Preconditions:** A checkout/payment attempt is in progress.
- **Major state transitions:**
  - Failure: Payment `initiated -> failed`; order must not be created
    (or is created in a `payment_failed` state that never becomes
    fulfillable) — exact handling **UNDEFINED** (`PAY-005`).
  - Pending: Payment `initiated -> pending` (e.g., UPI collect request
    awaiting customer action) — timeout/retry policy **UNDEFINED**
    (`PAY-005`).
  - Duplicate: Webhook deduplication must ensure a second delivery of
    the same event does not re-trigger capture/refund — **must be
    solved by design**, not left open (`PAY-003`, marked P0 precisely
    because this is a financial-integrity risk, not a nice-to-have).
- **Systems touched:** Payment, Checkout, Order Management, Inventory
  (reservation release on failure)
- **Inventory impact:** A failed/expired payment must release its
  reservation (`INV-002`) rather than leaving stock locked
  indefinitely.
- **Payment impact:** Core to this scenario.
- **Customer impact:** Failure/pending states must be clearly
  communicated with a retry path that doesn't lose the cart.
- **Audit requirements:** Every payment event (including duplicates
  that were correctly deduplicated) should be logged for
  reconciliation, even though only the first is "processed."
- **Open decisions:** `PAY-003`, `PAY-005`, `INV-002`

### 17. Inventory shortage (post-order allocation failure)

- **Trigger:** An order is confirmed/paid, but at allocation or pick
  time the expected stock is not actually available (e.g., a
  concurrent sale, a miscount, or an unresolved oversell per
  `INV-003`).
- **Actor:** System (detects shortfall), warehouse staff, CS agent
- **Preconditions:** Order `confirmed` or `allocated`, but physical
  stock check fails.
- **Major state transitions:** Order line `-> shortage_exception`
  (**UNDEFINED** — this is exactly the kind of scenario `ORD-004`
  (order exception handling) must define).
- **Systems touched:** Order Management, Inventory, Customer Service,
  Payment (partial refund if the line can't be fulfilled), Loyalty
  (partial earn reversal)
- **Inventory impact:** This scenario is itself evidence of a ledger
  integrity gap if it happens under normal (non-oversold) operation —
  it should be rare if `INV-002`/`INV-003` are implemented correctly,
  but the *handling* of it when it does occur must still be defined.
- **Payment impact:** Likely partial refund for the unfulfillable
  line.
- **Customer impact:** High-sensitivity — this is the "we sold you
  something we don't have" scenario and needs clear, prompt
  communication.
- **Audit requirements:** Every shortage event should be logged and
  ideally feed back into procurement/safety-stock decisions
  (`INV-005`).
- **Open decisions:** `ORD-004`, `INV-003`, `INV-005`

---

## Summary: flows with no defined state machine at all

The following flows currently have **no approved state machine** and
are blocking implementation of everything downstream of them:
**Order** (`ORD-001`), **Payment** (`PAY-002`), and, by extension,
every exception flow above that references order/payment states. This
is the single largest concentration of P0 risk in the platform — see
`READINESS.md`.
