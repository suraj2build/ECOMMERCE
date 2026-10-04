# Admin operations - next phases: gap mapping and proposals

Status: RESEARCH (Admin Ops Phase 1 deliverable, 2026-10-04). Nothing in
this document is implemented or decided. Each phase needs its own
authorization, and each item under "Business decisions" needs an answer
from the Product Owner before the work that depends on it starts.

Method: read the schema (`packages/db/prisma/schema.prisma`), the owning
services and routes under `services/commerce-api/src/modules/`, and the
admin screens under `apps/admin/src/app/dashboard/`. File references are
to the `claude/admin-ops-phase1` branch.

Each area separates five things:

- **Exists** - working server capability (and whether a screen uses it).
- **UI gap** - the server can do it; the admin has no practical screen.
- **Backend gap** - the server cannot do it yet.
- **Provider dependency** - needs an outside account or service.
- **Business decision** - a rule only the Product Owner can set.

---

## A. Buying and receiving

Supplier -> PO -> approval -> receipt/QC -> labels -> put-away -> stock.

| Step | Exists | UI gap | Backend gap |
|---|---|---|---|
| Supplier | `supplier` module: create/edit, supplier SKUs (`SupplierSku`). Admin: Suppliers list/detail. | Supplier SKU mapping has no bulk entry; adding a supplier cost per SKU is one row at a time. | none found |
| Purchase order | `procurement`: draft, lines, submit, approve, cancel; `PurchaseOrderApproval` history; value recorded against `PO_APPROVAL_THRESHOLD_INR`. Admin: Purchase orders. | No "reorder from low stock" or "copy previous PO"; lines are typed one SKU at a time. | No reorder suggestion (no reorder point/min stock on `Sku` or `InventoryBalance`). |
| Approval | Submitter can never approve their own PO (`procurement/service.ts` `approvePurchaseOrder`). | - | Blocks a one-person business: see "Solo-owner approvals" below. |
| Receipt / QC | `grn`: receive against PO lines, short/excess, QC PASS/FAIL/PARTIAL, QC-fail sign-off above `GRN_QC_FAIL_MANAGER_SIGNOFF_THRESHOLD_UNITS`. Admin: Receiving. | Receiving is typed quantities; no scan-to-count. | No barcode scan endpoint that resolves a scanned code to the PO line. |
| Labels | `Sku.barcode` (unique, optional) exists; Phase 1 lets the owner set it per SKU and through import. | No label print screen. | No label document (PDF/ZPL) generation; no label template. |
| Put-away | Stock is posted to a `Location` (warehouse/store level) on GRN close. | - | No bin/shelf level below `Location`; put-away is implicit. Needed only if the warehouse wants shelf addresses for picking. |
| Stock | Inventory ledger, balances, adjustments (directional, D-4), transfers. Admin: Inventory, Adjustments. Phase 1 product readiness links here. | - | - |

**Provider dependencies:** a label printer (hardware) and its format
(ZPL vs PDF). Not tested - no hardware here.

**Business decisions:**
- A-1. Should stock be tracked per shelf/bin, or is location-level enough for launch?
- A-2. Label format and printer model (affects whether to build PDF or ZPL).
- A-3. Reorder points: per SKU, per style, or none at launch.
- A-4. Solo-owner PO approval (see below).

---

## B. Dispatch

Order validation -> pick -> exact barcode verification -> pack ->
measured weight/dimensions -> courier booking -> documents -> pickup ->
actual handover -> tracking/NDR/RTO.

