# Development Readiness Scorecard

**Overall platform status: NOT APPROVED FOR IMPLEMENTATION.**

This remains true regardless of any individual domain's readiness
below — per `CLAUDE.md` §0 and `BUILD_PLAN.md`, implementation requires
explicit Product Owner authorization referencing Product Blueprint V2,
domain-by-domain readiness notwithstanding.

## Classification definitions

- **NOT_READY** — Core decisions unresolved; spec cannot meaningfully
  guide implementation yet.
- **PARTIALLY_DEFINED** — Some decisions resolved or the shape is
  clear, but P0 blockers remain.
- **READY_FOR_APPROVAL** — All P0 (and ideally P1) decisions for this
  domain are resolved; spec is ready for the Product Owner to move to
  `APPROVED`.
- **APPROVED_FOR_BUILD** — Spec status is `APPROVED` in `/specs` and
  `BUILD_PLAN.md`'s block has been explicitly lifted for this
  milestone.

## Scorecard

| Domain | Spec | Classification | Blockers (decision IDs) |
|---|---|---|---|
| Platform Overview | `00` | READY_FOR_APPROVAL | Already `APPROVED` (scope-only) |
| Auth / RBAC | `01` | NOT_READY | `AUTH-001`, `AUTH-002`, `AUTH-003`, `ADM-001` |
| Organization model | *(no dedicated spec — gap)* | NOT_READY | `ORG-001`, `ORG-002` |
| Product Master | `02` | NOT_READY | `PROD-001`–`006`, `TAX-003` |
| Suppliers | `03` | PARTIALLY_DEFINED | `SUP-001`, `SUP-002` |
| Purchase Orders | `04` | NOT_READY | `PO-001`, `PO-002`, `PO-003` |
| GRN | `05` | NOT_READY | `GRN-001`, `GRN-002`, `GRN-003` |
| Inventory | `06` | NOT_READY | `INV-001`–`007` (see `INVENTORY_INTEGRITY.md`) |
| Catalog / Merchandising | `07` | NOT_READY | `CAT-001`–`004`, `TAX-001`, `TAX-002` |
| Storefront Foundation | `08` | PARTIALLY_DEFINED | `SF-001`, `SF-002`, `NFR-004`, `NFR-005` |
| Search / Discovery | `09` | PARTIALLY_DEFINED | `SRCH-001`, `SRCH-002` |
| PDP | `10` | PARTIALLY_DEFINED | `PDP-001`, `PDP-002`, `PROD-004`, `PROD-005` |
| Wishlist / Cart | `11` | NOT_READY | `CART-001`, `CART-002`, `CART-003`, `INV-002` |
| Checkout | `12` | NOT_READY | `CHK-001`–`004`, `TAX-001`–`003`, `IND-002`, `IND-003` |
| Payment | `13` | NOT_READY | `PAY-001`–`006` (see `ORDER_PAYMENT_INTEGRITY.md`) |
| Order Management | `14` | NOT_READY | `ORD-001`–`006` (the single largest blocker cluster on the platform) |
| Warehouse / Fulfilment | `15` | NOT_READY | `WH-001`, `WH-002`, `ORG-002` |
| Shipping / Tracking | `16` | NOT_READY | `SHIP-001`–`004` |
| Cancellation | `17` | NOT_READY | `CAN-001`–`003`, `ORD-001` |
| Returns | `18` | NOT_READY | `RET-001`–`004`, `EXC-001` |
| Refunds | `19` | NOT_READY | `REF-001`–`004`, `TAX-005` |
| Exchanges | `20` | NOT_READY | `EXC-001`–`003` |
| Customer 360 | `21` | PARTIALLY_DEFINED | `CUST-001`–`003` (see `CUSTOMER_360.md`) |
| Loyalty | `22` | NOT_READY | `LOY-001`–`005` — `LOY-001` itself asks whether the program exists |
| Promotions | `23` | PARTIALLY_DEFINED | `PROMO-001`, `PROMO-002` |
| Marketing | `24` | PARTIALLY_DEFINED | `MKT-001`, `CUST-002` |
| Social / Channel Publishing | `25` | PARTIALLY_DEFINED | `CHAN-001` |
| SEO | `26` | PARTIALLY_DEFINED | `SEO-001` |
| Analytics / Reporting | `27` | NOT_READY | `ANL-001` (scope essentially undefined) |
| Admin | `28` | NOT_READY | `ADM-001`–`003` |
| Notifications | `29` | PARTIALLY_DEFINED | `NOTIF-001` |
| Audit / Compliance | `30` | NOT_READY | `AUD-001`, `AUD-002` (needs legal input) |
| **India Tax / GST** | *(no dedicated spec — gap)* | **NOT_READY** | `TAX-001`–`006` — all compliance-verification-required |

## Cross-cutting readiness notes

- **No domain is `APPROVED_FOR_BUILD`.** This is expected and correct
  at this stage.
- **The most consequential blockers are concentrated in three places:**
  Order Management (`ORD-001`), Payment (`PAY-002`), and Inventory
  (`INV-001`/`002`/`003`) — see `DEPENDENCY_MAP.md` and
  `END_TO_END_FLOWS.md` summary. Resolving these three unblocks the
  largest number of downstream domains.
- **India Tax/GST has no owning spec at all** and every item in it is
  marked `COMPLIANCE/LEGAL QUESTION REQUIRING VERIFICATION` — this
  domain needs legal/finance input before it can even reach
  `PARTIALLY_DEFINED`, let alone `READY_FOR_APPROVAL`.
- **Organization model has no owning spec** — recommend the Product
  Owner decide whether this becomes a new spec file or is folded into
  `specs/00-platform-overview.md`.

## Path to `READY_FOR_APPROVAL` for the highest-leverage domains

To unblock the largest number of downstream milestones fastest, work
this order (per the dependency analysis in `DEPENDENCY_MAP.md`):

1. `ORG-001`, `ORG-002` — unblocks Product Master, Inventory,
   Warehouse, RBAC scoping
2. `TAX-001`, `TAX-002`, `TAX-003` — unblocks Catalog pricing, Checkout
   tax computation (needs legal verification first)
3. `INV-001`, `INV-002`, `INV-003` — unblocks Inventory, Cart,
   Checkout
4. `ORD-001`, `PAY-002` (design together, per `DEPENDENCY_MAP.md` §3) —
   unblocks Order Management, Payment, and every post-purchase domain
   (Cancellation, Return, Refund, Exchange, Shipping)
5. `AUTH-001`, `AUTH-002`, `ADM-001` — unblocks RBAC-gated admin work
   across nearly every domain

This is a sequencing recommendation for the *decision-making* process,
not a change to `BUILD_PLAN.md`'s build order — see
`DEPENDENCY_MAP.md` §4 for that distinction.
