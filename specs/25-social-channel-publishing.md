# 25. Social / Channel Publishing

**Status:** DRAFT

## Purpose

Define how the product master/catalog is published to channels beyond
the primary website: Google (Shopping/Merchant Center), Meta/Instagram/
Facebook, and future marketplaces.

## Scope

```
PRODUCT MASTER -> CHANNEL PUBLISHING -> WEBSITE / GOOGLE / META / future marketplaces
```

- Channel feed generation (product data mapped to each channel's
  required format)
- Channel-specific availability/pricing overrides (if needed)
- Publishing status tracking per channel per SKU

## Key architectural constraints (approved)

- The product/catalog core must not be tightly coupled to one channel
  (`ARCHITECTURE.md` §7, `PRODUCT.md` §2.E) — this spec is the
  concrete design of that principle.

## Open questions — DECISION_REQUIRED

- **Exact integrations are not yet approved** (`PRODUCT.md` §2.E) —
  which channels launch first (Google, Meta, both, neither initially)?
- Channel-specific business rules (e.g., different pricing or
  availability per channel) — not yet defined.
- Marketplace integrations (future) — none currently approved.

## Acceptance criteria

Not yet defined — requires `APPROVED` status first.

## Dependencies

Depends on: `02-product-master.md`, `07-catalog-merchandising.md`.
Related: `24-marketing.md`, `26-seo.md`.