| Step | Exists | UI gap | Backend gap |
|---|---|---|---|
| Order validation | Order created only after checkout validation; COD limit; pincode serviceability (`ServiceablePincode`). | No "orders needing attention" queue for address/phone problems. | No address-quality or phone check before dispatch. |
| Pick | `warehouse`: `PickTask` per order line or exchange replacement, PICKED/SHORT_PICKED/EXCEPTION, shortfall posts an audited adjustment. Admin: Warehouse. | Picks are confirmed by quantity, one task at a time; no pick list grouped by location. | - |
| Barcode verification | `Sku.barcode` exists. | - | **Not verified anywhere.** `recordPickOutcome` takes a quantity, not a scanned code. Needs a scan input that must equal the task SKU's barcode (and refuse a wrong SKU). |
| Pack | `OrderService` pack -> `PACKED`, ready-to-ship -> `READY_TO_SHIP`. | - | No packed-item check (every line in the fulfilment scanned into the parcel). |
| Weight / dimensions | `ShipmentBookingInput.weightGrams?` exists but `createShipment` never sets it. | - | **No fields** for measured gross weight or L×W×H on `OrderFulfilment`/`Shipment`; no product weight on `Sku` (also why `ShippingRule` has no weight-based rule). |
| Courier booking | `ShippingService.createShipment` books through the `ShippingProvider` interface; idempotent, concurrency-safe. Registry has **mock providers only** (`MOCK`, `MOCK_SECONDARY`); production refuses mocks. | - | No real carrier adapter (LR-008 open). |
| Documents | - | - | Provider interface has no label/manifest/invoice-copy retrieval. |
| Pickup | - | - | No pickup scheduling or manifest close in the interface. |
| Actual handover | - | - | **Booking is treated as shipped**: see the proposal below. |
| Tracking / NDR / RTO | Webhook + polling, normalized statuses, redelivery attempts, automatic RTO after `SHIPPING_MAX_REDELIVERY_ATTEMPTS`, RTO receipt. | No NDR action screen (reattempt / change address / return). | No NDR instruction back to the carrier (interface has none). |

**Provider dependencies:** a courier account and API (LR-008), its label
and manifest formats, weight-dispute process, pickup slots. A scanner
(keyboard-wedge USB scanners need no driver) and a scale. None tested.

**Business decisions:**
- B-1. Courier choice (LR-008, still `DECISION_REQUIRED`).
- B-2. Whether to require a barcode scan for every unit at pick, at pack, or both.
- B-3. Whether parcel weight is measured per parcel at pack, or taken from product weights.
- B-4. The sale-posting point (proposal below).

### Proposal: move "shipped" from carrier booking to handover (NOT implemented)

**Today.** `ShippingService.createShipment`
(`shipping/service.ts`): once the carrier accepts the booking, the same
transaction that moves the `Shipment` from `CREATED` to `BOOKED` calls
`OrderService.markFulfilmentShipped`. That call:

1. moves the fulfilment and its order lines to `SHIPPED`;
2. posts the inventory `SALE` per order line (`recordSale`, which
   decrements both `onHand` and `reserved`) - or `EXCHANGE_DISPATCH` for
   an exchange replacement;
3. sets `shippedAt`, carrier name and tracking reference.

So a parcel that is booked but never collected is already a sale and
has already left stock.

**Proposed change.** Split booking from handover:

- Booking moves the shipment to `BOOKED` only. The fulfilment gets a new
  state between `READY_TO_SHIP` and `SHIPPED` (working name
  `AWAITING_PICKUP`), still holding its reservation.
- `markFulfilmentShipped` runs at **handover**: the carrier's first
  `picked_up`/`in_transit` event (webhook or poll), or a staff
  "handed to courier" confirmation with the manifest number, whichever
  comes first. It stays idempotent: the second signal is a no-op.
- A booked shipment can be **cancelled with the carrier** before
  handover (new provider method), returning the fulfilment to
  `READY_TO_SHIP`.

**Effects to design and test before building:**

