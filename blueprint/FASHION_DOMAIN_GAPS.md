# Fashion Domain Gap Analysis

**Purpose:** Audit whether existing specs (primarily
`specs/02-product-master.md`, `specs/07-catalog-merchandising.md`, and
`specs/10-pdp.md`) sufficiently address the fashion-specific concepts
that make this platform different from a generic commerce build.
Classification: **COVERED** (spec already addresses this, even if the
exact rules are still `DECISION_REQUIRED`) · **PARTIAL** (spec
mentions it but incompletely) · **GAP** (not addressed anywhere in
`/specs`).

## Core hierarchy

| Concept | Status | Notes |
|---|---|---|
| STYLE → COLOR → SIZE → SKU | **COVERED** | Fixed as an architectural constraint (`ARCHITECTURE.md` §4, ADR-derived); `specs/02-product-master.md` scopes it. |

## Attribute taxonomy

| Concept | Status | Notes | Decision ID |
|---|---|---|---|
| Category hierarchy | **PARTIAL** | Attribute exists but governance (`PROD-001`) and the relationship to catalog browsing category (`CAT-003`) are open. | `PROD-001`, `CAT-003` |
| Brand | **COVERED** | Listed as an attribute in `specs/02-product-master.md`; no open gap beyond taxonomy governance. | `PROD-001` |
| Season | **COVERED** | Listed as an attribute. | `PROD-001` |
| Collection | **COVERED** | Listed as an attribute; relationship to `CAT-004` merchandising badges not addressed. | `PROD-001`, `CAT-004` |
| Gender/department | **COVERED** | Listed as an attribute. | `PROD-001` |
| Fabric | **COVERED** | Listed as an attribute. | `PROD-001` |
| Fit | **COVERED** | Listed as an attribute. | `PROD-001` |
| Pattern | **COVERED** | Listed as an attribute. | `PROD-001` |
| Occasion | **COVERED** | Listed as an attribute. | `PROD-001` |
| Sleeve | **COVERED** | Listed as an attribute. | `PROD-001` |
| Neck | **COVERED** | Listed as an attribute. | `PROD-001` |
| Wash care | **COVERED** | Listed as an attribute; legal *display* requirement on PDP is a separate open compliance question — see `INDIA_COMMERCE_GAPS.md`. | `PROD-001` |
| Country of origin | **PARTIAL** | Listed as an attribute; legal declaration requirement unverified. | `PROD-001`, `TAX-003` |

All of the above are listed as attributes in `specs/02-product-master.md`
but the *taxonomy governance mechanism* (`PROD-001`) and *per-category
required/optional rules* (`PROD-002`) remain open — so while the
concepts are named, the system is not yet fully specified.

## Size & fit

| Concept | Status | Notes | Decision ID |
|---|---|---|---|
| Size chart | **GAP** | Not explicitly modeled in `specs/02-product-master.md` beyond the general attribute list; no dedicated size-chart entity. | `PROD-004` |
| Size-chart versioning | **GAP** | Not addressed at all — important for consistent post-hoc return-reason analysis (a past order should show the chart in effect at purchase time). | `PROD-004` |
| Model measurements | **GAP** | Not mentioned anywhere. | `PROD-005` |
| Model-worn size | **GAP** | Not mentioned anywhere. | `PROD-005` |

## Product media

| Concept | Status | Notes | Decision ID |
|---|---|---|---|
| Product media (images) | **PARTIAL** | `specs/02-product-master.md` mentions "product enrichment (images, ...)" generically but does not define image count/requirements, ordering, or per-variant imagery rules. | *(no dedicated ID yet — recommend adding under `PROD-002` scope)* |
| Image ordering | **GAP** | Not addressed. | *(recommend adding)* |
| Video | **GAP** | Not mentioned anywhere in `/specs`. | *(recommend adding)* |
| Swatches | **GAP** | Color swatch representation not mentioned. | *(recommend adding)* |
| Variant imagery (does each color get its own image set?) | **GAP** | Not addressed — a common fashion-ecommerce requirement (color variant selection should update the image gallery). | *(recommend adding, relates to `specs/10-pdp.md`)* |

