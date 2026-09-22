# 02. Product Master

**Status:** DRAFT

## Purpose

Define the canonical product data model: the single source of truth
for what a product *is*, independent of channel, pricing, or
inventory.

## Scope

- Style / Color / Size / Sellable SKU hierarchy
- Extensible attribute system (department, gender, division, category,
  subcategory, collection, season, brand, fabric, fit, pattern,
  occasion, sleeve, neck, wash care, country of origin, and future
  attributes)
- Product enrichment (images, descriptions, additional metadata) —
  the enrichment *process* is in scope here; downstream *display* is
  `specs/10-pdp.md`
- Product identifiers (SKU codes, barcodes/EAN/UPC where applicable)

## Key architectural constraints (approved)

- `STYLE -> COLOR -> SIZE -> SELLABLE SKU` hierarchy is fixed
  (`PRODUCT.md` §2.A, `ARCHITECTURE.md` §4).
- The attribute system must be **data-driven/extensible** — new
  attributes must never require a schema rewrite
  (`ARCHITECTURE.md` §4).
- Must integrate with Medusa v2's product/variant model (ADR-0003)
  without abandoning the fashion-specific attribute extensibility
  requirement above — if Medusa's native model is insufficient, that
  gap must be documented here, not silently worked around.

## Open questions — DECISION_REQUIRED

- Exact attribute taxonomy per department/category (which attributes
  are required vs. optional per product type)?
- How are new attributes added operationally — admin UI, config file,
  or both?
- Product lifecycle states (draft, active, discontinued, archived) and
  who can transition them?
- Relationship between "Product Master" and "Product Enrichment" as
  separate concerns or same record — enrichment ownership (merchandising
  vs. catalog team) not yet defined.
- Country-of-origin / compliance attribute requirements for the target
  market(s) — not yet specified.

## Acceptance criteria

Not yet defined — requires `APPROVED` status first.

## Dependencies

Feeds: `07-catalog-merchandising.md`, `09-search-discovery.md`,
`10-pdp.md`, `06-inventory.md` (SKU is the ledger's product key),
`25-social-channel-publishing.md`, `26-seo.md`.