| Area | Effect |
|---|---|
| Cancellation (M18) | Today a booked line is `SHIPPED`, so it cannot be cancelled. After the change a line `AWAITING_PICKUP` is still unshipped. Either allow cancellation (requires a carrier cancel call first, then the existing reservation release), or keep refusing it from `AWAITING_PICKUP`. A decision is needed; the customer-facing "cancel" button must follow it. |
| Partial fulfilment / split shipments | Each fulfilment has its own shipment, so each splits independently; order status (`computeOrderStatus`) needs the new state counted as "not yet shipped". |
| COD | Nothing collected changes; LR-009 (purchase on cash collection) is unaffected. The COD limit and `CodCollection` stay as they are. |
| Prepaid | Payment is captured at checkout; nothing changes. A pre-handover cancellation of a prepaid line uses the existing refund path. |
| Exchange replacements (EXC-004 Option 2) | `EXCHANGE_DISPATCH` moves to handover in the same way; `Exchange.status` reaching `COMPLETED` on delivery is unchanged. |
| Inventory | Stock stays reserved (not sold) until handover - available-to-sell is unchanged because it already subtracts reservations. The exactly-once `SALE` index is unchanged. |
| Invoices / GST | Today the invoice is issued at order confirmation, not at shipment, so nothing moves. Any change to invoice timing is a TAX-00x question and is **not** part of this proposal. |
| Loyalty vesting | Vests after delivery + return window; unaffected. |
| Analytics (M28) | "Shipped" dates move later by the pickup delay; reports that count shipments by `shippedAt` change accordingly. |
| Existing records | All current `BOOKED` shipments already have `SHIPPED` fulfilments and posted SALEs. Leave them as they are (no back-dating); the new state applies only to bookings made after the release. A migration only adds the enum value. |
| Mock-provider guard | Unchanged: production still refuses `MOCK*` carriers. |

Concurrency points to prove: handover webhook racing a staff
confirmation; handover racing a cancellation; a delivery event arriving
before any pickup event (must still post exactly one SALE).

---

## C. Promotions and campaigns

Supported offer templates -> eligibility/combination -> server-side basket
simulation -> campaign products/collection -> landing page/banner ->
tracked links/channel activity -> schedule -> readiness -> results.

| Step | Exists | UI gap | Backend gap |
|---|---|---|---|
| Offer templates | `Promotion`: percentage or flat amount, coupon or automatic, min cart, max discount, total/per-customer limits, start/end. Admin: Promotions. | Owner must understand `stackGroup`/`priority`; no template picker ("10% off above ₹2,999"). | No product/category/collection eligibility - every promotion applies to the whole basket. No buy-X-get-Y. |
| Combination | Stack groups + priority (PROMO-002); loyalty/store-credit/gift-card compatibility flags. | Plain-language explanation of what combines with what. | - |
| Basket simulation | Checkout pricing resolves promotions server-side. | - | No staff-only "try this basket" endpoint that runs the same pricing without a checkout session. |
| Campaign products | `Collection` + `CollectionStyle`. Admin: Collections. | - | Promotions cannot target a collection (see above). |
| Landing page / banner | CMS landing pages and banners (Phase 1 visual editors, image upload, draft/live). | Linking a promotion to a page is manual. | - |
| Tracked links | GA4/Meta consent-aware events (LR-003). | No UTM link builder. | - |
| Schedule | Promotion start/end; campaign `scheduledAt` with due sweep (M25). | Single calendar view. | - |
| Readiness | - | - | No check that a promotion's collection is published and in stock before it starts. |
| Results | M28 analytics; `PromotionRedemption` rows. | No per-promotion results screen. | Per-promotion revenue/discount query. |

**Provider dependencies:** messaging providers for campaigns (none
chosen; MKT-001). Paid advertising is out of scope.

**Business decisions:** C-1 which offer templates to support at launch;
C-2 whether promotions may target categories/collections (needs a
schema change); C-3 coupon usage restoration after cancellation (open in
`specs/23-promotions.md`). Discount rates and budgets are never set by
engineering.

---

## D. After-sales and money

| Step | Exists | UI gap | Backend gap |
|---|---|---|---|
| Returns | `returns`: eligibility from policy (category/product overrides), reverse pickup through the carrier interface, receipt, QC, disposition, evidence photos. Admin: Returns. | One combined "returns to act on" queue. | - |
| Exchanges | `exchanges`: same size/colour scope (EXC-002), return window (EXC-003), replacement allocation and fulfilment through the normal pipeline. Admin: Exchanges. | - | - |
| QC / disposition | Return QC PASS/FAIL, restock or write-off ledger entries. | - | - |
| Refunds | `refunds`: per order line, PROCESSING claim, Razorpay refund for prepaid, store credit for COD. Admin: Refunds. | - | Real Razorpay account not configured. |
| COD settlements | `CodCollection` per order (LR-009), entered by Finance. | No batch entry from a courier remittance file. | No remittance import / matching of remittance lines to orders. |
| Shipping charges | `ShippingRule` (flat / free-above) charged to the customer. | - | No record of what the courier bills the business per parcel. |
| Weight disputes | - | - | Needs measured weight per parcel (section B) and the courier's billed weight. |
| Reconciliation | Inventory `reconcileBalance`; credit-note limits. | - | No payment-gateway settlement report import; no courier invoice import. |