**Recommendation:** These five media-related gaps should likely be
consolidated into a new decision (e.g., `PROD-007` — Product media
requirements: count, ordering, video, swatches, variant imagery) once
the Product Owner confirms scope. Not added to the register yet
because scope (which of these are launch-required vs. deferred) is
itself undecided — adding a decision ID prematurely risked implying a
specific answer.

## SEO content

| Concept | Status | Notes | Decision ID |
|---|---|---|---|
| SEO content (meta, structured data) | **COVERED** at the architecture level | `specs/26-seo.md` exists and is scoped; exact structured-data mapping from the attribute model is open. | `SEO-001` |

## Merchandising tags/badges

| Concept | Status | Notes | Decision ID |
|---|---|---|---|
| New arrival, bestseller, markdown, sale badges | **PARTIAL** | `specs/07-catalog-merchandising.md` mentions "merchandising collections" generically; the specific badge concepts and their rule ownership are a distinct open question. | `CAT-004` |

## Product lifecycle

| Concept | Status | Notes | Decision ID |
|---|---|---|---|
| Draft / ready for enrichment / ready for QA / published / unpublished / archived | **PARTIAL** | `specs/02-product-master.md` asks "what lifecycle states exist" generically but does not enumerate this specific state set — this document proposes it as a starting point. | `PROD-003` |
| Product completeness / content QA gate | **GAP** | Not addressed — no explicit "is this product ready to publish" completeness check is defined anywhere. | `PROD-002`, `PROD-003` |

## Bulk operations

| Concept | Status | Notes | Decision ID |
|---|---|---|---|
| Bulk product operations | **GAP** | Not mentioned anywhere in `/specs`. | `PROD-006` |
| Bulk price changes | **GAP** | Not mentioned anywhere. | `PROD-006` |
| Bulk publishing | **GAP** | Not mentioned anywhere. | `PROD-006` |

## Fashion-specific returns/exchanges

| Concept | Status | Notes | Decision ID |
|---|---|---|---|
| Returns due to size/fit | **PARTIAL** | `specs/18-returns.md` covers general return eligibility but does not name size/fit as a distinct, high-frequency reason category requiring specific handling (e.g., faster exchange path). | `RET-001`, `RET-002` |
| Exchange for a different size | **PARTIAL** | `specs/20-exchanges.md` covers exchange generically; size-specific exchange (the most common fashion exchange case) is not called out distinctly. | `EXC-001` |
| Exchange for a different colour | **PARTIAL** | Same as above. | `EXC-001` |
| Replacement SKU reservation during exchange | **GAP** | Not addressed — when a customer requests an exchange, does the replacement SKU get reserved immediately (before the original item is even received back), risking a stockout on the replacement by the time the original arrives? This is a real inventory-integrity question specific to exchanges. | *(no dedicated ID — recommend adding, e.g. `EXC-004`, once `EXC-001` is decided, since the answer depends on the exchange data model chosen)* |

---

## Summary

The **core fashion attribute taxonomy is named** in `specs/02-product-master.md`
(all of department/gender/division/category/subcategory/collection/
season/brand/fabric/fit/pattern/occasion/sleeve/neck/wash-care/
country-of-origin are present), so this is not a case of the platform
ignoring fashion-specific needs. The real gaps are:

1. **Size chart and size-chart versioning** — entirely unmodeled
   (`PROD-004`).
2. **Product media requirements** (image ordering, video, swatches,
   variant imagery) — entirely unmodeled, no decision ID assigned
   pending Product Owner scoping.
3. **Product lifecycle/QA gate** — named as a question but not given a
   concrete proposed state set until this document (`PROD-003`).
4. **Bulk operations** — entirely unmodeled (`PROD-006`).
5. **Replacement SKU reservation timing during exchange** — a genuine
   inventory-integrity risk specific to the exchange flow, not
   currently named anywhere (see recommendation above).

None of these gaps block the documentation-foundation stage — they are
exactly the kind of finding this Product Blueprint V2 exercise exists
to surface before implementation begins.
