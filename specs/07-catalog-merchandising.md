# 07. Catalog / Merchandising / Pricing

**Status:** APPROVED (decided 2026-09-22 — see `blueprint/DECISION_REGISTER.md` `CAT-001`–`004`)

## Purpose

Define how enriched product master data becomes a sellable catalog
listing — pricing, categorization for browsing, merchandising
collections, and publishing status.

## Scope

- Pricing (list price, sale price, price rules)
- Listing/publishing status
- Merchandising collections, category assignment for browsing
- Catalog-to-search indexing trigger

## Approved requirements (2026-09-22)

### Pricing (binding — financial integrity)

- **MRP and selling price are both required** on every SKU, displayed
  **tax-inclusive** (India market norm; exact GST computation tracked
  separately in `specs/32-india-tax-invoicing.md`).
- Single currency/region (INR, India) at launch.
- **Default price MUST be the same across sizes for the same
  style-colour** — size-based pricing is not normal V1 behavior.
- **Scheduled markdown/sale pricing is required**, with configurable
  start/end dates.
- **Historical orders/refunds MUST use the actual transaction price
  paid.** A later product-price change MUST NOT alter the financial
  value of an existing order or refund — this is a hard requirement
  enforced by snapshotting price at order time, not by looking up the
  current catalog price retroactively.

### Publishing & taxonomy

- A SKU's storefront visibility requires **both**: the automated
  `ready_for_qa -> published` completeness gate (`specs/02-product-master.md`
  `PROD-003`) **and** an explicit Merchandiser publish action.
- The catalog browsing category tree and the product attribute
  "category" field are a **single, unified taxonomy** for V1 (not two
  independent structures). Merchandising collections are a separate,
  additive concept layered on top.
- Merchandising badges ("New Arrival," "Bestseller," "Sale") are
  rule-driven where computable, with manual merchandiser override
  always available.

## Remaining open items

MRP legal disclosure mechanics (`TAX-002`) remain `UNDER_REVIEW` in
`specs/32-india-tax-invoicing.md` — does not block this spec's own
build (the display behavior itself is decided).

## Acceptance criteria

See `acceptance/m07-catalog-merchandising.md`.

## Dependencies

Depends on: `specs/02-product-master.md`, `specs/06-inventory.md`.
Feeds: `specs/08-storefront.md`, `specs/09-search-discovery.md`,
`specs/10-pdp.md`, `specs/25-social-channel-publishing.md`,
`specs/26-seo.md`.
