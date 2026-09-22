# 00. Platform Overview

**Status:** APPROVED (scope/overview only — restates decisions already
approved in `PRODUCT.md` and `ARCHITECTURE.md`; does not itself approve
any domain's business rules beyond what each spec below records)

## Purpose

Entry point tying together the platform's scope and the specification
set. This spec has no independent content beyond pointing to the
canonical sources — it exists so `/specs` is self-contained and does
not require jumping to root docs to understand the overall shape.

## Scope

See `PRODUCT.md` for the full lifecycle (`PURCHASE/PROCUREMENT`
through `ADMINISTRATION`) and `ARCHITECTURE.md` for the approved
technology baseline. Every other file in `/specs` corresponds to one
stage/domain of that lifecycle.

## Specification index

| Spec | Domain | Milestone | Status (2026-09-22) |
|---|---|---|---|
| `01-auth-rbac.md` | Authentication / RBAC | M01 | APPROVED |
| `02-product-master.md` | Product Master | M02 | APPROVED |
| `03-suppliers-procurement.md` | Suppliers | M03 | APPROVED |
| `04-purchase-orders.md` | Procurement / Purchase Orders | M04 | APPROVED |
| `05-grn.md` | Goods Receipt (GRN) | M05 | APPROVED |
| `06-inventory.md` | Inventory | M06 | APPROVED |
| `07-catalog-merchandising.md` | Catalog / Merchandising | M07 | APPROVED |
| `31-organization-locations.md` | Organization & Locations | M00 | APPROVED |
| `32-india-tax-invoicing.md` | India Tax / GST / Invoicing | M08 | DRAFT — compliance items UNDER_REVIEW |
| `08-storefront.md` | Storefront Foundation | M09 | APPROVED |
| `09-search-discovery.md` | Search / Discovery | M10 | APPROVED |
| `10-pdp.md` | Product Detail Page | M11 | APPROVED |
| `11-wishlist-cart.md` | Wishlist / Cart | M12 | APPROVED |
| `12-checkout.md` | Checkout | M13 | APPROVED |
| `13-payment.md` | Payment | M14 | APPROVED |
| `14-order-management.md` | Order Management | M15 | APPROVED |
| `15-warehouse-fulfilment.md` | Warehouse / Fulfilment | M16 | APPROVED |
| `16-shipping-tracking.md` | Shipping / Tracking | M17 | APPROVED |
| `17-cancellation.md` | Cancellation | M18 | APPROVED |
| `18-returns.md` | Returns | M19 | APPROVED |
| `19-refunds.md` | Refunds | M20 | APPROVED |
| `33-store-credit-gift-cards.md` | Store Credit & Gift Cards | M20 / M30 | DRAFT (store credit ledger direction approved) |
| `20-exchanges.md` | Exchanges | M21 | APPROVED |
| `21-customer-profile.md` | Customer 360 | M22 | UNDER_REVIEW — data retention/deletion pending legal input |
| `22-loyalty.md` | Loyalty | M23 | APPROVED |
| `23-promotions.md` | Promotions | M24 | APPROVED |
| `24-marketing.md` | Marketing | M25 | APPROVED |
| `25-social-channel-publishing.md` | Social / Channel Publishing | M26 | APPROVED (adapter architecture only; integrations deferred) |
| `34-ai-product-enrichment.md` | AI Product Enrichment | M02 (optional sub-scope) | DRAFT (architecture approved, capability deferred) |
| `26-seo.md` | SEO | M27 | APPROVED |
| `27-analytics-reporting.md` | Analytics / Reporting | M28 | APPROVED |
| `28-admin.md` | Administration | M29 | APPROVED |
| `29-notifications.md` | Notifications (cross-cutting) | multiple | APPROVED |
| `30-audit-compliance.md` | Audit / Compliance (cross-cutting) | multiple | UNDER_REVIEW — regulatory scope pending legal input |

## Status discipline

See `CLAUDE.md` §3 for the status lifecycle. As of 2026-09-22, the
majority of specs above reached `APPROVED` following the Product Owner's
Blueprint V2 decision session — see `blueprint/DECISION_REGISTER.md`
for the full reconciliation. **`APPROVED` here means the business
rules within that spec's own scope are resolved** (either by explicit
Product Owner instruction or delegated engineering default); it does
**not** mean implementation is authorized — that remains a separate,
explicit gate per `BUILD_PLAN.md` and `CLAUDE.md` §0. A small number of
specs remain below `APPROVED` where a genuine compliance/legal
verification is still pending (`32-india-tax-invoicing.md`,
`21-customer-profile.md`, `30-audit-compliance.md`) — see each spec's
own status line for what specifically remains open.

## Blueprint references

`/blueprint` contains the Product Blueprint V2 decision system. See
`blueprint/README.md` for the audit and `blueprint/DECISION_REGISTER.md`
for all 112 original decisions plus their 2026-09-22 resolutions. The
two domains that audit surfaced as having no dedicated spec now do:
`31-organization-locations.md` and `32-india-tax-invoicing.md`. Two
further specs were added for domains identified during the same
decision session: `33-store-credit-gift-cards.md` and
`34-ai-product-enrichment.md`.
