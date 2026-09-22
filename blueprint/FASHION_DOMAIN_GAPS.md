# Fashion Domain Gap Analysis

**Status update (2026-09-22):** Every gap this document originally
identified has been resolved by the Product Owner's Blueprint V2
decision session — most explicitly, since §5 of that session's
instruction directly addressed size charts, product media, product
lifecycle, and bulk operations in detail. This document is preserved
as the original audit record; every row below now shows its resolution
status alongside the original finding. See `specs/02-product-master.md`
"Approved requirements" for the resulting normative (MUST/SHOULD)
text.

**Purpose:** Audit whether existing specs (primarily
`specs/02-product-master.md`, `specs/07-catalog-merchandising.md`, and
`specs/10-pdp.md`) sufficiently address the fashion-specific concepts
that make this platform different from a generic commerce build.
Original classification: **COVERED** · **PARTIAL** · **GAP**. Current
resolution status is now shown alongside each.

## Core hierarchy

| Concept | Original status | Current status |
|---|---|---|
| STYLE → COLOR → SIZE → SKU | **COVERED** | **DECIDED** — fixed architectural constraint, unchanged. |

## Attribute taxonomy

| Concept | Original status | Current status | Decision ID |
|---|---|---|---|
| Category hierarchy | PARTIAL | **DECIDED** — hybrid governance model adopted; browsing/attribute category unified as one taxonomy | `PROD-001`, `CAT-003` |
| Brand | COVERED | **DECIDED** — first-class entity, every style references one | `PROD-001`, `ORG-001` |
| Season | COVERED | **DECIDED** — required field | `PROD-001` |
| Collection | COVERED | **DECIDED** — required field; badge-rule relationship (`CAT-004`) also decided (rule-driven + manual override) | `PROD-001`, `CAT-004` |
| Gender/department, Fabric, Fit, Pattern, Occasion, Sleeve, Neck | COVERED | **DECIDED** — all listed attributes, governance resolved | `PROD-001` |
| Wash care | COVERED | **DECIDED** as an attribute; legal *display* requirement remains `UNDER_REVIEW` | `PROD-001`; display question tracked in `specs/32-india-tax-invoicing.md` |
| Country of origin | PARTIAL | **DECIDED** as an attribute; legal declaration requirement remains `UNDER_REVIEW` (`TAX-003`) | `PROD-001`, `TAX-003` |

Taxonomy governance (`PROD-001`) and per-category required/optional
rules (`PROD-002`) are both **DECIDED** — see `specs/02-product-master.md`.

## Size & fit

| Concept | Original status | Current status | Decision ID |
|---|---|---|---|
| Size chart | GAP | **DECIDED** — required; supports different charts by category/gender/brand | `PROD-004` |
| Size-chart versioning | GAP | **DECIDED** — required, effective-dated | `PROD-004` |
| Model measurements | GAP | **DECIDED** — included as an optional (non-mandatory) enrichment field | `PROD-005` |
| Model-worn size | GAP | **DECIDED** — same as above | `PROD-005` |

## Product media

| Concept | Original status | Current status | Decision ID |
|---|---|---|---|
| Product media (images) | PARTIAL | **DECIDED** — multiple images required | `PROD-001` (media requirements folded into the core spec, not a separate decision) |
| Image ordering | GAP | **DECIDED** — required | same |
| Video | GAP | **DECIDED** — video capability required | same |
| Swatches | GAP | **DECIDED** — swatches required | same |
| Variant imagery | GAP | **DECIDED** — colour/variant-specific imagery required | same |
| Alt text / SEO metadata per asset | *(not previously listed)* | **DECIDED** — required per asset | same |

The originally-recommended new decision ID (`PROD-007`) was not
needed: the Product Owner's instruction (§5) resolved all of these
directly and specifically, so they were folded into
`specs/02-product-master.md`'s approved requirements rather than
registered as a separate pending decision.

## SEO content

| Concept | Original status | Current status | Decision ID |
|---|---|---|---|
| SEO content (meta, structured data) | COVERED at architecture level | **DECIDED** — URL structure/canonicalization engineering convention set | `SEO-001` |

## Merchandising tags/badges

| Concept | Original status | Current status | Decision ID |
|---|---|---|---|
| New arrival, bestseller, markdown, sale badges | PARTIAL | **DECIDED** — rule-driven where computable, manual override available | `CAT-004` |

## Product lifecycle

| Concept | Original status | Current status | Decision ID |
|---|---|---|---|
| Draft / ready for enrichment / ready for QA / published / unpublished / archived | PARTIAL | **DECIDED** — this exact six-state model adopted | `PROD-003` |
| Product completeness / content QA gate | GAP | **DECIDED** — `published` requires passing `ready_for_qa` AND explicit Merchandiser action | `PROD-002`, `PROD-003`, `CAT-002` |

## Bulk operations

| Concept | Original status | Current status | Decision ID |
|---|---|---|---|
| Bulk product operations, bulk price changes, bulk publishing/unpublishing | GAP | **DECIDED** — all required (explicit, §5) | `PROD-006` |

## Fashion-specific returns/exchanges

| Concept | Original status | Current status | Decision ID |
|---|---|---|---|
| Returns due to size/fit | PARTIAL | **DECIDED** — standard return flow covers this; no distinct fast-path decided (uses standard `RET-001`/`RET-002` rules) | `RET-001`, `RET-002` |
| Exchange for a different size | PARTIAL | **DECIDED** — explicitly required | `EXC-001`, `EXC-002` |
| Exchange for a different colour | PARTIAL | **DECIDED** — explicitly required, alongside size exchange | `EXC-001`, `EXC-002` |
| Replacement SKU reservation during exchange | GAP | **DECIDED** — reserved at exchange-request time, using the same short-lived reservation mechanics as checkout (`INV-002`) | `EXC-002` (the gap's proposed `EXC-004` was not needed — folded into `EXC-002`'s resolution) |

---

## Summary (updated 2026-09-22)

Every gap this analysis originally surfaced is now resolved:

1. **Size chart and size-chart versioning** — `DECIDED`, required with
   category/gender/brand variation and versioning (`PROD-004`).
2. **Product media requirements** (image ordering, video, swatches,
   variant imagery, alt text, SEO metadata) — `DECIDED`, all required,
   folded directly into `specs/02-product-master.md`.
3. **Product lifecycle/QA gate** — `DECIDED`, the six-state model this
   document proposed was adopted as-is (`PROD-003`).
4. **Bulk operations** — `DECIDED`, all required (`PROD-006`).
5. **Replacement SKU reservation timing during exchange** — `DECIDED`,
   resolved as part of `EXC-002`.

No fashion-domain gap remains open. The only related items still
`UNDER_REVIEW` are the India-compliance-specific display/declaration
questions (wash care labeling, country-of-origin declaration) tracked
in `specs/32-india-tax-invoicing.md` and
`blueprint/INDIA_COMMERCE_GAPS.md` — these were never fashion-domain
gaps in the sense this document addresses; they are legal-verification
items.