**Provider dependencies:** payment gateway settlement reports, courier
remittance and billing files (formats depend on B-1).

**Business decisions:** D-1 remittance tolerance (what difference counts
as a dispute); D-2 who absorbs a lost parcel or a weight dispute in the
books.

---

## Solo-owner approvals

Rules found where a second person is required:

| Rule | Where enforced | Same person allowed? | Effect on a one-person business |
|---|---|---|---|
| PO approval | `procurement/service.ts` `approvePurchaseOrder`: approver must differ from submitter, at **every** value. | No | The owner cannot approve their own POs. **Blocks buying.** |
| Inventory adjustment ≥ `INVENTORY_ADJUSTMENT_COAPPROVAL_THRESHOLD_UNITS` (default 50) | `inventory/routes.ts`: co-approver must hold `inventory:adjust:coapprove` **and** be a different staff member. | No | Large stock corrections are blocked. Smaller ones work. |
| Pick shortfall ≥ the same threshold | Warehouse pick posts through `postAdjustment`, which requires a co-approver id above the threshold. | **Not checked** - see finding below | A large shortfall needs some staff id, but any id is accepted. |
| GRN QC-fail ≥ `GRN_QC_FAIL_MANAGER_SIGNOFF_THRESHOLD_UNITS` (default 20) | `grn/service.ts` `assertManagerSignoff`: named staff must hold `grn:qc:manager_signoff`. | **Yes** - no different-person check | Works for the owner today (they name themselves). Worth knowing that this sign-off is not a second pair of eyes. |
| Markdown / sale prices | `catalog:price:approve` permission. | Yes | Works. |

No rule was bypassed and no second user was created.

**Finding (pre-existing, M16; not changed in Phase 1):** the pick route
(`warehouse/routes.ts` `POST /warehouse/pick-tasks/:id/pick`) passes
`coApproverStaffId` straight through. Unlike the stand-alone adjustment
route, nothing checks that the co-approver holds
`inventory:adjust:coapprove` or differs from the picker, so the picker
can name themselves. Recommended fix: apply the same two checks as
`inventory/routes.ts`. It tightens a certified path, so it is listed
here for authorization rather than changed under Phase 1.

**Owner-mode options (for the Product Owner's decision):**

1. **Keep two-person rules; add a second login later.** Safest
   control-wise. The owner cannot approve a PO until someone else
   (accountant, partner) has an account. Nothing to build.
2. **Configurable owner mode with an audit flag.** A setting (off by
   default, changeable only by `org:manage`, itself audited) lets the
   same person approve, and every self-approval is recorded as
   `self_approved: true` with a required reason. A weekly report lists
   self-approvals. Keeps the trail without blocking work.
3. **Value thresholds.** Self-approval is allowed below a configured PO
   value / unit count and still needs a second person above it.
   (Thresholds would be the owner's numbers, not engineering's.)
4. **Delayed self-approval.** The owner can approve their own PO only
   after a cooling-off period (e.g. next day), recorded as such.

Options 2-4 change certified behaviour (M04/M06) and need explicit
authorization plus their own tests (self-approval refused when off,
allowed and flagged when on, setting change audited).

---

## Suggested order for the next phases

1. **Owner-mode decision** (blocks buying for one person) - small build after the decision.
2. **Dispatch B, step 1:** barcode verification at pick/pack, parcel weight and dimensions fields, scan-friendly pick/pack screens. No provider needed.
3. **Dispatch B, step 2:** courier adapter once LR-008 is decided; booking/handover split per the proposal; labels, manifest and pickup through the provider interface.
4. **Buying A:** label printing (after A-2), scan-to-receive, reorder suggestions (after A-3).
5. **After-sales D:** remittance import and COD matching, courier billing import, weight disputes (after B-1).
6. **Promotions C:** templates and basket simulation; collection targeting after C-2.
