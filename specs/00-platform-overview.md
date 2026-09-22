# 00. Platform Overview

**Status:** APPROVED (scope/overview only — restates decisions already
approved in `PRODUCT.md` and `ARCHITECTURE.md`; does not itself approve
any domain's business rules)

## Purpose

Entry point tying together the platform's scope and the specification
set. This spec has no independent content beyond pointing to the
canonical sources — it exists so `/specs` is self-contained and does
not require jumping to root docs to understand the overall shape.

## Scope

See `PRODUCT.md` for the full lifecycle (`PURCHASE/PROCUREMENT` through
`ADMINISTRATION`) and `ARCHITECTURE.md` for the approved technology
baseline. Every other file in `/specs` corresponds to one stage/domain
of that lifecycle.

## Specification index

| Spec | Domain | Milestone |
|---|---|---|
| `01-auth-rbac.md` | Authentication / RBAC | M01 |
| `02-product-master.md` | Product Master | M02 |
| `03-suppliers-procurement.md` | Suppliers | M03 |
| `04-purchase-orders.md` | Procurement / Purchase Orders | M04 |
| `05-grn.md` | Goods Receipt (GRN) | M05 |
| `06-inventory.md` | Inventory | M06 |
| `07-catalog-merchandising.md` | Catalog / Merchandising | M07 |
| `08-storefront.md` | Storefront Foundation | M08 |
| `09-search-discovery.md` | Search / Discovery | M09 |
| `10-pdp.md` | Product Detail Page | M10 |
| `11-wishlist-cart.md` | Wishlist / Cart | M11 |
| `12-checkout.md` | Checkout | M12 |
| `13-payment.md` | Payment | M13 |
| `14-order-management.md` | Order Management | M14 |
| `15-warehouse-fulfilment.md` | Warehouse / Fulfilment | M15 |
| `16-shipping-tracking.md` | Shipping / Tracking | M16 |
| `17-cancellation.md` | Cancellation | M17 |
| `18-returns.md` | Returns | M18 |
| `19-refunds.md` | Refunds | M19 |
| `20-exchanges.md` | Exchanges | M20 |
| `21-customer-profile.md` | Customer 360 | M21 |
| `22-loyalty.md` | Loyalty | M22 |
| `23-promotions.md` | Promotions | M23 |
| `24-marketing.md` | Marketing | M24 |
| `25-social-channel-publishing.md` | Social / Channel Publishing | M25 |
| `26-seo.md` | SEO | M26 |
| `27-analytics-reporting.md` | Analytics / Reporting | M27 |
| `28-admin.md` | Administration | M28 |
| `29-notifications.md` | Notifications (cross-cutting) | multiple |
| `30-audit-compliance.md` | Audit / Compliance (cross-cutting) | multiple |

## Status discipline

Every spec above starts `DRAFT` unless noted otherwise. See
`CLAUDE.md` §3 for the status lifecycle and who may advance it.
**No spec in this index may be implemented until it reaches
`APPROVED`**, and even then only within an unblocked milestone per
`BUILD_PLAN.md`.

## Blueprint references

`/blueprint` contains the Product Blueprint V2 decision system built
on top of this index — see `blueprint/README.md` for the full
documentation audit and `blueprint/DECISION_REGISTER.md` for all 112
open decisions. Two domains that audit surfaced have **no dedicated
spec above**: the organization/business-entity model (`ORG-001`,
`ORG-002` — see `blueprint/DEPENDENCY_MAP.md`) and India Tax/GST/
Invoicing (`TAX-001` through `TAX-006` — see
`blueprint/INDIA_COMMERCE_GAPS.md`). Decisions for both are currently
recorded against this file until/unless the Product Owner authorizes
dedicated spec files for them.
