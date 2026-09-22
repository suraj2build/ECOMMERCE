# Dependency Map

**Purpose:** Show which domains depend on which others, so the
`BUILD_PLAN.md` milestone order can be evaluated against actual data/
decision dependencies rather than just the narrative order in
`PRODUCT.md`. This document **proposes**; it does not change
`BUILD_PLAN.md` — see §"Recommendation to Product Owner" at the end.

## 1. Core dependency chain (forward flow)

```
ORG (entity/location model)
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
          CHECKOUT  <---- TAX/GST model, SHIPPING (serviceability)
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
- **TAX/GST** (currently unowned by any spec — see
  `INDIA_COMMERCE_GAPS.md`) — touches product master (HSN), catalog
  (MRP/pricing), checkout (tax computation), order (invoicing),
  refunds/cancellation (credit notes).

## 3. Why the order matters: key dependency findings

1. **`ORG-001`/`ORG-002` (organization & location model) sit upstream
   of nearly everything** — product master, inventory, RBAC scoping,
   and tax registration (`TAX-001`) all reference "which entity/which
   location." This decision is currently unowned by any spec (see
   audit finding in `README.md`) and should be resolved **before**
   M00 foundational work, not during M02 (Product Master) as the
   current milestone order implies.

2. **Inventory (M06) is a hard dependency for Catalog (M07),
   Checkout (M12), and Order Management (M14)** — `BUILD_PLAN.md`
   already sequences it before all three, which is correct. This
   dependency map confirms no reordering is needed here.

3. **Tax/GST decisions (`TAX-001`–`TAX-006`) have no home milestone**
   in the current `BUILD_PLAN.md` — they cut across M02 (HSN on
   product), M07 (MRP/pricing), M12 (checkout tax computation), and
   M14 (invoicing). Because GST invoice generation is likely a legal
   requirement (not optional scope), this suggests either (a) a new
   milestone dedicated to tax/invoicing inserted before M12, or (b)
   explicit tax/invoicing acceptance criteria added to M02, M07, M12,
   and M14 rather than treated as an implicit side detail. See
   recommendation below.

4. **Payment (M13) and Order Management (M14) are sequenced with
   Payment first**, but `PAY-002` (payment state machine) explicitly
   depends on `ORD-001` (order state machine) existing conceptually
   first — the two need to be designed together even though Order
   Management's milestone number is later. This is a **design-time**
   dependency, not necessarily a build-order one: recommend designing
   `ORD-001` and `PAY-002` in the same decision session even if code
   implementation still follows the M13-then-M14 sequence.

5. **Warehouse/Fulfilment (M15) and Shipping/Tracking (M16) both
   depend on the warehouse/location decision (`ORG-002`/`INV-004`)**
   — if multi-location is chosen, both milestones get materially more
   complex and may need to be re-scoped.

6. **Loyalty (M22) has no committed business rules at all**
   (`LOY-001`–`005` are all open, `LOY-001` itself asks whether a
   loyalty program exists). Given `BUILD_PLAN.md` already sequences it
   late (M22 of 31), no reordering is needed, but it should not be
   assumed "small" — if `LOY-001` chooses a tiered-benefits model, this
   is a much larger milestone than a simple points system.

7. **Customer 360 (M21) reads from Order (M14), Shipping (M16), and
   Loyalty (M22)**, but is itself sequenced (M21) *before*
   Loyalty (M22) in `BUILD_PLAN.md`. This is a minor inversion — a
   Customer 360 view showing loyalty balance can't be fully built
   until Loyalty exists. Not a blocking issue (the profile/address/
   order-history parts of M21 don't need Loyalty), but flagged for
   awareness — loyalty-balance display within M21 may need a small
   follow-up once M22 lands, rather than being fully done at M21.

## 4. Recommendation to Product Owner

**Do not reorder `BUILD_PLAN.md` automatically — this is a
recommendation only, requiring explicit Product Owner decision per
`AGENTS.md` §2.**

Suggested changes to consider:

- **Insert an explicit tax/compliance workstream** spanning M02, M07,
  M12, and M14 (or a new milestone, e.g., "M02.5 Tax & Invoicing
  Foundations") rather than leaving GST/HSN/invoicing as an implicit
  side detail of checkout. Given the likely-legal nature of these
  requirements (see `INDIA_COMMERCE_GAPS.md`), treating them as an
  afterthought risks a non-compliant launch.
- **Resolve `ORG-001`/`ORG-002` before M00 implementation begins**,
  not during M02, since it affects the foundational data model.
- **Design (not necessarily build) `ORD-001` and `PAY-002` together**,
  even though `BUILD_PLAN.md` correctly keeps Payment (M13) before
  Order Management (M14) for build sequencing.
- Otherwise, the existing M00–M31 sequence is dependency-consistent
  with this map and does not require reordering.
