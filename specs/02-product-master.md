# 02. Product Master

**Status:** APPROVED (decided 2026-09-22 — see `blueprint/DECISION_REGISTER.md` `PROD-001`–`006`, `ORG-001`, `CAT-003`)

## Purpose

Define the canonical product data model: the single source of truth
for what a product *is*, independent of channel, pricing, or
inventory.

## Scope

- Style / Color / Size / Sellable SKU hierarchy
- Extensible attribute system
- Product enrichment (images, descriptions, additional metadata)
- Product identifiers (SKU codes, barcodes/EAN/UPC where applicable)
- Brand, size charts, product media, bulk operations

## Key architectural constraints (approved)

- `STYLE -> COLOR -> SIZE -> SELLABLE SKU` hierarchy is fixed
  (`PRODUCT.md` §2.A, `ARCHITECTURE.md` §4).
- The attribute system MUST be data-driven/extensible — new attributes
  MUST NOT require a schema rewrite.
- Every style MUST reference exactly one **Brand** (first-class entity,
  not free text — see `specs/31-organization-locations.md`).

## Approved requirements (2026-09-22)

### Attributes

- Product attributes MUST support: brand, department, gender,
  division, category, subcategory, **season** (required), **collection**
  (required), fabric, fit, pattern, occasion, sleeve, neck, wash care,
  country of origin, and extensible custom attributes.
- Core/structural attributes MUST live in a versioned, reviewed
  schema/config; merchandising-facing tags/badges MAY be managed
  self-service via the admin UI by the Merchandiser role.
- Required-vs-optional attributes per department/category MUST be
  implemented as data-driven, per-category configuration — not
  hard-coded per product type.
- An **HSN code field** MUST exist at category-default and per-SKU
  override level (nullable until `specs/32-india-tax-invoicing.md`'s
  compliance verification confirms exact requirements).

### Product lifecycle

- Products MUST support the lifecycle:
  `draft -> ready_for_enrichment -> ready_for_qa -> published -> unpublished -> archived`.
- `published` MUST require the QA gate to have passed AND an explicit
  Merchandiser publish action (see `specs/07-catalog-merchandising.md`
  `CAT-002`) — automation alone or a manual action alone is
  insufficient.
- AI-assisted enrichment content (see `specs/34-ai-product-enrichment.md`)
  is subject to this exact same QA gate — it MUST NOT bypass it.

### Size charts

- Size charts are **required**.
- Size charts MUST support different charts by category, gender, and/or
  brand where applicable.
- Size-chart versioning MUST be supported — a past order/return MUST be
  able to show the chart version in effect at the time of purchase.

### Product media

- Product media MUST support: multiple images, image ordering,
  colour/variant-specific imagery, swatches, video capability, alt
  text, and SEO metadata per asset.
- Model measurements / model-worn-size display MAY be included as an
  optional (non-mandatory) enrichment field.

### Bulk operations

- The platform MUST support bulk product import, bulk enrichment, bulk
  pricing, bulk publishing, and bulk unpublishing.
- Bulk inventory operations MUST require authorization per
  `specs/28-admin.md` `ADM-003` and MUST be fully audited.

## Remaining open items

`TAX-003` (exact HSN mandatoriness/threshold) remains
`UNDER_REVIEW` in `specs/32-india-tax-invoicing.md` — does not block
this spec's own build (the schema field exists regardless of outcome).

## Acceptance criteria

See `acceptance/m02-product-master.md`.

## Dependencies

Feeds: `specs/07-catalog-merchandising.md`, `specs/09-search-discovery.md`,
`specs/10-pdp.md`, `specs/06-inventory.md`, `specs/25-social-channel-publishing.md`,
`specs/26-seo.md`, `specs/34-ai-product-enrichment.md`.
