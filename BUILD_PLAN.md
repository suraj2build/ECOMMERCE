# Build Plan

## STATUS: BLOCKED

> **The entire build plan below is BLOCKED pending Product Blueprint V2
> and specification approval.** No milestone — including M00 — is
> authorized for application implementation. Documentation and
> specification work is in progress; that is a separate track from
> "milestone implementation" below and does not unblock it.
>
> **M00 is not complete merely because documentation exists.**
> Completing the documentation foundation is a prerequisite for M00,
> not the same thing as M00 being implemented and verified.

Unblocking requires **all** of:

1. Product Blueprint V2 delivered (business rules for at least the
   milestones about to be built).
2. Relevant `/specs` documents for those milestones moved from
   `DRAFT` to `APPROVED` by the human project owner.
3. Explicit human authorization to begin implementation, referencing
   this document.

Until then, Claude Code and any other engineering agent must not
write application code, install frameworks, create database
migrations, or scaffold the storefront/admin/services — see
`CLAUDE.md` §0.

## Milestone sequence

Each milestone's "Depends on spec(s)" column lists the `/specs`
documents that must reach `APPROVED` before that milestone's
*implementation* may start. Planning/design work referencing a
`DRAFT` spec is fine; writing application code against it is not.

| Milestone | Name | Depends on spec(s) | Status |
|---|---|---|---|
| M00 | Project Foundation | `00-platform-overview.md` | BLOCKED — docs in progress, no code |
| M01 | Authentication / RBAC | `01-auth-rbac.md` | BLOCKED |
| M02 | Product Master | `02-product-master.md` | BLOCKED |
| M03 | Suppliers | `03-suppliers-procurement.md` | BLOCKED |
| M04 | Procurement / Purchase Orders | `04-purchase-orders.md` | BLOCKED |
| M05 | GRN (Goods Receipt) | `05-grn.md` | BLOCKED |
| M06 | Inventory | `06-inventory.md` | BLOCKED |
| M07 | Catalog / Merchandising | `07-catalog-merchandising.md` | BLOCKED |
| M08 | Storefront Foundation | `08-storefront.md` | BLOCKED |
| M09 | Search / Discovery | `09-search-discovery.md` | BLOCKED |
| M10 | PDP | `10-pdp.md` | BLOCKED |
| M11 | Wishlist / Cart | `11-wishlist-cart.md` | BLOCKED |
| M12 | Checkout | `12-checkout.md` | BLOCKED |
| M13 | Payment | `13-payment.md` | BLOCKED |
| M14 | Order Management | `14-order-management.md` | BLOCKED |
| M15 | Warehouse / Fulfilment | `15-warehouse-fulfilment.md` | BLOCKED |
| M16 | Shipping / Tracking | `16-shipping-tracking.md` | BLOCKED |
| M17 | Cancellation | `17-cancellation.md` | BLOCKED |
| M18 | Returns | `18-returns.md` | BLOCKED |
| M19 | Refunds | `19-refunds.md` | BLOCKED |
| M20 | Exchanges | `20-exchanges.md` | BLOCKED |
| M21 | Customer 360 | `21-customer-profile.md` | BLOCKED |
| M22 | Loyalty | `22-loyalty.md` | BLOCKED |
| M23 | Promotions | `23-promotions.md` | BLOCKED |
| M24 | Marketing | `24-marketing.md` | BLOCKED |
| M25 | Social / Channel Publishing | `25-social-channel-publishing.md` | BLOCKED |
| M26 | SEO | `26-seo.md` | BLOCKED |
| M27 | Analytics / Reporting | `27-analytics-reporting.md` | BLOCKED |
| M28 | Administration | `28-admin.md` | BLOCKED |
| M29 | Security Hardening | `SECURITY.md` + cross-cutting | BLOCKED |
| M30 | Performance / Load | cross-cutting | BLOCKED |
| M31 | Full End-to-End Certification | all of the above | BLOCKED |

Supporting domains `29-notifications.md` and `30-audit-compliance.md`
are cross-cutting and feed into multiple milestones above (primarily
M14–M22 and M29).

## Definition of Done per milestone

See `acceptance/README.md` for the full checklist. No milestone may be
marked complete without satisfying it in full.

## Change log

| Date | Change |
|---|---|
| 2026-09-22 | Documentation/specification foundation established. Build plan created and explicitly marked BLOCKED pending Product Blueprint V2. |
