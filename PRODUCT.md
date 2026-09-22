# Product Vision

**Status:** DRAFT (this document's own framing/vision text) — the
overall vision below reflects the founding prompt for this project
(approved direction). **Status update (2026-09-22):** most of the
individual business workflows referenced below, which were originally
unfrozen, are now resolved — see `blueprint/DECISION_REGISTER.md` for
the authoritative decision status (105 DECIDED / 7 UNDER_REVIEW / 0
OPEN) and `/specs` for per-domain status (most specs are now
`APPROVED`). Each subsection below is annotated with its current
status.

## 1. What we are building

An independent end-to-end men's and women's **fashion commerce
platform**. This is **not merely an ecommerce storefront** — it is
intended to become a **Fashion Commerce Operating System** covering the
full merchandise and customer lifecycle:

```
PURCHASE / PROCUREMENT
  -> PURCHASE ORDER
  -> GOODS RECEIPT / GRN
  -> QUALITY / EXCEPTIONS
  -> INVENTORY
  -> PRODUCT MASTER
  -> PRODUCT ENRICHMENT
  -> PRICING
  -> CATALOG / LISTING
  -> WEBSITE
  -> SEARCH / DISCOVERY
  -> PLP
  -> PDP
  -> WISHLIST
  -> CART
  -> CHECKOUT
  -> PAYMENT
  -> ORDER
  -> INVENTORY RESERVATION
  -> WAREHOUSE
  -> PICK
  -> PACK
  -> SHIPMENT
  -> DELIVERY
  -> CANCELLATION
  -> RETURN
  -> REFUND
  -> EXCHANGE
  -> CUSTOMER PROFILE
  -> LOYALTY
  -> PROMOTIONS
  -> MARKETING
  -> SOCIAL / CHANNEL PUBLISHING
  -> SEO
  -> ANALYTICS
  -> ADMINISTRATION
```

Each stage above corresponds to a specification document in `/specs`
(see the index there). **Status update (2026-09-22):** most specs are
now `APPROVED` — business rules within them were resolved during the
Product Owner's Blueprint V2 decision session. A small number remain
below `APPROVED` where a genuine compliance/legal dependency is still
pending (`specs/21-customer-profile.md`, `specs/30-audit-compliance.md`,
`specs/32-india-tax-invoicing.md`) — see each spec's own status line.

## 2. Commerce principles (architectural, not yet complete business rules)

These are **binding architectural constraints** the eventual
implementation must satisfy. They are not, by themselves, complete
business specifications — exact rules will be defined per-domain in
`/specs` and must reach `APPROVED` status before implementation.

### A. Fashion product model

The system must support the hierarchy:

```
STYLE -> COLOR -> SIZE -> SELLABLE SKU
```

Product attributes may include (non-exhaustive, must remain
extensible): department, gender, division, category, subcategory,
collection, season, brand, fabric, fit, pattern, occasion, sleeve,
neck, wash care, country of origin, and future custom attributes.

**Constraint:** the product model must never be hard-coded in a way
that makes new attributes impossible to add without a schema rewrite.

### B. Inventory

Inventory must be **auditable**. It must **not** be modeled as a
single mutable counter (`product.quantity = N`).

The architecture must support an **inventory transaction/ledger
model**, with concepts including: stock on hand, reserved, available,
in transit, damaged, return pending, adjustments, receipts, sales,
cancellations, returns, transfers.

**Status update (2026-09-22): DECIDED.** Reservation is short-lived at
checkout only (never add-to-cart), overselling must be prevented, and
the platform is location-aware from day one — see
`specs/06-inventory.md` "Approved requirements" for the full normative
text and `blueprint/DECISION_REGISTER.md` `INV-001` through `007`.

### C. Loyalty

Loyalty must use an **auditable transaction/ledger approach**: earn,
redeem, reverse, expire, adjust.

**Status update (2026-09-22): DECIDED.** The program exists; model is
**points + tiers**, kept structurally separate from store credit and
promotions. Exact earn rate, redemption conversion, and expiry period
remain intentionally configurable business parameters — see
`specs/22-loyalty.md` and `blueprint/DECISION_REGISTER.md` `LOY-001`
through `005`.

### D. Orders

The order lifecycle must eventually support: payment, allocation,
picking, packing, shipment, delivery, cancellation, partial
cancellation, returns, refunds, exchanges, RTO (return-to-origin), and
exceptions.

**Status update (2026-09-22): DECIDED** at the business-shape level
(including split-shipment support and pre-shipment-only cancellation)
— see `specs/14-order-management.md` and related specs (17-20), and
`blueprint/DECISION_REGISTER.md` `ORD-001` through `006`. Exact
state-enum naming is an engineering implementation detail.

### E. Channel architecture

The core product/catalog model must **not** be tightly coupled to a
single sales channel. Conceptually:

```
PRODUCT MASTER -> CHANNEL PUBLISHING -> WEBSITE
                                      -> GOOGLE
                                      -> META / INSTAGRAM / FACEBOOK
                                      -> FUTURE MARKETPLACES
```

**Status update (2026-09-22): DECIDED as architecture-only.** The
adapter/contract publishing pattern above is approved and required;
concrete integrations to any specific channel remain explicitly
un-built pending separate milestone authorization — this is now a
settled decision (`CHAN-001`), not an open question. See
`specs/25-social-channel-publishing.md`.

### F. SEO

SEO is **architectural, not an afterthought**. The system must
eventually accommodate: server-rendered/indexable product content,
metadata, canonical URLs, sitemaps, breadcrumbs, `Product` and
`ProductGroup`/variant structured data, `Offer` data (availability,
pricing, shipping, returns), image metadata, and other ecommerce SEO
requirements.

**Status update (2026-09-22): DECIDED** (engineering convention: URL
structure, canonicalization, redirect handling) — see
`specs/26-seo.md` and `blueprint/DECISION_REGISTER.md` `SEO-001`.

## 3. AI working model

- **ChatGPT** — Product Owner / Product Architect / specification
  partner. Produces and approves the product blueprint and business
  rules.
- **Claude Code** — Principal Engineering Agent. Implements approved
  specifications; never invents unresolved business rules.
- **Lovable** — UI exploration / acceleration only. **Must not**
  become the owner of architecture or core business logic.

See `AGENTS.md` for the full multi-agent protocol.

## 4. What is decided, and what genuinely remains (updated 2026-09-22)

**The Product Blueprint V2 decision session referenced below is now
complete.** Of the items originally listed here as not decided:

- ~~Exact business rules for every domain listed in `/specs`~~ —
  **DECIDED.** Order state machine, return/refund policy, loyalty
  earn/redeem model, promotion stacking rules, and every other
  domain's core business shape are resolved — see
  `blueprint/DECISION_REGISTER.md`.
- ~~Exact third-party integrations beyond the approved baseline~~ —
  **DECIDED as architecture-only.** Adapter/contract patterns are
  approved for future marketplaces and marketing channels; no concrete
  integration is built without separate authorization (`CHAN-001`,
  `MKT-001`).
- ~~Multi-warehouse / multi-location fulfilment rules~~ — **DECIDED.**
  Location-aware from day one; warehouse-only, single/few-location
  operation at launch (`ORG-002`, `INV-004`).
- ~~Exact RBAC role definitions~~ — **DECIDED.** Eleven-role model
  adopted (`ADM-001`) — see `blueprint/OPERATING_ROLES.md`.
- **Tax jurisdiction and compliance rules remain genuinely
  unresolved** — this is the one item from the original list still
  open, and it is **not** a business decision the Product Owner can
  simply make: it requires qualified tax/legal professional
  verification. See `specs/32-india-tax-invoicing.md` and
  `blueprint/DECISION_REGISTER.md` `TAX-001` through `005`
  (`UNDER_REVIEW`). Two further items require the same kind of
  professional verification rather than Product Owner decision:
  customer data retention/deletion policy and applicable regulatory
  requirements (`CUST-001`, `AUD-002`).

Any assumption made about these remaining compliance items by an
engineering agent must never be invented — see `CLAUDE.md` §4 and
`specs/32-india-tax-invoicing.md`.
