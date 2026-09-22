# Product Vision

**Status:** DRAFT — the overall vision below reflects the founding
prompt for this project (approved direction), but individual business
workflows referenced here are **not yet frozen specifications**. See
`/specs` for per-domain status.

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
(see the index there). Most are currently `DRAFT` — meaning the domain
is scoped, but business rules within it are not yet approved for
implementation.

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

Exact business rules for these states and their transitions are
**not frozen** — see `specs/06-inventory.md`.

### C. Loyalty

Loyalty must use an **auditable transaction/ledger approach**: earn,
redeem, reverse, expire, adjust. Exact loyalty rules are **not
frozen** — see `specs/22-loyalty.md`.

### D. Orders

The order lifecycle must eventually support: payment, allocation,
picking, packing, shipment, delivery, cancellation, partial
cancellation, returns, refunds, exchanges, RTO (return-to-origin), and
exceptions. Exact states and transition rules are **not frozen** — see
`specs/14-order-management.md` and related specs (17-20).

### E. Channel architecture

The core product/catalog model must **not** be tightly coupled to a
single sales channel. Conceptually:

```
PRODUCT MASTER -> CHANNEL PUBLISHING -> WEBSITE
                                      -> GOOGLE
                                      -> META / INSTAGRAM / FACEBOOK
                                      -> FUTURE MARKETPLACES
```

Exact integrations are **not yet approved** — see
`specs/25-social-channel-publishing.md`.

### F. SEO

SEO is **architectural, not an afterthought**. The system must
eventually accommodate: server-rendered/indexable product content,
metadata, canonical URLs, sitemaps, breadcrumbs, `Product` and
`ProductGroup`/variant structured data, `Offer` data (availability,
pricing, shipping, returns), image metadata, and other ecommerce SEO
requirements. Exact implementation is **not frozen** — see
`specs/26-seo.md`.

## 3. AI working model

- **ChatGPT** — Product Owner / Product Architect / specification
  partner. Produces and approves the product blueprint and business
  rules.
- **Claude Code** — Principal Engineering Agent. Implements approved
  specifications; never invents unresolved business rules.
- **Lovable** — UI exploration / acceleration only. **Must not**
  become the owner of architecture or core business logic.

See `AGENTS.md` for the full multi-agent protocol.

## 4. What is explicitly NOT decided yet

The following require a **Product Blueprint V2** and explicit
human/product-owner approval before any implementation begins:

- Exact business rules for every domain listed in `/specs`
  (order state machines, return/refund policy, loyalty earn/redeem
  rules, promotion stacking rules, etc.)
- Exact third-party integrations beyond the approved baseline
  (marketplaces, marketing channels, analytics providers)
- Multi-warehouse / multi-location fulfilment rules
- Tax jurisdiction and compliance rules
- Exact RBAC role definitions beyond "authentication/RBAC must exist"

Any assumption made about these areas by an engineering agent must be
recorded as `DECISION_REQUIRED` in the relevant spec — never silently
implemented.
