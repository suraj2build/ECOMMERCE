# Dependency Map

**Status update (2026-09-22):** This document's dependency analysis
directly informed `BUILD_PLAN.md`'s milestone sequence — its
recommendations (§4 below) were **adopted**, not merely proposed:
`BUILD_PLAN.md` now has 34 milestones (M00–M33), including a dedicated
**M08 Tax & Invoicing Foundation** milestone and Organization/Location
resolved as part of **M00**. Where this document refers to a milestone
by number, those numbers have been **updated to match the current
`BUILD_PLAN.md` sequence** (they originally used the pre-decision
32-milestone numbering, which is now superseded). The dependency
*reasoning* itself remains valid and unchanged; only the milestone
numbers were corrected for consistency.

**Purpose:** Show which domains depend on which others, so
`BUILD_PLAN.md`'s milestone order can be evaluated against actual
data/decision dependencies rather than just the narrative order in
`PRODUCT.md`.

## 1. Core dependency chain (forward flow)

```
ORG (entity/location model — now specs/31-organization-locations.md)
  |
  v
PRODUCT MASTER  ---------------------------+
  |                                        |
  v                                        v
SUPPLIERS --> PURCHASE ORDERS --> GRN --> INVENTORY (ledger)
                                            |
                                            v
                                   CATALOG / MERCHANDISING
                                            |
                    +---------------------+---------------------+
                    v                                           v
              STOREFRONT FOUNDATION                    CHANNEL PUBLISHING / SEO
                    |
        +-----------+-----------+
        v           v           v
   SEARCH/PLP      PDP      (auth/customer)
        |           |
        +-----+-----+
              v
        WISHLIST / CART
              |
              v
          CHECKOUT  <---- TAX/GST model (now specs/32-india-tax-invoicing.md), SHIPPING (serviceability)
              |
              v
           PAYMENT
              |
              v
    ORDER (state machine) <---- INVENTORY (allocation)
              |
   +----------+----------+-----------------+
   v          v           v                v
WAREHOUSE  SHIPPING   CUSTOMER 360     LOYALTY
   |          |
   +----+-----+
        v
    DELIVERY
        |
  +-----+-----+-----------+-----------+
  v           v           v           v
CANCEL     RETURN      (none)      RTO
              |
              v
           REFUND -----> EXCHANGE
```

## 2. Cross-cutting domains (touch most of the above)

- **AUTH/RBAC** — every domain with a user-facing or admin-facing
  surface depends on it.
- **NOTIFICATIONS** — triggered by state changes in order, shipping,
  cancellation, return, refund, exchange, loyalty.
- **AUDIT/COMPLIANCE** — reads from the inventory ledger, loyalty
  ledger, order history, and admin action log.
- **ANALYTICS/REPORTING** — reads from nearly every domain as a data
  source.
- **ADMIN** — surfaces management screens for nearly every domain.
- **TAX/GST** — owned by `specs/32-india-tax-invoicing.md` (M08) as of
  2026-09-22; touches product master (HSN), catalog (MRP/pricing),
  checkout (tax computation), order (invoicing), refunds/cancellation
  (credit notes). Engineering architecture is decided; specific rates/
  formats remain `UNDER_REVIEW` pending compliance verification — see
  `blueprint/DECISION_REGISTER.md` `TAX-001`–`005`.

## 3. Why the order matters: key dependency findings

*(Milestone numbers below reflect the current `BUILD_PLAN.md`
sequence, M00–M33.)*

1. **`ORG-001`/`ORG-002` (organization & location model) sit upstream
   of nearly everything** — product master, inventory, RBAC scoping,
   and tax registration (`TAX-001`) all reference "which entity/which
   location." **This was resolved**: it is now owned by
   `specs/31-organization-locations.md` and folded into **M00 Project
   Foundation**, resolved before Product Master (M02) rather than
   during it — exactly as this document originally recommended.

2. **Inventory (M06) is a hard dependency for Catalog (M07), Checkout
   (M13), and Order Management (M15)** — `BUILD_PLAN.md` sequences it
   before all three, which is correct. No reordering needed here.

3. **Tax/GST decisions (`TAX-001`–`006`) now have a home milestone**:
   **M08 Tax & Invoicing Foundation**, inserted between Catalog (M07)
   and Storefront Foundation (M09) — exactly the new-milestone option
   this document originally recommended (option (a) below), rather
   than treating GST as an implicit side detail of Checkout. M08 is
   `BLOCKED` in `BUILD_PLAN.md` pending compliance verification, while
   the *engineering scaffolding* it produces (configurable tax engine,
   invoice/credit-note template mechanism) is usable by M02, M07, M13,
   and M15 without waiting for that verification to complete — see
   `acceptance/m08-tax-invoicing-foundation.md`.

4. **Payment (M14) and Order Management (M15) are sequenced with
   Payment first**, but `PAY-002` (payment state machine) explicitly
   depends on `ORD-001` (order state machine) existing conceptually
   first — the two needed to be designed together even though Order
   Management's milestone number is later. **This was done**: both
   were resolved together in the 2026-09-22 decision session (see
   `blueprint/DECISION_REGISTER.md` `ORD-001`, `PAY-002`), even though
   code implementation still follows the M14-then-M15 build sequence.

5. **Warehouse/Fulfilment (M16) and Shipping/Tracking (M17) both
   depend on the warehouse/location decision (`ORG-002`/`INV-004`)** —
   resolved as warehouse-only, location-aware-schema, single/few
   locations at launch (see `specs/31-organization-locations.md`), so
   neither milestone needs re-scoping for multi-location complexity at
   launch.

6. **Loyalty (M23) has a committed business model now** (points +
   tiers, per `LOY-001`–`005`, all `DECIDED`) — no longer "no committed
   business rules at all." `BUILD_PLAN.md` still sequences it at M23
   of 34, which remains dependency-consistent.

7. **Customer 360 (M22) reads from Order (M15), Shipping (M17), and
   Loyalty (M23)**, but is itself sequenced (M22) *before* Loyalty
   (M23) in `BUILD_PLAN.md`. This minor inversion still holds and is
   still not blocking (the profile/address/order-history parts of M22
   don't need Loyalty) — see `acceptance/m22-customer-360.md`, which
   scopes the loyalty-balance display appropriately.

## 4. Recommendation to Product Owner — STATUS: ADOPTED (2026-09-22)

The three recommendations originally made here were all adopted into
`BUILD_PLAN.md` during the Product Owner's Blueprint V2 decision
session:

- ~~Insert an explicit tax/compliance workstream...~~ → **Done**: **M08
  Tax & Invoicing Foundation** is now a dedicated milestone, with
  `specs/32-india-tax-invoicing.md` as its owning spec.
- ~~Resolve `ORG-001`/`ORG-002` before M00 implementation begins...~~ →
  **Done**: resolved and folded into M00 via
  `specs/31-organization-locations.md`.
- ~~Design (not necessarily build) `ORD-001` and `PAY-002`
  together...~~ → **Done**: both resolved together in the same
  decision session.

No further `BUILD_PLAN.md` reordering is recommended by this analysis
as of 2026-09-22. Any future change to milestone order should still
route through explicit Product Owner decision, per `AGENTS.md` §2 —
this document's role is analysis and recommendation, never
unilateral change.
