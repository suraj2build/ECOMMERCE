# 07. Catalog / Merchandising

**Status:** DRAFT

## Purpose

Define how enriched product master data becomes a sellable catalog
listing — pricing, categorization for browsing, merchandising
collections, and publishing status — for the website channel (and, per
`25-social-channel-publishing.md`, other channels).

## Scope

- Pricing (list price, sale price, price rules — exact promotion
  interaction is `23-promotions.md`)
- Listing/publishing status (which SKUs are visible/purchasable, and
  where)
- Merchandising collections, category assignment for browsing
  (distinct from the product-attribute taxonomy in
  `02-product-master.md`, though related)
- Catalog-to-search indexing trigger (feeds `09-search-discovery.md`)

## Key architectural constraints (approved)

- The product/catalog core must not be tightly coupled to one channel
  (`ARCHITECTURE.md` §7) — catalog/listing data must be structured so
  it can feed multiple channels via publishing, not just the website.

## Open questions — DECISION_REQUIRED

- Pricing model details: currency/region handling, tax-inclusive vs.
  exclusive pricing, minimum price rules — not yet defined.
- Who owns publishing decisions (merchandising role vs. automated
  rules based on inventory availability)?
- Relationship between catalog "category" (browsing/merchandising) and
  product master "category" attribute — single taxonomy or two
  separate ones? Not yet decided.

## Acceptance criteria

Not yet defined — requires `APPROVED` status first.

## Dependencies

Depends on: `02-product-master.md`, `06-inventory.md` (availability).
Feeds: `08-storefront.md`, `09-search-discovery.md`, `10-pdp.md`,
`25-social-channel-publishing.md`, `26-seo.md`.
