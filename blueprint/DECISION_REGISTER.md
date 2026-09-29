# Decision Register

**Status:** This register was reconciled against the Product Owner's
Blueprint V2 decision instruction on **2026-09-22**. Every decision
below is one of:

- **DECIDED** — resolved by explicit Product Owner instruction, or (where
  the instruction delegated a technical/engineering choice that does not
  change approved business behavior — see `CLAUDE.md`/`AGENTS.md` §
  "Technical Decision Authority") resolved by the Principal Engineering
  Agent as a documented default. Engineering-authored defaults are
  labeled `(engineering default)` and remain open to Product Owner
  override at any time — they are not frozen business commitments.
- **UNDER_REVIEW** — the Product Owner's business direction is either
  not yet given or, more commonly in this register, the item is
  fundamentally a **compliance/legal question requiring verification**
  by a qualified tax/legal professional, not a business preference the
  Product Owner can simply state. No engineering agent may convert
  these to `DECIDED` — see `INDIA_COMMERCE_GAPS.md`.
- **OPEN** — genuinely unresolved and not safely deferrable to
  configuration. **None remain after this reconciliation** — see
  summary below.

**No engineering agent invented a business rule here.** Every
`DECIDED` entry below traces to an explicit instruction in the
2026-09-22 Product Owner session, or is marked `(engineering default)`
and traces to the delegated technical-decision authority that same
session explicitly granted (choices that don't change approved
business behavior: session mechanics, identifier formats, module
boundaries, API conventions, retry mechanics, etc.).

See `OPEN_QUESTIONS.md` for the (now largely historical) prioritized
questionnaire this register was originally built from. See
`READINESS.md` for how these decisions gate each domain's
build-readiness — that document is being superseded by
`BUILD_PLAN.md`'s new readiness classification in this same update.

## Reconciliation summary (2026-09-22, updated 2026-09-24 for M16)

| | Count |
|---|---|
| **DECIDED** | **106** |
| **UNDER_REVIEW** | **8** |
| **OPEN** | **0** |
| Total | 114 |

2026-09-24 additions (M16 build): `WH-003` (DECIDED, engineering
default - the M16 state-machine/data-model shape) and `SEC-001`
(`UNDER_REVIEW` - the consolidated pre-production security & privacy
gate the M16 build instruction required the roadmap to track).

**P0 remaining (not DECIDED):** 5 — all five are India GST/tax
compliance items (`TAX-001` through `TAX-005`) that are fundamentally
legal-verification tasks, not Product Owner business decisions. No
P0 item blocks M00 or M01.

**P1 remaining (not DECIDED):** 2 — `CUST-001` (data retention/deletion,
needs legal input) and `AUD-002` (applicable regulatory requirements,
needs legal input).

**P2 remaining (not DECIDED):** 0.

**No Product-Owner-answerable blocker remains for M00 or M01.** The 7
`UNDER_REVIEW` items are all routed to external professional
verification (tax/legal), not further Product Owner questionnaires —
see `README.md` §"Remaining questions" for the complete, minimal list
of what is still needed from anyone, and from whom.

## How to use this register

- Every decision keeps its stable **ID** (`DOMAIN-NNN`) permanently.
- `Status`, `Final decision`, and `Decision date` are now filled in for
  every entry. `Affected specs` shows where the decision has been (or
  still needs to be) propagated as normative (`MUST`/`SHOULD`/`MAY`)
  language — see the updated `/specs` files themselves for the actual
  requirement text; this register records *that* a decision was made
  and *what* it was, not the full spec prose.
- The original `Question`, `Why it matters`, `Dependencies`,
  `Recommended options`, and `Trade-offs` fields are retained for
  historical/audit context even after a decision is made — they
  explain why the resolution was reached.

## Domain index

| Prefix | Domain | Count | Decided | Under review |
|---|---|---|---|---|
| AUTH | Authentication / RBAC | 3 | 3 | 0 |
| ORG | Organization / business entity model | 2 | 2 | 0 |
| PROD | Product Master | 6 | 6 | 0 |
| SUP | Suppliers | 2 | 2 | 0 |
| PO | Purchase Orders | 3 | 3 | 0 |
| GRN | Goods Receipt / QC | 3 | 3 | 0 |
| INV | Inventory | 7 | 7 | 0 |
| CAT | Catalog / Merchandising / Pricing | 4 | 4 | 0 |
| SF | Storefront | 2 | 2 | 0 |
| SRCH | Search / Discovery | 2 | 2 | 0 |
| PDP | Product Detail Page | 2 | 2 | 0 |
| CART | Wishlist / Cart | 3 | 3 | 0 |
| CHK | Checkout | 4 | 4 | 0 |
| PAY | Payment | 6 | 6 | 0 |
| ORD | Order Management | 6 | 6 | 0 |
| WH | Warehouse / Fulfilment | 2 | 2 | 0 |
| SHIP | Shipping / Tracking | 4 | 4 | 0 |
| CAN | Cancellation | 3 | 3 | 0 |
| RET | Returns | 4 | 4 | 0 |
| REF | Refunds | 4 | 4 | 0 |
| EXC | Exchanges | 3 | 3 | 0 |
| CUST | Customer 360 | 3 | 2 | 1 |
| LOY | Loyalty | 5 | 5 | 0 |
| PROMO | Promotions | 2 | 2 | 0 |
| MKT | Marketing | 1 | 1 | 0 |
| CHAN | Channel Publishing | 1 | 1 | 0 |
| SEO | SEO | 1 | 1 | 0 |
| ANL | Analytics / Reporting | 1 | 1 | 0 |
| ADM | Admin / Operating Roles | 3 | 3 | 0 |
| NOTIF | Notifications | 1 | 1 | 0 |
| AUD | Audit / Compliance | 2 | 1 | 1 |
| TAX | India Tax / GST | 6 | 1 | 5 |
| IND | Other India-specific commerce | 5 | 5 | 0 |
| NFR | Non-functional requirements | 6 | 6 | 0 |
| **Total** | | **112** | **105** | **7** |

---

## AUTH — Authentication / RBAC

#### AUTH-001 — Customer authentication method(s) · **P0**
- **Question:** Which authentication method(s) must the storefront support at launch?
- **Dependencies:** IND-001, CUST-001
- **Status:** DECIDED · **Decision date:** 2026-09-22
- **Final decision:** Mobile OTP is the **primary** customer authentication method (India-first). Email is optional/supporting. **Guest checkout is required** (see `CHK-001`) — authentication is never a precondition for purchase. Appropriate contact information (mobile, and email if provided) is captured for order processing and transactional communication regardless of account status; the customer may be invited to activate/access a full account after purchase.
- **Affected specs:** `specs/01-auth-rbac.md`, `specs/12-checkout.md`

#### AUTH-002 — Staff/admin authentication & MFA requirement · **P0**
- **Question:** What authentication method(s) do internal/admin users use, and is MFA mandatory for any role?
- **Dependencies:** ADM-001
- **Status:** DECIDED (engineering default) · **Decision date:** 2026-09-22
- **Final decision:** Password + mandatory MFA for all roles with elevated/approval authority (Super Admin, Business Admin, Finance, and any role granted approval permissions under `ADM-001`); MFA available and encouraged, not mandatory, for execution-only roles (Warehouse Operator, Catalog contributor). This follows the Product Owner's instruction to "choose a secure, maintainable default... and document the decision" (§11) using security/maintainability as the selection criteria (§30) — not a weakened default.
- **Affected specs:** `specs/01-auth-rbac.md`, `SECURITY.md`

#### AUTH-003 — Session/token strategy · **P1**
- **Question:** JWT vs. server-side session store for customer and staff sessions?
- **Dependencies:** none
- **Status:** DECIDED (engineering default) · **Decision date:** 2026-09-22
- **Final decision:** Short-lived JWT access token + refresh token for customer sessions (scales statelessly for storefront traffic). Server-side, instantly-revocable session (Redis-backed) for staff/admin sessions, where offboarding/compromise revocation speed outweighs statelessness benefits. Selected per §30 criteria (security, maintainability).
- **Affected specs:** `specs/01-auth-rbac.md`

---

## ORG — Organization / business entity model

#### ORG-001 — Single legal entity vs. multi-brand/multi-tenant model · **P0**
- **Question:** Single entity/brand, or multiple brands/entities from day one?
- **Dependencies:** TAX-001, PROD-001
- **Status:** DECIDED · **Decision date:** 2026-09-22
- **Final decision:** Single legal entity/platform operator. The company **may operate different owned brands by product** — **Brand is a first-class domain/entity**, not free text; products/styles reference a brand. This is **not** a third-party multi-seller marketplace model — the initial operation does not require external sellers on the platform's own site. The architecture must not block future *outbound* marketplace/channel integrations (see `CHAN-001`).
- **Affected specs:** `specs/00-platform-overview.md`, `specs/02-product-master.md`, `specs/31-organization-locations.md`, `PRODUCT.md`

#### ORG-002 — Warehouse/location model at launch · **P0**
- **Question:** Single warehouse/location, or multi-location from launch? (Same decision as `INV-004`.)
- **Dependencies:** INV-004 (decided together), WH-001
- **Status:** DECIDED · **Decision date:** 2026-09-22
- **Final decision:** Inventory and operational architecture **MUST be location-aware from day one** — every inventory transaction must be capable of referencing a location, and stock transfers between locations must be supported by the domain model. **Initial operation is warehouse-inventory only** (one or a small number of warehouses). Physical stores, stores-holding-inventory, click & collect, and ship-from-store are **FUTURE_CONSIDERATION** — the model must not require redesign to add them later, but none are built now.
- **Affected specs:** `specs/06-inventory.md`, `specs/15-warehouse-fulfilment.md`, `specs/04-purchase-orders.md`, `specs/31-organization-locations.md`

---

## PROD — Product Master

#### PROD-001 — Attribute taxonomy governance · **P0**
- **Question:** Who defines/extends the fashion attribute taxonomy, and through what mechanism?
- **Dependencies:** ORG-001
- **Status:** DECIDED (engineering default) · **Decision date:** 2026-09-22
- **Final decision:** Hybrid governance. Core/structural attributes (brand, department, gender, division, category, subcategory, season, collection, fabric, fit, pattern, occasion, sleeve, neck, wash care, country of origin) live in a versioned, reviewed schema/config, extended by the Catalog role. Merchandising-facing tags/badges (`CAT-004`) are admin-UI-managed by the Merchandiser role for agility. **Season and collection are required fields** on every style (explicit Product Owner instruction, §5).
- **Affected specs:** `specs/02-product-master.md`

#### PROD-002 — Required vs. optional attributes per department/category · **P1**
- **Question:** Which attributes are mandatory, and does this vary by category?
- **Dependencies:** PROD-001, CAT-002
- **Status:** DECIDED (configurable) · **Decision date:** 2026-09-22
- **Final decision:** Implemented as data-driven, per-category configuration (a required-attribute rule set keyed by category/department), not hard-coded per product type. Exact per-category rules are an operational catalog-configuration task, not a development blocker.
- **Affected specs:** `specs/02-product-master.md`

#### PROD-003 — Product lifecycle states · **P1**
- **Question:** What is the full product lifecycle state set?
- **Dependencies:** PROD-001
- **Status:** DECIDED (engineering default) · **Decision date:** 2026-09-22
- **Final decision:** Adopt `draft -> ready_for_enrichment -> ready_for_qa -> published -> unpublished -> archived`, satisfying the explicit requirement that "product enrichment and QA workflow must be supported" (§5). `published` requires the QA gate to have passed (see `CAT-002`).
- **Affected specs:** `specs/02-product-master.md`, `specs/07-catalog-merchandising.md`

#### PROD-004 — Size chart model & versioning · **P1**
- **Question:** How are size charts modeled, and are they versioned?
- **Dependencies:** PROD-001
- **Status:** DECIDED · **Decision date:** 2026-09-22
- **Final decision:** Size charts are **required**. They **MUST support different charts by appropriate dimensions such as category / gender / brand** where applicable (explicit, §5). **Size-chart versioning MUST be supported** — a past order/return must be able to show the chart version in effect at the time of purchase.
- **Affected specs:** `specs/02-product-master.md`, `specs/10-pdp.md`

#### PROD-005 — Model measurements / model-worn-size display · **P2**
- **Question:** Is displaying model measurements/worn-size in scope?
- **Dependencies:** PROD-004
- **Status:** DECIDED (engineering default) · **Decision date:** 2026-09-22
- **Final decision:** Included as an **optional** (non-mandatory) enrichment/media field within the product media model. Not launch-blocking; does not require further Product Owner decision.
- **Affected specs:** `specs/02-product-master.md`, `specs/10-pdp.md`

#### PROD-006 — Bulk product operations scope · **P2**
- **Question:** Are bulk operations required for launch?
- **Dependencies:** CAT-002, ADM-002
- **Status:** DECIDED · **Decision date:** 2026-09-22
- **Final decision:** **Required.** Explicit examples given: bulk product import, bulk enrichment, bulk pricing, bulk inventory operations **with authorization**, bulk publishing, bulk unpublishing (§5). Bulk inventory operations specifically require the authorization/audit workflow from `ADM-003`.
- **Affected specs:** `specs/02-product-master.md`, `specs/28-admin.md`

---

## SUP — Suppliers

#### SUP-001 — Supplier hierarchy support · **P1**
- **Question:** Must the platform model supplier hierarchies?
- **Dependencies:** PO-001
- **Status:** DECIDED (engineering default) · **Decision date:** 2026-09-22
- **Final decision:** Flat supplier list at launch, with the schema left extensible for hierarchy later (not a blocker). The supplier entity must accommodate **both** finished-merchandise suppliers **and** finished-goods manufacturing/job-work suppliers (explicit, §6) via a supplier-type/category field — both flow through the same PO process. Raw-material inventory, BOM, and production-execution tracking are explicitly **out of V1 scope** (§6).
- **Affected specs:** `specs/03-suppliers-procurement.md`

#### SUP-002 — Supplier portal/self-service access · **P2**
- **Question:** Do suppliers get self-service access?
- **Dependencies:** AUTH-001, ADM-001
- **Status:** DECIDED · **Decision date:** 2026-09-22
- **Final decision:** No supplier self-service portal at launch; all supplier data/interaction is internal-only. A future supplier portal is **FUTURE_CONSIDERATION**, not blocking.
- **Affected specs:** `specs/03-suppliers-procurement.md`

---

## PO — Purchase Orders

#### PO-001 — PO approval hierarchy & thresholds · **P0**
- **Question:** Who can approve a PO, and are there value-based thresholds?
- **Dependencies:** ADM-001
- **Status:** DECIDED · **Decision date:** 2026-09-22
- **Final decision:** **PO approval workflow is required** (explicit, §6). Value-based approval thresholds are supported and **MUST be configurable business parameters**, not hard-coded. Approvers are drawn from the Buying/Finance/Business Admin roles per the `ADM-001` permission matrix.
- **Affected specs:** `specs/04-purchase-orders.md`

#### PO-002 — Partial receipt / over-under delivery tolerance · **P1**
- **Question:** What tolerance applies for short/excess delivery?
- **Dependencies:** GRN-002
- **Status:** DECIDED · **Decision date:** 2026-09-22
- **Final decision:** **Partial PO receipt is required** (explicit, §6). Tolerance thresholds before an exception is flagged are a **configurable business parameter**.
- **Affected specs:** `specs/04-purchase-orders.md`, `specs/05-grn.md`

#### PO-003 — Costing basis captured on PO · **P0**
- **Question:** Does the PO capture landed cost or unit cost?
- **Dependencies:** TAX-001
- **Status:** DECIDED · **Decision date:** 2026-09-22
- **Final decision:** **Purchase cost MUST be maintained for margin/profitability analysis** (explicit, §6, and required by `ANL-001`'s margin/profitability analytics). The PO/GRN captures at minimum unit cost; landed-cost components (freight/duties/taxes) are captured where available, refined once `TAX-001` GST input-credit treatment is confirmed.
- **Affected specs:** `specs/04-purchase-orders.md`

---

## GRN — Goods Receipt / QC

#### GRN-001 — QC inspection criteria & pass/fail workflow · **P0**
- **Question:** What QC criteria apply, and what happens on fail?
- **Dependencies:** SUP-001
- **Status:** DECIDED · **Decision date:** 2026-09-22
- **Final decision:** **QC is required.** GRN **MUST support**: received quantity, short receipt, excess receipt, damaged receipt, and rejected/QC-failed receipt, each with appropriate exception handling (explicit, §6). The exact per-category inspection checklist content is a **configurable operational parameter**, not a build blocker.
- **Affected specs:** `specs/05-grn.md`

#### GRN-002 — GRN exception resolution · **P1**
- **Question:** What is the resolution workflow for GRN exceptions?
- **Dependencies:** PO-002, TAX-005
- **Status:** DECIDED (engineering default) · **Decision date:** 2026-09-22
- **Final decision:** Configurable resolution paths per exception type (supplier debit/credit note, return-to-supplier, write-off), tied to the exception type captured at GRN. Exact workflow rules per supplier/category are operational configuration.
- **Affected specs:** `specs/05-grn.md`

#### GRN-003 — Barcode/scanning requirement at GRN · **P2**
- **Question:** Is barcode/scanning required at launch?
- **Dependencies:** WH-001
- **Status:** DECIDED (engineering default) · **Decision date:** 2026-09-22
- **Final decision:** Not required at launch; manual/UI-based receipt entry is acceptable initially. Architecture must not preclude adding barcode/scanning later without redesign.
- **Affected specs:** `specs/05-grn.md`

---

## INV — Inventory

#### INV-001 — Complete ledger transaction type list & required fields · **P0**
- **Question:** What is the definitive ledger transaction type list?
- **Dependencies:** GRN-001, ORD-001, RET-002
- **Status:** DECIDED · **Decision date:** 2026-09-22
- **Final decision:** **Inventory MUST use an auditable ledger** — never `product.quantity` alone (explicit, §7). Minimum states: `ON_HAND`, `RESERVED`, `AVAILABLE`, `IN_TRANSIT`, `DAMAGED`, `RETURN_PENDING`, with auditable transaction events for every state change. The working transaction-type draft in `blueprint/INVENTORY_INTEGRITY.md` §2 is adopted as the approved starting schema (receipt, QC pass/fail, reservation, release, allocation, sale/fulfilment, cancellation, return received, return QC pass/fail, exchange, RTO, adjustment, transfer out/in), extensible without redesign.
- **Affected specs:** `specs/06-inventory.md`

#### INV-002 — Reservation trigger point & timeout · **P0**
- **Question:** Does cart or checkout trigger reservation?
- **Dependencies:** CART-001, CHK-001
- **Status:** DECIDED · **Decision date:** 2026-09-22
- **Final decision:** **Do NOT reserve inventory on add-to-cart.** Use **short-lived reservation during checkout/payment initiation** only: `AVAILABLE -> TEMPORARY RESERVATION -> SUCCESSFUL ORDER -> COMMITTED ALLOCATION`, or `AVAILABLE -> TEMPORARY RESERVATION -> PAYMENT FAILURE/TIMEOUT/ABANDONMENT -> RESERVATION RELEASED`. **For COD: commit/reserve inventory when the COD order is successfully accepted** (not merely on checkout start, since there is no payment-gateway step to bound the window). **Reservation expiry duration MUST be configurable** — never hard-coded into core logic. Concurrency and idempotency **MUST** ensure two customers cannot purchase the same final unit (explicit, §8).
- **Affected specs:** `specs/06-inventory.md`, `specs/11-wishlist-cart.md`, `specs/12-checkout.md`

#### INV-003 — Oversell policy · **P0**
- **Question:** Is oversell ever permitted?
- **Dependencies:** INV-001
- **Status:** DECIDED · **Decision date:** 2026-09-22
- **Final decision:** **Overselling MUST be prevented.** The business cannot assume unavailable stock can later be sourced from the market (explicit, §7). The system **MUST NOT** intentionally sell inventory beyond reliably available sellable stock. No general backorder/oversell-beyond-stock feature is built for standard SKUs; a distinct, explicitly-flagged pre-order concept (if ever wanted) is **FUTURE_CONSIDERATION**, not V1 scope.
- **Affected specs:** `specs/06-inventory.md`

#### INV-004 — Multi-warehouse/multi-location support at launch · **P0**
- **Question:** Same decision as `ORG-002`.
- **Dependencies:** ORG-002 (decided together), WH-001
- **Status:** DECIDED · **Decision date:** 2026-09-22
- **Final decision:** See `ORG-002` — location-aware ledger schema from day one; warehouse-only, single/few-location operation at launch; transfers between locations supported by the domain model now even though multi-location operation is phased in later.
- **Affected specs:** `specs/06-inventory.md`

#### INV-005 — Safety/buffer stock rules · **P1**
- **Question:** Is a safety-stock concept needed?
- **Dependencies:** INV-001
- **Status:** DECIDED (configurable) · **Decision date:** 2026-09-22
- **Final decision:** Supported as a configurable buffer per SKU/category, subtracted from `AVAILABLE`. Exact thresholds are operational configuration, not a build blocker.
- **Affected specs:** `specs/06-inventory.md`

#### INV-006 — Damaged/return-pending stock re-entry · **P1**
- **Question:** Can damaged/return-pending stock become sellable again?
- **Dependencies:** RET-002, GRN-001
- **Status:** DECIDED · **Decision date:** 2026-09-22
- **Final decision:** Damaged and return-pending stock **MUST NOT** automatically become sellable `ON_HAND` inventory. Re-entry requires passing QC first. The disposition decision at QC time (restock as sellable, restock as marked-down/damaged clearance, write-off, return-to-supplier) is a configurable workflow outcome, but the "no re-entry without QC" rule itself is fixed.
- **Affected specs:** `specs/06-inventory.md`, `specs/18-returns.md`

#### INV-007 — Cycle count / stock take workflow · **P2**
- **Question:** Is a periodic stock-count workflow required?
- **Dependencies:** INV-001, ADM-003
- **Status:** DECIDED · **Decision date:** 2026-09-22
- **Final decision:** Supported via the manual/authorized adjustment transaction type (`ADM-003`) — every adjustment (cycle-count-driven or otherwise) **MUST be authorized and audited** (explicit, §36). Exact cadence is operational configuration.
- **Affected specs:** `specs/06-inventory.md`

---

## CAT — Catalog / Merchandising / Pricing

#### CAT-001 — Pricing model: tax treatment, currency, region scope · **P0**
- **Question:** Tax-inclusive/exclusive display? Single or multi-currency?
- **Dependencies:** TAX-001, TAX-002, ORG-001
- **Status:** DECIDED · **Decision date:** 2026-09-22
- **Final decision:** **MRP and selling price are both required** (explicit, §9), displayed tax-inclusive (India market norm). Single currency/region (INR, India) at launch; multi-currency/region is not V1 scope. **Default price is the SAME across sizes for the same style-colour** — size-based pricing is explicitly **not** normal V1 behavior (§9). **Scheduled markdown/sale pricing is required**, with configurable start/end dates. **Historical orders/refunds MUST use the actual transaction price paid** — a later product-price change MUST NOT alter the financial value of an existing order/refund (explicit, §9 — this is a hard financial-integrity rule, not a preference).
- **Affected specs:** `specs/07-catalog-merchandising.md`, `specs/14-order-management.md`, `specs/19-refunds.md`

#### CAT-002 — Publishing decision ownership · **P1**
- **Question:** Manual, automated, or both?
- **Dependencies:** PROD-002, PROD-003
- **Status:** DECIDED (engineering default) · **Decision date:** 2026-09-22
- **Final decision:** Both — publish requires the automated `ready_for_qa -> published` gate (product completeness per `PROD-002`/`PROD-003`) **and** an explicit Merchandiser publish action. Neither alone is sufficient.
- **Affected specs:** `specs/07-catalog-merchandising.md`

#### CAT-003 — Browsing category vs. attribute category taxonomy · **P1**
- **Question:** One taxonomy or two?
- **Dependencies:** PROD-001
- **Status:** DECIDED (engineering default) · **Decision date:** 2026-09-22
- **Final decision:** Unified — the catalog browsing category tree and the product attribute "category" field are the same taxonomy for V1, avoiding dual-maintenance. Merchandising **collections** (curated groupings, distinct from category) layer on top as a separate concept.
- **Affected specs:** `specs/07-catalog-merchandising.md`, `specs/02-product-master.md`

#### CAT-004 — Merchandising tags/badges rule ownership · **P2**
- **Question:** Manual or rule-driven badges?
- **Dependencies:** CAT-002
- **Status:** DECIDED (engineering default) · **Decision date:** 2026-09-22
- **Final decision:** Rule-driven where computable (e.g., "New Arrival" = published within a configurable recency window; "Sale" = active markdown per `CAT-001`), with manual merchandiser override always available.
- **Affected specs:** `specs/07-catalog-merchandising.md`

---

## SF — Storefront

#### SF-001 — Design system / component library choice · **P1**
- **Question:** Custom or existing component library?
- **Dependencies:** none
- **Status:** DECIDED (engineering default) · **Decision date:** 2026-09-22
- **Final decision:** Adopt an accessible, actively-maintained component foundation customized with brand/multi-brand design tokens (per `ORG-001`'s multi-brand requirement), rather than building a design system fully from scratch. Exact library is an implementation-time engineering choice at M09, not a business decision.
- **Affected specs:** `specs/08-storefront.md`

#### SF-002 — Internationalization/localization scope · **P1**
- **Question:** Single locale or multi-locale from day one?
- **Dependencies:** ORG-001, CAT-001
- **Status:** DECIDED · **Decision date:** 2026-09-22
- **Final decision:** Single locale at launch (India / English / INR). **Both mobile web and desktop web are required; the UI MUST be fully responsive. Native mobile applications are explicitly LATER, not launch scope** (explicit, §2).
- **Affected specs:** `specs/08-storefront.md`

---

## SRCH — Search / Discovery

#### SRCH-001 — Relevance ranking rules · **P1**
- **Question:** What drives ranking?
- **Dependencies:** CAT-002
- **Status:** DECIDED (engineering default) · **Decision date:** 2026-09-22
- **Final decision:** Text relevance + stock availability (in-stock prioritized) + recency + manual merchandiser pinning at launch. Sales-velocity weighting is added once sufficient analytics data exists (post-launch refinement, not blocking).
- **Affected specs:** `specs/09-search-discovery.md`

#### SRCH-002 — Personalization/recommendation scope · **P2**
- **Question:** In scope for launch?
- **Dependencies:** ANL-001
- **Status:** DECIDED · **Decision date:** 2026-09-22
- **Final decision:** Not launch scope — **FUTURE_CONSIDERATION**. Analytics event foundations (`ANL-001`) must not preclude adding it later.
- **Affected specs:** `specs/09-search-discovery.md`

---

## PDP — Product Detail Page

#### PDP-001 — Reviews/ratings in scope for launch · **P1**
- **Question:** Required for launch?
- **Dependencies:** CUST-001
- **Status:** DECIDED · **Decision date:** 2026-09-22
- **Final decision:** **Required.** Ratings and reviews are explicitly listed among required customer features (§12).
- **Affected specs:** `specs/10-pdp.md`, `specs/21-customer-profile.md`

#### PDP-002 — Cross-sell/related-products logic ownership · **P2**
- **Question:** Manual or algorithmic?
- **Dependencies:** SRCH-002
- **Status:** DECIDED (engineering default) · **Decision date:** 2026-09-22
- **Final decision:** Rule-driven (same/complementary category) at launch with manual merchandiser override; ML-based recommendation is a future enhancement.
- **Affected specs:** `specs/10-pdp.md`

---

## CART — Wishlist / Cart

#### CART-001 — Guest cart/wishlist persistence & merge-on-login · **P0**
- **Question:** Persistence duration and merge behavior?
- **Dependencies:** INV-002, AUTH-001
- **Status:** DECIDED (engineering default on duration) · **Decision date:** 2026-09-22
- **Final decision:** Guest cart/wishlist is supported (guest checkout is required, `CHK-001`) and does **not** reserve inventory (per `INV-002`). Persists via a device/session identifier for a configurable duration (engineering default: 30 days), merges into the account cart on login or post-purchase account activation.
- **Affected specs:** `specs/11-wishlist-cart.md`

#### CART-002 — Cart quantity limits per SKU · **P1**
- **Question:** Is a max-quantity limit needed?
- **Dependencies:** none
- **Status:** DECIDED (configurable) · **Decision date:** 2026-09-22
- **Final decision:** Supported as a configurable per-SKU maximum-quantity rule (anti-scalping/fair-access control); default threshold is operational configuration.
- **Affected specs:** `specs/11-wishlist-cart.md`

#### CART-003 — Wishlist sharing · **P2**
- **Question:** In scope for launch?
- **Dependencies:** none
- **Status:** DECIDED · **Decision date:** 2026-09-22
- **Final decision:** Not launch scope — **FUTURE_CONSIDERATION**.
- **Affected specs:** `specs/11-wishlist-cart.md`

#### CART-004 — Guest session identifier security hardening · **P1**
- **Question:** Is the `x-guest-session-id` header, in its current
  form, safe to ship to production as-is, or does it need hardening
  first?
- **Dependencies:** CART-001, CHK-001
- **Status:** `UNDER_REVIEW` (identified 2026-09-24, Phase 2
  independent-certification repair pass, finding #8) · genuine,
  pre-production security follow-up - not resolved here, not to be
  treated as settled.
- **Risk, as found:** `resolveCartIdentity()`
  (`services/commerce-api/src/modules/cart/identity.ts`) accepts the
  `x-guest-session-id` header as-is with no format, length, or entropy
  validation - it functions as a bearer credential (whoever presents a
  given value gets that guest's cart/wishlist/checkout-session access,
  per the cross-identity isolation this header is the sole gate for),
  but the server does not enforce that it actually has bearer-credential-
  grade strength. The shipped storefront client
  (`apps/storefront/src/lib/cart.ts`) already generates it correctly
  (`crypto.randomUUID()`, persisted in `localStorage`, 122 bits of
  entropy) - the gap is that a non-storefront API caller could instead
  present a short, predictable, or reused value and the server would
  accept it identically. There is also no server-side expiration or
  rotation of the identifier itself (distinct from `CART-001`'s cart-
  *content* TTL, `CART_GUEST_TTL_DAYS`, which already clears stale line
  items but never rejects the identifier that presents them).
- **Why not fixed directly in this repair pass:** the disciplined,
  correct server-side fix (reject any guest session id that doesn't
  look like a genuine high-entropy token, e.g. canonical UUIDv4 format)
  would immediately break every existing test fixture across the
  storefront milestones that uses a short, human-readable guest id for
  readability (`'guest-a'`, `'guest-ord-cod'`, `'guest-race-a'`, etc. -
  dozens of call sites across `cart-wishlist.test.ts`, `checkout.test.ts`,
  `order.test.ts`, `payment.test.ts`, `pdp.test.ts`, and this repair
  pass's own new tests). Retrofitting strict validation now would mean
  rewriting guest-id fixtures across every Phase 2 milestone's test
  suite in a pass whose authorization is explicitly scoped to repairing
  the nine named defects, not a general test-suite migration - and
  would risk introducing exactly the kind of large, unreviewed diff the
  certification-repair instruction warns against. This is also
  explicitly not authorization to redesign M01 authentication or the
  cart/guest identity model more broadly.
- **Recommended production hardening (not yet implemented):**
  1. Server-side format validation: reject any `x-guest-session-id`
     that is not a canonical UUID (or an equivalent fixed-format,
     high-entropy token) before it reaches `resolveCartIdentity()`'s
     callers, closing the "attacker picks a weak identifier" gap
     without touching the storefront client (which already sends
     genuine UUIDs).
  2. A server-side maximum length guard (independent of full format
     validation, and safe to add without touching existing test
     fixtures) - see the fix already landed alongside this decision
     entry.
  3. Consider signing the guest session id (e.g. an HMAC'd cookie or
     a short-lived server-issued token exchanged for the client's
     locally-generated id) so possession of the raw value alone is
     insufficient - a larger design change, out of scope here.
  4. A rotation/expiration policy for the identifier's *authority*
     itself, not just the cart content it points at.
  5. Whichever of the above is chosen, it must preserve the existing
     account-merge-on-login behavior (`CART-001`) and must not regress
     the existing cross-identity isolation tests (verified still green
     as part of this repair pass - `cart-wishlist.test.ts`'s "keeps a
     guest cart isolated from a different guest session" and
     `checkout.test.ts`'s "does not let one identity read another
     identity's checkout session").
- **Affected specs:** `specs/11-wishlist-cart.md`, `specs/12-checkout.md`,
  `specs/13-payment.md`

**CART-004 closure (2026-09-29, M31 Security Hardening):** implemented
option 3 from the recommendation list above — a server-issued, signed
token — closing this gap for real rather than merely tightening format
validation on a client-chosen value. `services/commerce-api/src/modules/cart/identity.ts`
now exposes `mintGuestSessionToken()` (`POST /storefront/guest-session`,
unauthenticated, rate-limiting rather than RBAC is the correct control
here) which mints `<uuid-v4>.<hmac-sha256-hex>` — the HMAC computed over
the uuid with the existing `JWT_ACCESS_SECRET`, the same
sign-then-`timingSafeEqual`-compare idiom this codebase already uses for
Razorpay/carrier webhook signatures, reused rather than inventing a
second signing convention or a new secret env var. Stateless by design —
no DB row, no expiry job; the token is its own proof of server issuance.

Enforcement is **production-only**, mirroring the exact precedent
`getChannelProvider`'s existing `NODE_ENV === 'production'` guard against
`MOCK_*` providers already established for "strict in production,
permissive in dev/test": in `NODE_ENV=production`, `resolveCartIdentity`
verifies the presented header against this server's own secret and
rejects outright (400) anything that fails — unsigned, tampered,
mismatched-secret, or malformed. Outside production, a raw client-
supplied string is still accepted verbatim (length-capped at 256 chars,
unchanged from the prior repair) — deliberately preserving every
existing dev/test fixture (`'guest-a'`, `'guest-ord-cod'`, etc.) across
every milestone's test suite without the large, unrelated rewrite this
decision's own 2026-09-24 entry correctly declined to do. This is a
narrower, real production threat-model distinction, not a compliance
shortcut: no attacker can reach a dev/test environment, so the
enforcement gap that matters is closed exactly where it matters.

The real storefront client was updated to match — `resolveCartIdentity`
alone cannot close the gap if the shipped client still mints its own
unsigned id. A new shared module,
`apps/storefront/src/lib/guest-session.ts`, fetches and caches
(`localStorage`, with in-flight-request de-duplication for concurrent
callers on first page load) a genuine server-issued token instead of
calling `crypto.randomUUID()` locally; `lib/cart.ts` and `lib/checkout.ts`
(the two modules that previously minted their own id) now delegate to it
— `lib/exchanges.ts`/`orders.ts`/`refunds.ts`/`returns.ts` needed no
change, since each already only *reads* the same shared `localStorage`
key `cart.ts` writes, never mints its own.

Verified: the full existing cross-identity isolation suite
(`cart-wishlist.test.ts`, `checkout.test.ts`) re-run green with zero
regressions, including the existing oversized-header rejection test; a
new unit suite, `test/unit/cart-identity.test.ts` (11 tests), proves the
production-mode signature enforcement directly — a genuine server-minted
token is accepted and its id recovered; a raw unsigned string, a
tampered signature, a forged signature paired with a real id, swapped
id/signature halves, a malformed token, and an empty header are all
rejected; a logged-in customer's identity always wins over any guest
header, forged or not; two independently minted tokens never verify
against each other's id. `apps/storefront` typechecks and production-
builds cleanly with the new client flow. **Rotation/expiration of the
token's own authority (item 4 in the original recommendation list)
remains unimplemented** — the token is stateless and does not itself
expire; this is an accepted, documented scope boundary for this pass
(the cart *content* TTL, `CART_GUEST_TTL_DAYS`, is unaffected and
unchanged), not a claim that guest-identity rotation is solved.
- **Status:** `UNDER_REVIEW` → **`ENGINEERING_CLOSED`** (2026-09-29) —
  the identified gap is fixed and adversarially tested; this remains an
  engineering-implementation determination, not an independent-review
  certification, per this file's own certification discipline.

---

## CHK — Checkout

#### CHK-001 — Guest checkout vs. account-required · **P0**
- **Question:** Is guest checkout supported?
- **Dependencies:** AUTH-001, CART-001
- **Status:** DECIDED · **Decision date:** 2026-09-22
- **Final decision:** **Guest checkout is REQUIRED and MUST be genuinely guest** — account creation must never be forced before purchase (explicit, §11). Logged-in checkout is also supported. Post-purchase account activation may be offered.
- **Affected specs:** `specs/12-checkout.md`

#### CHK-002 — Tax calculation approach · **P0**
- **Question:** How is GST calculated at checkout?
- **Dependencies:** TAX-001, TAX-002, TAX-003
- **Status:** DECIDED (engineering approach; legal correctness tracked separately) · **Decision date:** 2026-09-22
- **Final decision:** Build a **pluggable, configurable, HSN-rate-lookup-based tax engine** (line-item level), displaying tax-inclusive pricing per `CAT-001`. This is the engineering shape needed regardless of outcome; it is designed so it can be parameterized once `TAX-001`–`TAX-003`'s legal specifics are confirmed, without an architecture change.
- **Affected specs:** `specs/12-checkout.md`, `specs/32-india-tax-invoicing.md`

#### CHK-003 — Shipping cost calculation rules · **P1**
- **Question:** Flat, weight-based, or threshold-based?
- **Dependencies:** IND-005, SHIP-001
- **Status:** DECIDED (configurable) · **Decision date:** 2026-09-22
- **Final decision:** Configurable rule engine supporting flat rate, weight/value-based, and free-shipping-threshold (`IND-005`) rules; exact values are business configuration.
- **Affected specs:** `specs/12-checkout.md`

#### CHK-004 — Address serviceability check · **P0**
- **Question:** Is PIN-code serviceability validated, and where?
- **Dependencies:** IND-002, SHIP-001
- **Status:** DECIDED · **Decision date:** 2026-09-22
- **Final decision:** **Required.** Customers can check delivery/serviceability from the **PDP** before completing checkout (explicit, §12), and checkout re-validates serviceability before order placement (engineering safety default — the PIN code entered at checkout must be re-checked even if a different PDP check occurred earlier).
- **Affected specs:** `specs/12-checkout.md`, `specs/10-pdp.md`

---

## PAY — Payment

#### PAY-001 — Payment provider abstraction interface shape · **P0**
- **Question:** What is the abstraction interface?
- **Dependencies:** none
- **Status:** DECIDED (engineering default) · **Decision date:** 2026-09-22
- **Final decision:** **Razorpay-first, provider-abstracted.** Interface: `initiate`/`authorize`/`capture`/`refund`/`handleWebhook` with a provider-agnostic result/error type; order/checkout logic depends only on this interface, never Razorpay's SDK directly (per ADR-0011). This keeps the door open to adding another provider later without rewriting order logic (explicit, §13).
- **Affected specs:** `specs/13-payment.md`

#### PAY-002 — Payment state machine definition · **P0**
- **Question:** What are the payment states, and how do they relate to order states?
- **Dependencies:** ORD-001
- **Status:** DECIDED · **Decision date:** 2026-09-22
- **Final decision:** **Payment state and order state MUST remain separate state machines** (explicit, §13, reaffirming `blueprint/ORDER_PAYMENT_INTEGRITY.md`). Payment states: `initiated -> authorized -> captured -> (refunded | partially_refunded)`, plus `failed`/`expired`. COD: `initiated -> confirmed` (collected at delivery, no capture step).
- **Affected specs:** `specs/13-payment.md`, `specs/14-order-management.md`

#### PAY-003 — Idempotency & webhook duplicate-event handling · **P0**
- **Question:** How is double-processing prevented?
- **Dependencies:** PAY-001
- **Status:** DECIDED · **Decision date:** 2026-09-22
- **Final decision:** **Required, explicitly and comprehensively** (§13): idempotency keys on every payment-affecting operation; webhook signature verification and deduplication by provider event ID; safe retries; reconciliation; duplicate-payment handling; payment-pending handling (distinct from failure); failure recovery. See `blueprint/ORDER_PAYMENT_INTEGRITY.md` for the detailed mechanics this satisfies.
- **Affected specs:** `specs/13-payment.md`

#### PAY-004 — Partial/split payment support · **P1**
- **Question:** Is part-COD + part-prepaid in scope?
- **Dependencies:** PAY-001
- **Status:** DECIDED · **Decision date:** 2026-09-22
- **Final decision:** Not required for launch — **FUTURE_CONSIDERATION**. Not mentioned among required payment capabilities in §13.
- **Affected specs:** `specs/13-payment.md`

#### PAY-005 — Payment retry/failure handling policy · **P1**
- **Question:** Retry attempts, and inventory reservation behavior?
- **Dependencies:** INV-002
- **Status:** DECIDED (configurable) · **Decision date:** 2026-09-22
- **Final decision:** Configurable retry attempt count; reservation from `INV-002` persists through retry attempts within the reservation window and releases on final failure/timeout/abandonment.
- **Affected specs:** `specs/13-payment.md`

#### PAY-006 — PCI/compliance posture confirmation · **P2**
- **Question:** Confirm hosted/tokenized flow.
- **Dependencies:** PAY-001
- **Status:** DECIDED · **Decision date:** 2026-09-22
- **Final decision:** **MUST** use Razorpay's hosted/tokenized flow; the platform **MUST NOT** handle or store raw card data at any point. This is a fixed security requirement, not a preference (per `SECURITY.md` §4 and §30's "do not weaken security merely to reduce implementation effort").
- **Affected specs:** `specs/13-payment.md`, `SECURITY.md`

---

## ORD — Order Management

#### ORD-001 — Complete order state machine · **P0**
- **Question:** What is the full order state machine?
- **Dependencies:** PAY-002, INV-001
- **Status:** DECIDED (engineering default on exact state names) · **Decision date:** 2026-09-22
- **Final decision:** Full business shape now specified by the Product Owner (§14): order creation, confirmation, inventory allocation, fulfilment (supporting **split shipments — one order may have multiple fulfilments/packages**), shipment, delivery, cancellation (allowed **before shipment**, subject to configurable state/policy rules), **partial cancellation** (required), returns, refunds, exchanges, RTO, and exception handling. The engineering agent adopts a concrete state enum implementing this shape at M15 build time (naming/schema detail, not a further business decision). **Post-order-placement customer self-service modification of address/items is NOT required** — the V1 pattern is cancel/reorder or controlled CS intervention (explicit, §14).
- **Affected specs:** `specs/14-order-management.md`

#### ORD-002 — Partial cancellation & partial shipment rules · **P0**
- **Question:** Line-item-level cancellation/shipment support?
- **Dependencies:** ORD-001, CAN-001
- **Status:** DECIDED · **Decision date:** 2026-09-22
- **Final decision:** **Partial cancellation is required. Split shipments MUST be supported architecturally** — one order may eventually have multiple fulfilments/packages (explicit, §14). Shipping-cost and promotion apportionment across remaining lines is an engineering computation detail, not a further open business question.
- **Affected specs:** `specs/14-order-management.md`, `specs/17-cancellation.md`

#### ORD-003 — RTO handling & interaction with refunds · **P0**
- **Question:** RTO order state, and refund trigger?
- **Dependencies:** ORD-001, REF-001
- **Status:** DECIDED (engineering default) · **Decision date:** 2026-09-22
- **Final decision:** RTO on a prepaid order triggers the standard refund flow (`REF-001`/`REF-003`, using original transaction value). RTO on a COD order triggers closure without refund (no payment was ever collected) — logistics-only reconciliation. Both paths reuse the same RTO state, differing only in whether a refund side-effect fires.
- **Affected specs:** `specs/14-order-management.md`

#### ORD-004 — Order exception handling · **P1**
- **Question:** How are exceptions (undeliverable address, pick shortfall, etc.) handled?
- **Dependencies:** ORD-001, WH-002
- **Status:** DECIDED (engineering default) · **Decision date:** 2026-09-22
- **Final decision:** Exceptions route to a defined exception state requiring CS or warehouse intervention; all exception occurrences and resolutions are tracked and audited (per `AUD-001`). Exact resolution playbooks per exception type are configurable, not hard-coded.
- **Affected specs:** `specs/14-order-management.md`

#### ORD-005 — Order-to-inventory allocation timing · **P1**
- **Question:** When does reserved stock become allocated?
- **Dependencies:** INV-002, ORD-001
- **Status:** DECIDED · **Decision date:** 2026-09-22
- **Final decision:** Reservation converts to committed allocation upon successful payment capture (prepaid) or successful COD order acceptance (COD) — directly per the `INV-002` flow diagram.
- **Affected specs:** `specs/14-order-management.md`, `specs/06-inventory.md`

#### ORD-006 — Order history/audit trail retention · **P2**
- **Question:** How long is order history retained?
- **Dependencies:** AUD-001
- **Status:** DECIDED (core requirement); retention period ties to `AUD-002` · **Decision date:** 2026-09-22
- **Final decision:** Full order history is retained and queryable for the customer-facing account view indefinitely by default. Exact compliance-driven retention/deletion periods depend on `AUD-002`'s legal verification and do not block building the history feature itself.
- **Affected specs:** `specs/14-order-management.md`

---

## WH — Warehouse / Fulfilment

#### WH-001 — Pick/pack technology for launch · **P1**
- **Question:** Barcode/mobile app, or manual/paper-based?
- **Dependencies:** ORG-002
- **Status:** DECIDED (engineering default) · **Decision date:** 2026-09-22
- **Final decision:** Manual/UI-based pick-pack at launch, sufficient for the given operating scale (1,000–10,000 orders/day, §2); architecture must not block adding barcode/scanning later without redesign.
- **Affected specs:** `specs/15-warehouse-fulfilment.md`

#### WH-002 — Pick exception feedback loop · **P1**
- **Question:** What happens on a pick exception?
- **Dependencies:** INV-001, ORD-004
- **Status:** DECIDED (engineering default) · **Decision date:** 2026-09-22
- **Final decision:** A pick exception posts an authorized/audited inventory adjustment and triggers the `ORD-004` order-exception path; Warehouse Manager and CS are notified.
- **Affected specs:** `specs/15-warehouse-fulfilment.md`

#### WH-003 — M16 warehouse state-machine/data-model shape · **P1**
- **Question:** How does "obtain actionable pick work from an allocated
  OrderLine" (WH-001/WH-002's engineering-default implementation) map
  onto concrete states and tables, without inventing a replacement
  architecture for the already-certified M15 Order/OrderLine/
  OrderFulfilment model?
- **Dependencies:** WH-001, WH-002, ORD-001 (M15)
- **Status:** DECIDED (engineering default) · **Decision date:** 2026-09-24
  (M16 build)
- **Final decision:** A new `PickTask` table, exactly one per `OrderLine`
  (1:1, unique on `orderLineId`), auto-created in the same transaction as
  order creation. `OrderLineStatus` gains one new value, `PICKED`,
  inserted between the existing `ALLOCATED` and `PACKED`.
  `OrderFulfilment`/`FulfilmentStatus` (M15's existing "package" model,
  already supporting multiple packages per order) gains one new value,
  `READY_TO_SHIP`, inserted between `PACKED` and `SHIPPED` - the explicit
  warehouse-to-shipping hand-off boundary `specs/16-shipping-tracking.md`
  (M17) picks up from. `OrderService.assignLinesToFulfilment` now
  requires `PICKED` (not M15-original `ALLOCATED`); `markFulfilmentShipped`
  now requires `READY_TO_SHIP` (not `PACKED` directly) via a new explicit
  `markFulfilmentReadyToShip` staff action. Deliberately NOT a 4-state
  pick lifecycle (no separate `IN_PROGRESS/claimed-by` state): every
  pick/pack action in this manual/UI-based (WH-001) architecture is one
  synchronous HTTP call, not a long-running async job that could crash
  mid-way through an unobserved intermediate state - the same reasoning
  already applied to `PaymentEventStatus`'s 3-state design (M14). Full
  design rationale and the complete state machine:
  `services/commerce-api/src/modules/warehouse/service.ts` and the
  `PickTask`/`OrderLineStatus`/`FulfilmentStatus` schema comments in
  `packages/db/prisma/schema.prisma`.
- **Affected specs:** `specs/15-warehouse-fulfilment.md`,
  `specs/14-order-management.md`

---

## SHIP — Shipping / Tracking

#### SHIP-001 — Carrier(s) supported at launch · **P0**
- **Question:** Which carrier(s)?
- **Dependencies:** ORG-002
- **Status:** DECIDED (architecture); carrier selection deferred to operations · **Decision date:** 2026-09-22
- **Final decision:** Build the carrier-**abstraction layer now** (see `SHIP-002`); the specific carrier(s) are selected via configuration and confirmed operationally before go-live — this does not block engineering, since no carrier-specific logic is allowed in core fulfilment code regardless of which carrier is chosen.
- **Affected specs:** `specs/16-shipping-tracking.md`

#### SHIP-002 — Carrier integration abstraction · **P1**
- **Question:** Should carriers go through a provider-abstraction layer?
- **Dependencies:** SHIP-001
- **Status:** DECIDED · **Decision date:** 2026-09-22
- **Final decision:** **Yes** — mirrors the payment provider abstraction pattern (`PAY-001`) explicitly demanded throughout the Product Owner's instructions. Carriers are replaceable without rewriting fulfilment logic. This should be recorded as a new ADR alongside ADR-0011 once implementation begins.
- **Affected specs:** `specs/16-shipping-tracking.md`

#### SHIP-003 — Real-time tracking vs. polling · **P1**
- **Question:** Webhook-driven or polling?
- **Dependencies:** SHIP-001
- **Status:** DECIDED (engineering default) · **Decision date:** 2026-09-22
- **Final decision:** Webhook-driven where the carrier adapter supports it, with polling fallback; configurable per carrier adapter.
- **Affected specs:** `specs/16-shipping-tracking.md`

#### SHIP-004 — Failed delivery / redelivery attempt policy · **P1**
- **Question:** How many redelivery attempts before RTO?
- **Dependencies:** ORD-003
- **Status:** DECIDED (configurable) · **Decision date:** 2026-09-22
- **Final decision:** Configurable attempt count (engineering default: 2) before RTO triggers.
- **Affected specs:** `specs/16-shipping-tracking.md`

#### SHIP-005 — M17 shipment/tracking state-machine/data-model shape · **P1**
- **Question:** How do SHIP-001–004's engineering defaults map onto
  concrete states, tables, and the carrier-adapter boundary, without
  duplicating what the already-certified M15/M16 Order/OrderFulfilment
  model owns or introducing a second SALE/RTO-posting path?
- **Dependencies:** SHIP-001, SHIP-002, SHIP-003, SHIP-004, WH-003 (M16)
- **Status:** DECIDED (engineering default) · **Decision date:** 2026-09-24
  (M17 build)
- **Final decision:** A new `Shipment` table, exactly one per
  `OrderFulfilment` (1:1, unique on `fulfilmentId`) — split shipments
  fall out of M15/M16's existing "one order, many OrderFulfilments"
  model for free, no new one-to-many modelling needed. `Shipment` owns
  only what M16's `OrderFulfilment` does not already: provider identity,
  the provider's own shipment/AWB references, a platform-normalized
  `ShipmentTrackingStatus` (`CREATED → BOOKED → IN_TRANSIT →
  OUT_FOR_DELIVERY → {DELIVERED, DELIVERY_FAILED}`; `DELIVERY_FAILED →
  OUT_FOR_DELIVERY` (retry) or `→ RTO_INITIATED` once the configured
  `maxDeliveryAttempts` snapshot is exhausted; `RTO_INITIATED →
  RTO_DELIVERED`), delivery-attempt/RTO counters, and carrier-booking
  idempotency (`idempotencyKey`, unique). A second table,
  `ShipmentTrackingEvent`, deliberately serves two roles at once (never
  a second dedup-table pattern): the durable webhook-processing state
  record (RECEIVED/PROCESSED/FAILED, exactly mirroring `PaymentEvent`'s
  M14 design, dedup on `(provider, providerEventId)` with a nullable
  `providerEventId` so POLL/MANUAL rows never collide) AND the
  customer/audit-visible tracking-history ledger. Carrier integration
  goes through a new `ShippingProvider` interface (ADR-0020, mirroring
  `PaymentProvider`/ADR-0011 exactly) — `initiateShipment`/
  `verifyWebhookSignature`/`parseWebhookEvent`/`trackShipment`; only
  `MockCarrierProvider` ships in this milestone (SHIP-001 - no launch
  carrier selected), a genuine deterministic test/reference double, not
  a production integration. Shipment creation uses a two-phase durable-
  intent design for the distributed-system failure window: the
  `Shipment` row is written in status `CREATED` BEFORE the carrier is
  ever called, and the adapter itself is idempotent-by-shipment-id, so a
  crash between a successful carrier call and the local commit is
  recoverable by simply retrying — never a lost or duplicated booking.
  `OrderService.markFulfilmentShipped`/`markFulfilmentDelivered`/
  `markRTO` gained an optional `externalTx` parameter (mirroring the
  extension pattern M16 already used for `InventoryService.postAdjustment`)
  so `ShippingService` reuses them atomically rather than duplicating any
  SALE-posting or status-transition logic — M16's certified "exactly one
  authoritative SALE posting point" invariant is unchanged; RTO remains
  singly-posted through `markRTO` for the same reason.
  **Documented limitation (not guessed):** `markRTO`'s existing M15/M16
  guard ("every active order line SHIPPED, none delivered yet") only
  allows the order-level RTO transition once the WHOLE order is
  consistent with that — for a genuinely mixed-state multi-shipment
  order (a sibling fulfilment already delivered), `ShippingService`
  leaves the Shipment's own `RTO_INITIATED` fact standing and flags an
  explicit `SYSTEM` audit entry for human reconciliation rather than
  forcing the whole order to RTO or inventing a new business rule for
  that case. Full design rationale:
  `services/commerce-api/src/modules/shipping/service.ts`,
  `services/commerce-api/src/modules/shipping/provider.ts`, and the
  `Shipment`/`ShipmentTrackingEvent`/`ShipmentTrackingStatus` schema
  comments in `packages/db/prisma/schema.prisma`.
  **Independent-review repair (2026-09-25):** the initial build's
  `POST /webhooks/shipping/:provider` route declared a per-provider URL
  but never actually read `:provider` — every webhook was
  authenticated/parsed by whichever provider `SHIPPING_PROVIDER`
  happened to be globally configured, regardless of the URL, breaking
  provider isolation the moment more than one provider identity (or an
  in-flight shipment from an earlier provider) existed. Fixed:
  `ShippingService.handleCarrierWebhook` now takes an explicit
  `providerName` (the route's own `:provider`) and resolves that
  SPECIFIC provider via `resolveShippingProvider` for signature
  verification, event parsing, shipment lookup, and event dedup/
  recording — `createShipment`/`pollPendingShipments` correctly keep
  using the instance's globally-configured provider, since neither is
  per-request URL-routed. A second registered test identity,
  `MOCK_SECONDARY` (still `MockCarrierProvider`, its own distinct
  webhook secret), was added to `provider.ts` specifically to prove
  genuine per-request provider dispatch/isolation
  (`test/integration/shipping.test.ts`, "Webhook provider dispatch
  (independent-review repair)", 6 tests) — deliberately not a real
  carrier.
  **CI-caught follow-up (2026-09-25, same day):** CI failed a
  pre-existing test on the webhook-repair push — not a flake,
  reproduced by inspection. `resolveOrCreateShipmentIntent` validated
  fulfilment eligibility against a plain snapshot read once by
  `createShipment` before any lock; two concurrent `createShipment`
  calls with DIFFERENT idempotency keys could race such that the first
  fully completed (through `markFulfilmentShipped`, moving the real
  `OrderFulfilment` to SHIPPED) before the second even reached this
  method — the second's own snapshot was genuinely stale by then, and
  falsely rejected with "not READY_TO_SHIP" even though a Shipment for
  this fulfilment already legitimately existed. Fixed by checking for
  an existing Shipment row by `fulfilmentId` BEFORE the status
  validation, converging the late-arriving request to the
  already-created shipment via the same idempotent-no-op path
  `createShipment` already takes for a `byKey` match. Verified with 5
  repeated local runs plus a full clean-state suite pass, then
  confirmed on GitHub Actions run
  [36109033095](https://github.com/suraj2build/ECOMMERCE/actions/runs/36109033095)
  (326/326 tests). This is the commit the Product Owner certified as
  `M17_ENGINEERING_CERTIFIED` (`6e28e2bd3116c49641016f7a7ed5dd61427a5819`,
  `CLAUDE.md` §0).
- **Affected specs:** `specs/16-shipping-tracking.md`,
  `specs/14-order-management.md`, `specs/15-warehouse-fulfilment.md`

---

## CAN — Cancellation

#### CAN-001 — Cancellation eligibility by order state · **P0**
- **Question:** At which order states is cancellation permitted?
- **Dependencies:** ORD-001
- **Status:** DECIDED · **Decision date:** 2026-09-22
- **Final decision:** **Customer cancellation is allowed before shipment**, subject to configurable state/policy rules (explicit, §14). Post-shipment, the customer path is return (not cancellation).
- **Affected specs:** `specs/17-cancellation.md`

#### CAN-002 — Who can cancel · **P1**
- **Question:** Self-service, CS-only, or both?
- **Dependencies:** CAN-001, ADM-001
- **Status:** DECIDED (engineering default) · **Decision date:** 2026-09-22
- **Final decision:** Both — customer self-service before shipment, plus CS-assisted cancellation, consistent with the "cancel/reorder or controlled CS intervention" V1 pattern (§14).
- **Affected specs:** `specs/17-cancellation.md`

#### CAN-003 — Cancellation reason capture · **P2**
- **Question:** Mandatory or optional?
- **Dependencies:** ANL-001
- **Status:** DECIDED · **Decision date:** 2026-09-22
- **Final decision:** Optional (recommended, not mandatory) — unlike return reason, which is explicitly mandatory (`RET-002`). Feeds analytics where captured.
- **Affected specs:** `specs/17-cancellation.md`

#### CAN-004 — M18 cancellation state-machine/data-model shape and scope boundaries · **P1**
- **Question:** How do CAN-001–003's engineering defaults map onto the
  already-certified M15/M16/M17 Order/OrderLine/OrderFulfilment/
  PickTask/Shipment model, without inventing a competing cancellation
  engine, and what happens where the approved spec's requirements
  outrun what the current schema/certified milestones can honestly
  support?
- **Dependencies:** CAN-001, CAN-002, CAN-003, ORD-001 (M15), WH-003 (M16), SHIP-005 (M17)
- **Status:** DECIDED (engineering default) · **Decision date:** 2026-09-25
  (M18 build)
- **Final decision:** `OrderService.cancelOrderLine`/`cancelOrderLineForCustomer`
  evolve the SAME M15 method in place (no new `CancellationService`
  module) via a shared private `performCancellation` core. No new
  `OrderLineStatus` value — cancellation moves a line straight to the
  existing `CANCELLED` state.
  - **Locking/concurrency:** a line already assigned to a fulfilment is
    serialized via the SAME `lockFulfilment` row lock (acquired FIRST)
    that `markFulfilmentPacked`/`ReadyToShip`/`Shipped`/`Delivered`
    already use — this single lock closes cancel-vs-cancel/pack/
    ready-to-ship/shipment-creation/ship for that line. A line with no
    fulfilment yet is serialized via a new `lockOrderLine` row lock,
    with a new `lockPendingPickTasksForLine` lock acquired BEFORE it —
    matching `WarehouseService.recordPickOutcome`'s own
    pick-task-then-order-line lock order exactly. Getting this second
    ordering backwards was caught as a genuine Postgres deadlock
    (40P01) during this build's own clean-state validation and fixed
    before certification was sought - not treated as a flake.
  - **Idempotency:** a new globally-unique `OrderLine.cancellationIdempotencyKey`
    column, set only on a successful commit; a line already `CANCELLED`
    is always an idempotent no-op regardless of which key a retry
    supplies.
  - **Schema evolution:** the pre-existing M15 DB constraint
    `order_lines_cancelled_fields_check` required a NOT NULL
    `cancelledReason` whenever `status = CANCELLED`, which is stricter
    than CAN-003's own approved "optional" decision. Relaxed via
    migration `20260925090000_relax_order_line_cancelled_reason_optional`
    to require only that `cancelledAt` is set iff `CANCELLED` — this is
    the M18 spec superseding an M15 implementation detail that predates
    CAN-003, not a regression of an M00–M17 correctness invariant.
  - **Inventory:** reuses `InventoryService.cancelAllocation` unchanged
    (never a direct `InventoryBalance` edit); a still-`PENDING` `PickTask`
    for the cancelled line is marked `CANCELLED` in the same transaction
    (never left actionable); a `PickTask` that already completed is left
    as historical record, never rewritten.
  - **Tax/credit-note:** a captured-payment (`PREPAID`) cancellation
    sets `Order.refundRequired = true` (reusing the existing M14 field —
    no competing flag) and, where an `InvoiceLine` correlates to the
    cancelled line (via a new nullable, unique `InvoiceLine.orderLineId`
    column, populated going forward by `OrderService.issueOrderInvoice`),
    calls the EXISTING M08 `InvoiceService.issueCreditNote` engine
    in-transaction. This is an **engineering integration only** — it
    does not resolve `TAX-005` (GST credit-note legal/statutory
    requirements remain `UNDER_REVIEW`) and must never be read as
    `GST_COMPLIANT`. COD cancellation never sets `refundRequired` and
    never issues a credit note (nothing was collected to refund). M20
    refund *execution* is explicitly out of scope and not implemented —
    only the `refundRequired` flag this build already reuses from M14.
  - **Scope boundary — partial cancellation granularity:** the approved
    spec's own wording ("Partial cancellation MUST be supported at the
    line-item level") is satisfied by cancelling a SUBSET OF LINES; the
    schema has no `cancelledQuantity`/sub-quantity infrastructure on
    `OrderLine`, and none was added. Cancelling part of a single line's
    quantity (e.g. 1 of 3 units on one line) is NOT supported by this
    build and would require a genuine schema change plus a re-approved
    spec — flagged here as a known, deliberate scope boundary rather
    than invented or silently ignored.
  - **Scope boundary — loyalty:** `acceptance/m18-cancellation.md`'s
    "Integration test: loyalty-points reversal on cancellation"
    requirement cannot be satisfied: no loyalty ledger/points system
    exists anywhere in this codebase (M23 Loyalty is unauthorized and
    unbuilt per `BUILD_PLAN.md`). Documented here as N/A rather than
    fabricated, consistent with this build's own explicit instruction
    not to start M23.
  - Full design rationale and the complete lock-ordering/idempotency
    proof: `OrderService.performCancellation`'s own docblock in
    `services/commerce-api/src/modules/order/service.ts`, and the
    30-point adversarial matrix in
    `services/commerce-api/test/integration/cancellation.test.ts`.
- **Affected specs:** `specs/17-cancellation.md`, `specs/14-order-management.md`,
  `specs/32-india-tax-invoicing.md`

---

## RET — Returns

#### RET-001 — Return window length & category exclusions · **P0**
- **Question:** Return window, and category exclusions?
- **Dependencies:** none
- **Status:** DECIDED · **Decision date:** 2026-09-22
- **Final decision:** **Default return window: 7 days after product delivery.** **MUST be configurable by category/product** — not one global hard-coded policy. Some categories/items can be **non-returnable** (example given: innerwear) (explicit, §16).
- **Affected specs:** `specs/18-returns.md`

#### RET-002 — Return condition inspection criteria · **P0**
- **Question:** What condition/inspection is required?
- **Dependencies:** GRN-001
- **Status:** DECIDED · **Decision date:** 2026-09-22
- **Final decision:** **Return reason selection is mandatory** (explicit, §16). Return workflow **MUST support warehouse return receipt and QC**; refund eligibility normally follows successful return/QC per configured policy — no refund fires before the QC gate. Exact per-category condition checklist is operational configuration.
- **Affected specs:** `specs/18-returns.md`

#### RET-003 — Self-service vs. assisted return initiation · **P1**
- **Question:** Self-service or CS-assisted?
- **Dependencies:** CUST-001
- **Status:** DECIDED (engineering default) · **Decision date:** 2026-09-22
- **Final decision:** Self-service initiation available to the customer through their account, with CS-assisted also available, consistent with the platform's general self-service-first posture.
- **Affected specs:** `specs/18-returns.md`

#### RET-004 — Reverse logistics model · **P1**
- **Question:** Pickup, drop-off, or both?
- **Dependencies:** SHIP-001
- **Status:** DECIDED (engineering default) · **Decision date:** 2026-09-22
- **Final decision:** Carrier pickup from the customer address (via the `SHIP-001`/`SHIP-002` carrier abstraction) as the default; customer drop-off supported as a configurable alternative where available.
- **Affected specs:** `specs/18-returns.md`

#### RET-005 — M19 returns data model/failed-QC financial boundary · **P1**
- **Question:** How do RET-001–004's engineering defaults map onto a new
  data model without overloading `OrderLine.status` or M15/M16/M17's
  certified lock ordering, and what is the honest financial consequence
  of a failed-QC return when the approved spec never actually defines
  one?
- **Dependencies:** RET-001, RET-002, RET-004, INV-006, SHIP-005 (M17)
- **Status:** DECIDED (engineering default) · **Decision date:** 2026-09-25
  (M19 build)
- **Final decision:** A new, self-contained `Return`/`ReturnLine`/
  `ReturnPickup` state machine (`ReturnService`, its own module) —
  deliberately NOT reusing `Return` as a return-flavoured `Order`, and
  deliberately never touching `OrderLine.status` (a delivered line stays
  `DELIVERED` forever as history). `ReturnLine.orderLineId` is
  `@unique` — a line can be returned at most once, the same
  "no sub-quantity, one line at a time" simplification `CAN-004`
  already established for cancellation.
  - **Eligibility:** `ReturnPolicy` resolves style-override →
    category-override → the configurable platform default
    (`RETURN_WINDOW_DEFAULT_DAYS`, default 7), enforced by a raw-SQL XOR
    `CHECK` constraint mirroring `Sku.hsnCode`'s own style-then-fallback
    idiom. The eligibility clock is day-granularity
    (`Math.floor(msSinceDelivery / 86_400_000) <= windowDays`), not
    millisecond-precise — a 7-day window means 7 full inclusive days,
    not 7×86400000ms to the millisecond; this was a genuine off-by-one
    this build's own boundary test caught and fixed.
  - **Locking:** Return/ReturnLine/ReturnPickup form their own,
    fully self-contained lock domain distinct from `OrderFulfilment`/
    `PickTask` — no lock-ordering interaction with any M15–M18
    fulfilment transition to reason about, unlike `CAN-004`'s own
    fulfilment-lock dance.
    - **2026-09-26 correction (independent-review repair, finding 5):**
      the claim above that Return operations "never touch `OrderLine`...
      rows at all" was true for the READS `performInitiate` always did,
      but incomplete about locking — it never actually row-locked the
      `OrderLine`(s) it read before checking for a conflicting Exchange,
      which is a genuine gap (see `EXC-004`'s matching correction).
      `performInitiate` now locks every targeted `OrderLine` row
      (`SELECT ... FOR UPDATE`, sorted for deadlock-avoidance, the same
      idiom `OrderService`'s own multi-line lock already established)
      as the FIRST statement of its transaction, specifically so a
      genuinely concurrent `ExchangeService.performInitiate` on the
      SAME line serializes on that identical row lock rather than both
      racing to completion. This is the one exception to "Return never
      touches OrderLine rows" — a read/lock only, never a write; the
      claim about `OrderFulfilment`/`PickTask` remains accurate and
      unchanged.
  - **Reverse logistics:** reuses the SAME `ShippingProvider.
    initiateReversePickup` two-phase durable-intent pattern
    `SHIP-005`/M17 established for forward shipments — the
    `ReturnPickup` row commits `SCHEDULED` before the carrier is ever
    called.
  - **Inventory:** a new `RETURN_DISPOSED` ledger type (write-off/
    return-to-supplier) alongside the existing `RETURN_QC_PASS`/
    `RETURN_QC_FAIL` types (already present in the schema before this
    build). Physical arrival never auto-increments sellable stock
    (`INV-006`): `postReturnReceipt` posts `returnPending += quantity`
    only; disposition (`postReturnDisposition`) is the ONLY path that
    can move stock to `onHand`/`damaged`, and only after the QC gate.
  - **Failed-QC financial boundary (the open question this entry
    exists to resolve):** the approved spec defines the INVENTORY
    disposition rule for a failed-QC return (`INV-006`) but never
    defines its FINANCIAL consequence. Guessing either "always refund"
    or "never refund" would silently invent an unapproved business
    rule with real money at stake. The engineering default: physical
    disposition still posts unconditionally (a real warehouse
    requirement), but `ReturnLine.refundEligible` is set `true` ONLY on
    a `PASS` outcome — a `FAIL` outcome leaves it `false`, requiring an
    explicit human (Finance/CS) decision before any money moves. M20's
    `RefundService` never processes a line this flag leaves ineligible.
  - **Scope boundary — M19→M20 handoff:** `ReturnService` never
    executes refund/store-credit logic itself — `refundEligible`/
    `refundEligibleAt` are a durable, auditable, traceable handoff only,
    consumed later by M20's `RefundService` (see `REF-005`).
  - **Mobile evidence upload (2026-09-26, independent-review repair,
    finding 2):** the original M19 build left this genuinely unbuilt
    (acceptance/m19-returns.md's own mobile-behaviour box was left
    honestly unchecked, not silently marked done). Repaired by adding
    `ReturnPolicy.evidenceRequired` (config-driven, resolved through the
    SAME style > category > platform-default order `resolveReturnPolicy`
    already uses for `windowDays`/`returnable` — no separate/duplicated
    policy table) and a new `ReturnEvidence` model (one row per uploaded
    file, `objectKey String @unique` as the ONLY pointer into storage).
    - **Storage:** no usable S3/MinIO client existed anywhere in this
      codebase before this repair — ADR-0007 scaffolds the config
      surface (`S3_ENDPOINT`/`S3_BUCKET`) and a MinIO docker-compose
      service, but no application code ever called it, and no MinIO
      instance is reachable in CI or this sandbox to test against.
      Rather than ship an untested S3 client (violating "update
      acceptance only after real tests prove it"), the minimum provider
      abstraction this pass can both build AND genuinely verify is a
      private LOCAL-DISK provider
      (`modules/returns/evidence-storage.ts`,
      `EvidenceStorageProvider` interface) — never registered as a
      static-served directory by any route, so no object has a public
      URL regardless of key; a real `S3EvidenceStorageProvider` can
      implement the SAME interface later without touching
      `ReturnService`.
    - **Security:** `objectKey` is always server-generated
      (`crypto.randomUUID()`), never a client-supplied filename/path;
      the allowlisted MIME type is resolved by sniffing the file's OWN
      magic-number byte signature (`sniffImageMimeType`), NEVER the
      client-declared multipart Content-Type — a renamed executable
      claiming to be `image/jpeg` is rejected on its real bytes, closing
      "reject unsupported/executable payloads" against the one vector
      that actually matters; a bounded file size (config, plus a
      `@fastify/multipart` transport-level backstop) and a bounded
      file-count-per-line; ownership/RBAC-checked on every read
      (customer: the same clean-404 IDOR pattern every other storefront
      return route uses; staff: `return:read`) — content is streamed
      through the service on every request, never cached behind a
      reusable URL.
    - **Test requirements:** `test/integration/returns.test.ts`'s
      "Return evidence upload" describe block (12 tests) and
      `test/e2e-storefront/returns.spec.ts`'s genuine-mobile-viewport
      upload test (Playwright `setInputFiles` against a real
      `<input type="file" capture="environment">`).
  - Full design rationale and the 31-point adversarial matrix:
    `ReturnService`'s own docblock in
    `services/commerce-api/src/modules/returns/service.ts`, and
    `services/commerce-api/test/integration/returns.test.ts`.
- **Affected specs:** `specs/18-returns.md`, `specs/06-inventory.md`

---

## REF — Refunds

#### REF-001 — COD refund mechanism · **P0**
- **Question:** How is a COD order refunded?
- **Dependencies:** REF-002, PAY-001
- **Status:** DECIDED · **Decision date:** 2026-09-22
- **Final decision:** **Prepaid orders: refund to the original payment method where supported/appropriate. COD orders: refund as STORE CREDIT** (explicit, §17). No further decision needed.
- **Affected specs:** `specs/19-refunds.md`

#### REF-002 — Store credit / wallet as a platform concept · **P0**
- **Question:** Does store credit exist as a platform concept?
- **Dependencies:** none
- **Status:** DECIDED · **Decision date:** 2026-09-22
- **Final decision:** **Yes.** Store credit is a **separate financial/customer-balance concept**, distinct from the loyalty-points ledger (explicit, §19). Maintained as its own auditable ledger. **Does NOT expire** under the currently approved business rule. May be used together with loyalty and coupons/promotions, subject to configurable eligibility/stacking rules.
- **Affected specs:** `specs/19-refunds.md`, `specs/22-loyalty.md`, `specs/33-store-credit-gift-cards.md`

#### REF-003 — Refund timelines & partial refund rules · **P1**
- **Question:** SLA, and partial refunds?
- **Dependencies:** RET-002
- **Status:** DECIDED · **Decision date:** 2026-09-22
- **Final decision:** **Partial refunds MUST be supported** (explicit, §17). **Refund calculation MUST use the original transaction values, not current catalog prices** (explicit, §17, reinforcing `CAT-001`). Refund operations **MUST be auditable and idempotent** (explicit, §17). SLA timelines communicated to customers are configurable, not blocking.
- **Affected specs:** `specs/19-refunds.md`

#### REF-004 — Refund reason capture vs. return reason · **P2**
- **Question:** Separate field or inherited?
- **Dependencies:** RET-002
- **Status:** DECIDED (engineering default) · **Decision date:** 2026-09-22
- **Final decision:** Inherited from return reason by default for return-triggered refunds; separately captured for non-return-triggered refunds (e.g., cancellation, goodwill).
- **Affected specs:** `specs/19-refunds.md`

#### REF-005 — M20 refund settlement/idempotency data model · **P1**
- **Question:** How does a new `RefundService` settle the two durable
  handoffs M18 (`Order.refundRequired`) and M19
  (`ReturnLine.refundEligible`) deliberately left unexecuted, without
  collapsing Cancellation/Return/Refund/StoreCredit into one generic
  "reverse order" workflow, and without re-litigating M14's certified
  payment-webhook transaction guarantees?
- **Dependencies:** REF-001, REF-002, REF-003, CAN-004, RET-005, PAY-001
  (M14)
- **Status:** DECIDED (engineering default) · **Decision date:** 2026-09-25
  (M20 build)
- **Final decision:** One `Refund` row per `OrderLine` (`orderLineId`
  `@unique`) — never per-order, so a partial refund of a multi-line
  order/return naturally refunds only the qualifying line's own
  original value (`REF-003`). `orderLineId` uniqueness is the sole
  idempotency anchor, sound because a given line's lifecycle is
  CANCELLATION-refund XOR RETURN-refund, never both (`CAN-004`'s
  pre-shipment-only cancellation window and `RET-005`'s
  delivered-only return eligibility are already mutually exclusive).
  - **Settlement rail:** derived purely from `Order.paymentMethod`
    (`REF-001`) — PREPAID → `RazorpayPaymentProvider.refund()` (fully
    implemented in M14 but never called until this build wired it up;
    extended with a deterministic idempotency key, the local `Refund`
    row's own id, threaded to Razorpay's own idempotency-key header).
    COD → `StoreCreditService.issue()`. Never derived from trigger
    type.
  - **Two-phase durable-intent pattern** (the same idiom `SHIP-005`/M17
    and `RET-005`/M19 already established): a `PENDING` `Refund` row
    commits before any external call; settlement then claims it to
    `COMPLETED`/`FAILED` via a conditional update. A `FAILED` refund is
    retryable (`POST /refunds/:id/retry`) and recoverable via a
    reconciliation sweep (`POST /refunds/reconcile`, mirroring
    `OrderService.reconcilePendingInvoices`) — deliberately explicit/
    staff-triggerable rather than an automatic side effect wired into
    M18/M19's own certified `performCancellation`/
    `recordQcAndDisposition` code, keeping this milestone's change
    surface additive.
  - **Credit note:** reuses the credit note M18's own cancellation flow
    already issues in-transaction when one exists; issues a fresh one
    through the same M08 `InvoiceService` engine for a return-triggered
    refund (none existed yet). Falls back to `OrderLine.lineTotalInclusive`
    directly, without a credit-note document, only when no invoice/
    `InvoiceLine` correlation exists yet (mirrors `CAN-004`'s own
    honest-skip precedent).
  - **Store credit:** a separate financial/customer-balance ledger
    (`REF-002`) — `StoreCreditAccount`/`StoreCreditEntry`, structurally
    distinct from loyalty (which doesn't exist in this codebase; M23
    remains unauthorized). Owned by the same `customerId`-XOR-
    `guestSessionId` identity every order/return already uses. No
    expiry job anywhere in this codebase (`REF-002`: does not expire).
  - **Two genuine concurrency bugs** this build's own adversarial tests
    caught and fixed, both documented inline and covered by regression
    tests: (1) several concurrent refund-processing calls for the SAME
    line could each independently attempt credit-note issuance before
    any of them committed — fixed by locking the `OrderLine` row before
    any other work in the refund-intent transaction; (2) two DIFFERENT
    lines refunded concurrently for the same guest/customer could race
    on first-ever `StoreCreditAccount` creation — a first fix attempted
    to catch-and-recover mid-transaction, which is invalid in Postgres
    (a failed statement aborts the whole transaction); properly fixed
    by retrying the whole transaction once on that specific race.
  - **2026-09-26 addendum (independent-review repair, finding 4 —
    deeper refund-concurrency recheck):** the original design reasoned
    that `RefundStatus` should have "two terminal states, no in-flight
    PROCESSING state," on the theory that a third status would let two
    concurrent attempts both think they own the retry. That reasoning
    had it backwards, and independent review correctly asked for a
    recheck of PENDING/FAILED retry races, concurrent `settle()` calls,
    a provider-success-then-process-crash-before-claim scenario, and a
    reconciliation sweep racing an explicit staff retry. Before this
    addendum, `settle()` had NO in-flight claim at all — two genuinely
    concurrent `settle()` calls for the same PENDING/FAILED refund both
    proceeded straight to calling the external Razorpay/store-credit
    operation, relying ENTIRELY on that external system's own
    idempotency (Razorpay's `x-razorpay-idempotency-key`,
    `StoreCreditService`'s own `idempotencyKey`) rather than any
    protection this system itself provided.
    - **Fix:** a new `PROCESSING` status, claimed via a genuine
      database-level CAS (`updateMany` from PENDING/FAILED, or a
      PROCESSING row stale past `REFUND_PROCESSING_STALE_SECONDS`, to
      PROCESSING) as the FIRST thing `settle()` does, BEFORE calling any
      external operation — the exact same "claim, act, claim again"
      idiom the existing PENDING→COMPLETED/FAILED claim already used,
      just applied one step earlier. Only the caller whose conditional
      update actually affects a row proceeds to call the external
      operation; a concurrent loser returns the current row immediately
      without waiting for the winner — a genuine, intentional API
      behaviour: a caller may transiently observe `PROCESSING` rather
      than the eventual `COMPLETED` outcome, proven and documented by
      `refunds.test.ts`'s own concurrency test rather than assumed away.
      A stale-PROCESSING row (the process that claimed it crashed before
      ever reaching the terminal claim) is recoverable via the SAME
      age-based-cutoff idiom `PaymentService.expireStalePayments`
      already established elsewhere in this codebase.
    - **Honest limit of what this closes:** the PROCESSING claim closes
      every race genuinely within this system's OWN control. It does
      NOT, and cannot, strengthen Razorpay's own idempotency-key
      contract, which is real but TIME-BOUNDED (honored for a fixed
      window from first use, not an unconditional forever-exactly-once
      guarantee) — a crash-then-retry straddling more than that window
      is a residual risk inherent to building on Razorpay's actual
      documented contract, not something application code can close,
      and this repair does not claim otherwise.
    - **Test requirements:** `refunds.test.ts`'s new tests prove (1) a
      concurrent PREPAID settlement calls the mocked Razorpay refund
      endpoint exactly once, (2) a stale-PROCESSING row recovers via
      retry, (3) a FRESH (non-stale) PROCESSING row is left alone by a
      concurrent retry and never re-calls the provider, and (4) an
      explicit staff retry racing the reconciliation sweep for the SAME
      refund still converges to exactly one completed settlement and
      exactly one provider call.
  - Full design rationale and the 20-point adversarial matrix:
    `RefundService`'s own docblock in
    `services/commerce-api/src/modules/refunds/service.ts`, and
    `services/commerce-api/test/integration/refunds.test.ts`.
- **Affected specs:** `specs/19-refunds.md`, `specs/33-store-credit-gift-cards.md`

#### GC-001 — M30 Gift Cards data model, code security, and purchase-flow architecture · **P1**
- **Question:** How does a new `GiftCardService` model a genuinely
  DISTINCT stored-value instrument (customer-purchasable, per specs/33)
  while reusing the store-credit/loyalty ledger MECHANICS rather than
  duplicating them; how is the redeemable code kept safe against
  guessing/enumeration/leakage; and how does gift-card purchase get a
  real payment/order semantic without either creating a second
  CheckoutSession/Order machinery or touching the M14-certified
  Payment/PaymentEvent capture logic?
- **Dependencies:** REF-002, REF-005, PAY-001 (M14), EXC-004 (the
  PaymentEvent additive-correlation precedent), LOY-001 (the signed-
  delta ADJUSTMENT precedent)
- **Status:** DECIDED (engineering default) · **Decision date:**
  2026-09-29 (M30 build)
- **Final decision:**
  - **Ledger shape:** `GiftCard`/`GiftCardLedgerEntry`/
    `GiftCardRedemptionHold` copy `StoreCreditAccount`/`StoreCreditEntry`/
    `StoreCreditRedemptionHold`'s exact idiom (row-lock-before-mutate,
    non-authoritative preview outside a transaction + authoritative
    reserve inside one right after the CheckoutSession row exists,
    ACTIVE/CONVERTED/RELEASED holds, a stale-hold sweep) as a
    structurally SEPARATE table group — never a shared model, so
    origin/type stays unambiguous by construction rather than by a
    discriminator column someone could forget to check. A gift card's
    own row IS its "account" (no separate account table) — addressed by
    possession of the code, not by `customerId`/`guestSessionId` the
    way store credit/loyalty are.
  - **Code security:** a ~80-bit-entropy, display-formatted code
    (`GC-XXXX-XXXX-XXXX-XXXX`, a 33-character alphabet excluding
    0/1/O/I). The plaintext is NEVER persisted — only its unsalted
    SHA-256 hash, the SAME convention this codebase already uses for
    OTP codes and refresh/session tokens (reserved for high-entropy,
    randomly generated, non-guessable secrets — bcrypt stays reserved
    for low-entropy user-chosen credentials like staff passwords, per
    that convention's own established reasoning). The plaintext is
    returned to the caller exactly once, at issuance, never re-
    derivable from any other route, and audit payloads for every
    gift-card event are proven (adversarially tested) to never contain
    it or its hash. Every redemption-path rejection (unknown code,
    disabled, insufficient balance, expired) returns the IDENTICAL
    generic message — closing the differentiated-error enumeration
    vector this milestone's own security requirements called out.
  - **Checkout integration:** the FOURTH and final reduction in
    `CheckoutService.startCheckout`'s existing promotion → loyalty →
    store credit chain, gated by a new `Promotion.giftCardCompatible`
    flag mirroring `loyaltyCompatible`/`storeCreditCompatible` exactly
    (default `true`, additive, never a behavior change for an existing
    promotion). At most ONE gift card per checkout
    (`GiftCardRedemptionHold.checkoutSessionId` is `@unique`) — M30's
    own explicit instruction not to invent multi-gift-card stacking.
  - **Manual adjustment is the one SIGNED-delta ledger entry**
    (`GiftCardLedgerEntryType.ADJUSTMENT`, positive credits/negative
    debits) rather than two separate always-positive types — the same
    shape `LoyaltyLedgerEntry.pointsDelta` already established for
    manual corrections in this codebase, applied here for the
    identical reason (a manual correction is inherently bidirectional).
    Every OTHER entry type (`ISSUE`/`REDEEM`/`REFUND_TO_GIFT_CARD`)
    stays a positive magnitude with direction implied by `type`,
    exactly like store credit — both halves enforced by DB CHECK
    constraints, not just application code.
  - **Refund-to-gift-card is staff-initiated only, never automatic** —
    deciding how a refund should allocate across multiple tender types
    on one order (gift card vs. original payment method vs. store
    credit) is a business policy this milestone does NOT invent, per
    specs/33's own "Refund interaction" section. A staff member with
    `giftcard:manage` who has already decided a specific refund should
    land on a specific card calls `refundToGiftCard` directly; no
    engineering-invented automatic-allocation rule exists.
  - **Purchase flow architecture:** deliberately NOT a second
    CheckoutSession/Order (a gift card has no physical SKU, no
    shipping, no inventory reservation) and deliberately NOT a change
    to the certified `Payment` model (`checkoutSessionId` stays
    required, unmodified). Instead, `GiftCardPurchase` is its own
    top-level row, reusing `RazorpayPaymentProvider` directly (COD is
    never accepted — nothing to physically deliver, a product-shape
    boundary, not an invented business rule) and correlating to its own
    webhook capture via the EXACT additive-correlation pattern `EXC-004`
    already established for Exchange price-difference payments
    (`PaymentEvent.exchangeId`): a new nullable
    `PaymentEvent.giftCardPurchaseId`, checked only after both `payment`
    and `exchangeMatch` have already failed to resolve, dispatching to
    `GiftCardService.applyPurchaseCaptureOutcome` — the M14-certified
    `applyOutcome`/`applyCaptureOutcome` logic is completely untouched.
  - **Genuine pre-existing gap this build's own work exposed and
    fixed:** M30's own explicit "gift card covering the full payable
    amount" requirement surfaced that NOTHING in
    `CheckoutService.startCheckout`/`retryPayment` ever handled
    `amountPayable <= 0` — a case loyalty+store-credit could already in
    principle produce today, just never actually reached by any
    existing test. Fixed with the smallest safe repair: when the full
    reduction chain (now including gift card) brings `amountPayable` to
    zero or below, the payment result is treated exactly like COD's own
    `{status: 'CONFIRMED'}` shape regardless of which `paymentMethod`
    was chosen — the order confirms in the same request with no
    provider call (Razorpay itself would reject a ₹0 order), matching
    the pre-existing `payments_amount_nonnegative_check` DB constraint
    that already permitted a zero-amount `Payment` row (a strong signal
    this exact case was anticipated at the schema level but never wired
    up in the service). Regression-tested directly
    (`test/integration/gift-cards.test.ts`, test 10).
  - **20 adversarial integration tests**
    (`test/integration/gift-cards.test.ts`): issuance + idempotency,
    signed manual adjustment (credit/debit/cannot-go-negative),
    refund-to-gift-card, disable, checkout-time partial/full
    redemption, over-request rejection, disabled/unknown-code generic-
    error parity, genuine `Promise.all` concurrency (no overspend,
    exactly one winner, real Postgres row locks), the
    `amountPayable<=0` full-coverage repair, combining with COD, the
    `giftCardCompatible` promotion gate, replay/double-conversion
    safety, the stale-hold sweep, staff RBAC (both missing-permission
    and unauthenticated negative cases), an audit secret-leak check,
    and the full purchase→webhook→issuance flow (captured, failed, and
    a duplicate-redelivery safe no-op) with Razorpay mocked at the
    fetch boundary (ADR-0011's own established testing approach).
- **Affected specs:** `specs/33-store-credit-gift-cards.md`

---

## EXC — Exchanges

#### EXC-001 — Exchange data model · **P0**
- **Question:** Linked return+order, or a first-class entity?
- **Dependencies:** ORD-001, RET-002
- **Status:** DECIDED (engineering default) · **Decision date:** 2026-09-22
- **Final decision:** **First-class Exchange entity**, not merely a linked return+new-order pair — required to cleanly preserve financial and inventory auditability across replacement-SKU reservation, price-difference payment, and price-difference store-credit issuance in a single coherent operation, all explicitly required by §18.
- **Affected specs:** `specs/18-returns.md`, `specs/20-exchanges.md`

#### EXC-002 — Price difference handling on exchange · **P1**
- **Question:** Who bears the price difference, and how?
- **Dependencies:** EXC-001, PAY-001
- **Status:** DECIDED · **Decision date:** 2026-09-22
- **Final decision:** **If the replacement costs MORE, the customer pays the difference through an online payment flow/link/checkout. If it costs LESS, the difference becomes STORE CREDIT** (explicit, §18). **Size exchange and colour exchange are both supported. Replacement SKU availability MUST be checked and appropriately reserved** (explicit, §18) — this resolves the replacement-SKU-reservation-timing gap flagged in `blueprint/FASHION_DOMAIN_GAPS.md`: reservation happens at exchange request time, using the same short-lived reservation mechanics as `INV-002`.
- **Affected specs:** `specs/20-exchanges.md`

#### EXC-003 — Exchange eligibility window · **P2**
- **Question:** Same window as returns, or distinct?
- **Dependencies:** RET-001
- **Status:** DECIDED (engineering default) · **Decision date:** 2026-09-22
- **Final decision:** Same window as returns (`RET-001`), configured together for consistency and simplicity.
- **Affected specs:** `specs/20-exchanges.md`

#### EXC-004 — M21 exchange data model, payment integration, and scope boundaries · **P1**
- **Question:** How does a first-class `Exchange` entity (`EXC-001`)
  collect an up-front price-difference payment through M14's certified,
  checkout-session-coupled payment/webhook machinery without modifying
  it, and what happens where the approved spec's requirements outrun
  what can honestly be built in this pass?
- **Dependencies:** EXC-001, EXC-002, EXC-003, RET-005, REF-005, PAY-001
  (M14), INV-002
- **Status:** DECIDED (engineering default) · **Decision date:** 2026-09-25
  (M21 build)
- **Final decision:** A single `Exchange` model (not a linked Return +
  new Order, per `EXC-001`) carrying the original order/line, the
  replacement SKU, reverse-logistics fields, QC/disposition fields, and
  payment/credit settlement fields all on one row — one original item
  ↔ one replacement item per `Exchange` (`orderLineId` `@unique`, the
  same "no sub-quantity, one line at a time" simplification `CAN-004`/
  `RET-005` already established), genuinely reusing `RET-005`'s own
  eligibility resolver (`resolveReturnPolicy`, extracted into a shared
  `modules/returns/policy.ts` used by both `ReturnService` and
  `ExchangeService` — `EXC-003`'s "configured together"), reverse
  pickup (`ShippingProvider.initiateReversePickup`), and QC/disposition
  (`InventoryService.postReturnReceipt`/`postReturnDisposition`)
  machinery rather than duplicating any of it.
  - **Settlement direction** (`EXC-002`) is derived once, at request
    time, from `priceDifference` (replacement SKU's current selling
    price vs. the original line's own frozen value) alone — never from
    any other signal. `>0` → `CUSTOMER_PAYS` (collected immediately,
    since this is economically an incremental purchase, not a
    refund-like consequence needing the QC safeguard). `<0` →
    `STORE_CREDIT`, issued only after the original item's QC passes —
    mirrors `REF-005`'s "never fire a financial consequence before the
    QC gate" discipline applied to a downgrade. `=0` → `EVEN`, nothing
    to settle.
  - **Payment integration without touching M14:** `CUSTOMER_PAYS`
    reuses `RazorpayPaymentProvider.initiate`/webhook end to end, but
    through a NEW, fully separate branch in
    `PaymentService.handleRazorpayWebhook` — checked only when no
    checkout-session `Payment` row matches the incoming event, and
    dispatching entirely to `ExchangeService`'s own transaction/state
    machine. `PaymentService.applyOutcome`/`applyCaptureOutcome` —
    M14's own independently-reviewed capture-atomicity guarantees for
    real checkout payments — are completely untouched. `PaymentEvent`
    gained a nullable `exchangeId` column (alongside the existing
    nullable `paymentId`) so this reuses the SAME event-dedup table/
    discipline as checkout payments, per the acceptance criteria's own
    "same idempotency discipline as M14" requirement. A failed payment
    leaves the exchange retryable (re-uses the SAME stored Razorpay
    order id) without re-initiating the whole exchange (negative
    scenario #3).
  - **Replacement reservation:** `InventoryService.reserve` with a new
    `EXCHANGE_REPLACEMENT_HOLD_DAYS` config (default 14 CALENDAR
    days — far longer than checkout's short-lived default), checked/
    reserved in the SAME request as initiation (negative scenario #1: a
    genuine out-of-stock replacement fails the whole call). If that
    reservation is lost (expired, or otherwise no longer `ACTIVE`)
    before the original item comes back, the `Exchange` durably
    transitions to a `REPLACEMENT_UNAVAILABLE` terminal status with an
    audit row — never a silently lost hold, and never a silent release
    that pretends the exchange is proceeding normally (negative scenario
    #2). Preserves audit history and requires explicit customer/CS
    resolution once in `REPLACEMENT_UNAVAILABLE`.
    - **2026-09-26 correction (Post-Purchase Phase independent-review
      repair, finding 1):** at the original 2026-09-25 build, this
      14-day default was recorded above as an *engineering* default —
      the original M21 build instruction explicitly prohibited inventing
      an arbitrary reservation lifetime, so that framing was wrong. The
      Product Owner has now explicitly **APPROVED 14 calendar days** as
      the default replacement-reservation hold in this repair review.
      This is a genuine, human-given product decision, not an
      engineering default; `EXCHANGE_REPLACEMENT_HOLD_DAYS` remains
      configurable (`packages/config/src/index.ts`), and no other
      arbitrary timing policy has been introduced alongside it. The
      expiry behaviour itself (durable transition to
      `REPLACEMENT_UNAVAILABLE`, never a silent release) was already
      correctly implemented at the original build and is unchanged by
      this correction — only the status/provenance of the 14-day number
      itself was wrong and is now fixed.
  - **Completion** (`InventoryService.convertReservation`, firm
    allocation) waits for BOTH the QC-pass gate and payment/credit
    settlement, whichever arrives last — proven under both orderings by
    this build's own adversarial tests. A QC `FAIL` on the original
    moves the `Exchange` to its own `QC_FAILED` terminal status:
    disposition still posts (a real physical-inventory requirement),
    but the replacement is never allocated, and if a `CUSTOMER_PAYS`
    payment was already captured up-front, it is never auto-refunded —
    both require an explicit human (Finance/CS) decision, the same
    "neither silently benefits nor silently harms the customer"
    discipline `RET-005` established for a failed-QC return.
  - **Cross-domain guard (a genuine gap this build's own testing
    caught):** nothing previously stopped a line from having BOTH an
    active `Return` and an active `Exchange` at once. `ReturnService`
    and `ExchangeService` now each check for the other's existing
    NON-CANCELLED record before initiating — a cancelled record on
    either side does not permanently block the other, since it
    represents nothing having actually happened.
  - **Scope boundary — replacement forward fulfilment:** physical
    pick/pack/ship/tracking of the allocated replacement is explicitly
    OUT of this pass. `Exchange.replacementAllocatedAt` marks the
    replacement as inventory-committed (a firm allocation, no longer
    available for other orders); the warehouse's own physical pick/
    pack/ship of that allocated unit is a manual/follow-on process, not
    tracked by this build. Building a full parallel shipment pipeline
    for the replacement, without creating a second `Order`/`OrderLine`
    the way `EXC-001` explicitly forbids, is a genuine, non-trivial
    design question left for a dedicated follow-up rather than guessed
    here.
    - **2026-09-26 correction and DECISION_REQUIRED (Post-Purchase Phase
      independent-review repair, finding 3):** independent review
      correctly rejected the original build's `status = COMPLETED` the
      moment `replacementAllocatedAt` was set - reaching a firm
      inventory allocation is not the same thing as the replacement
      actually reaching the customer, and reporting it as complete on
      that basis alone overstates what happened. Repaired minimally and
      honestly: `tryComplete` now only reaches a NEW
      `REPLACEMENT_ALLOCATED` status (never `COMPLETED`); a new,
      separately-permissioned (`exchange:fulfil`, distinct from
      `exchange:qc`) staff action,
      `ExchangeService.markReplacementFulfilled`
      (`POST /exchanges/:id/replacement-fulfilled`), is the ONLY path
      that ever sets `status = COMPLETED`, recording
      `replacementFulfilledAt`/`replacementFulfilledByStaffId` for
      audit. This is a genuine, tested state distinction (see
      `exchanges.test.ts` "replacement fulfilment state distinction"),
      not merely a renamed status.

      **DECISION_REQUIRED — EXCHANGE REPLACEMENT FULFILMENT MODEL.**
      Whether/how to integrate the replacement's actual physical
      fulfilment with M16/M17's certified `PickTask`/`OrderFulfilment`/
      `Shipment` pipeline remains open and is NOT resolved by this
      repair - `markReplacementFulfilled` is a manual staff
      confirmation standing in for that integration, not a replacement
      for deciding it. `PickTask.orderLineId`,
      `OrderFulfilment.orderId`/`.lines: OrderLine[]`, and
      `Shipment.fulfilmentId`/`.orderId` are all hard-anchored to an
      `OrderLine` belonging to a real, invoiced `Order` - none of them
      have any notion of "ship this allocated unit without an
      OrderLine". Three concrete options, none silently chosen here:
      1. **Model the replacement as a new `OrderLine` on the SAME
         existing `Order`** (never a second `Order` - `EXC-001` forbids
         that representation). Reuses `PickTask`/`OrderFulfilment`/
         `Shipment`/the exactly-once-`SALE` invariant completely
         unmodified. Requires deciding what this line's own
         `unitPriceInclusive`/`taxableValueSnapshot`/`gstRatePercent`/
         `lineTotalInclusive`/GST-invoice treatment means when the
         Exchange (not a new `Order`-level payment) already owns
         settlement of any price difference - a genuine `TAX`-adjacent
         compliance question this project's own discipline requires
         routing to qualified review, not engineering guesswork, and
         `recordSale()`'s exactly-once-SALE semantics would need an
         explicit answer for a line with no new payment collected
         through the `Order` itself.
      2. **Generalize `PickTask`/`OrderFulfilment`/`Shipment` to accept
         either an `OrderLine` OR an `Exchange` anchor** (nullable dual
         foreign keys with an XOR check, the same idiom
         `return_policies_scope_xor_check`/`orders_identity_xor_check`
         already establish elsewhere in this schema). Avoids the
         tax/invoice entanglement of option 1 and keeps `Exchange` the
         sole settlement owner. Its cost is real: it reopens the
         CERTIFIED M16/M17 schema/services this repair's own binding
         discipline says to preserve untouched except where strictly
         required, for every existing `Order` in the system, not only
         exchanges - a materially larger, cross-milestone change that
         needs its own dedicated design/regression pass, not a same-day
         repair addition.
      3. **Keep `markReplacementFulfilled` as the permanent design** -
         physical fulfilment of an exchange replacement stays a
         manual/operational process outside this platform's own
         pick/pack/ship tracking, by deliberate choice rather than as an
         interim gap. Cheapest to keep, but means exchange replacements
         never get customer-visible tracking/ETA the way an ordinary
         shipment does - a genuine product-experience trade-off for the
         Product Owner to accept or reject, not an engineering call.

      No option is selected by this repair. `REPLACEMENT_ALLOCATED`/
      `markReplacementFulfilled` stand as the honest interim
      state-machine either way this eventually resolves.

      **OPTION 2 SELECTED BY PRODUCT OWNER — 2026-09-26.** The Product
      Owner explicitly selected Option 2 (generalize `PickTask`/
      `OrderFulfilment`/`Shipment` to accept either an `OrderLine` OR an
      `Exchange` anchor), with explicit hard constraints: no second
      `Order`; no fabricated replacement `OrderLine`; no parallel
      exchange-only warehouse/shipping pipeline; `markReplacementFulfilled`
      demoted to an exception/recovery mechanism only, never the normal
      happy path; a genuine DB-level "exactly one source" guarantee
      (nullable dual-source FKs, not an unvalidated generic polymorphic
      reference); every existing M16/M17 certified invariant preserved
      unchanged; and inventory-ledger semantics for the replacement's
      physical dispatch defined explicitly rather than reusing
      `ORDER_LINE` `SALE` semantics. Implemented the same day
      (migrations `20260926120000_exchange_fulfilment_generalization`,
      `20260926120100_exchange_dispatch_unique_index`):

      - **Schema.** `PickTask.orderLineId` is now nullable; a new
        `PickTask.exchangeId` (nullable, `@unique`) is added, with a
        same-row CHECK constraint (`pick_tasks_source_xor_check`:
        `(orderLineId IS NOT NULL) != (exchangeId IS NOT NULL)`) — a
        genuine per-row XOR, the exact tool this schema already uses
        elsewhere (`return_policies_scope_xor_check`/
        `orders_identity_xor_check`). `OrderFulfilment` gains a nullable
        `exchangeId` (`@unique`); its own exclusivity ("sourced EITHER by
        child `order_lines` OR by `exchangeId`, never both") is a genuine
        CROSS-TABLE invariant a same-row CHECK cannot express, so it is
        enforced instead by a trigger pair
        (`check_fulfilment_line_exclusivity` on `order_lines` BEFORE
        INSERT/UPDATE OF `fulfilmentId`; `check_exchange_fulfilment_exclusivity`
        on `order_fulfilments` BEFORE INSERT/UPDATE OF `exchangeId`) — the
        "equally strong relational design" the Product Owner's own
        instruction explicitly permitted as an alternative to a raw
        CHECK, and the correct SQL tool for a cross-table invariant.
        `orderId` stays `NOT NULL` on both `PickTask` and
        `OrderFulfilment` even for an exchange-anchored row — it is the
        ORIGINAL order the exchange belongs to (never a second `Order`),
        so every existing `orderId`-scoped index/query/RTO lookup needed
        zero changes. `Shipment` needed NO schema change at all: it is
        1:1 with `OrderFulfilment` (`fulfilmentId` `@unique`), so its own
        source is entirely derived from whichever `OrderFulfilment` it is
        attached to.
        - **2026-09-26 concurrency correction (final independent
          review, migration `20260926130000`):** the trigger pair as
          originally written read the OTHER side's row via a plain
          SELECT, with no lock — under READ COMMITTED that is not
          itself a serialization point, so two genuinely concurrent
          transactions (one setting a fulfilment's `exchangeId`, the
          other attaching an `order_lines` row to that SAME fulfilment)
          could each read the other's pre-commit state and both pass —
          a genuine write-skew race that could violate the very
          invariant this trigger pair exists to enforce. This was a
          real gap in the original design, not merely a theoretical
          one recorded for completeness. Fixed by giving both
          directions a SHARED serialization point: the SAME
          `order_fulfilments` row's own lock.
          `check_exchange_fulfilment_exclusivity` already runs holding
          that lock for free (its own UPDATE/INSERT targets this exact
          row); `check_fulfilment_line_exclusivity` now explicitly
          `SELECT ... FOR UPDATE`s the target `order_fulfilments` row
          before reading its `exchangeId`, so it blocks on — and only
          then reads the true committed state of — any transaction
          concurrently touching the SAME fulfilment in either
          direction. Proven with a genuine two-connection concurrent-
          transaction test (`test/integration/exchange-fulfilment-xor-race.test.ts`),
          run repeatedly, asserting the committed XOR invariant holds
          under both interleavings. The earlier "the database
          invariant is enforced regardless of which application code
          path is used" framing was correct in intent but overstated
          before this fix — it is accurate only from this migration
          onward.
      - **Inventory-ledger semantics (defined explicitly, not guessed).**
        A new `InventoryTxnType.EXCHANGE_DISPATCH`, posted by a new
        `InventoryService.recordExchangeDispatch` (same combined
        `onHand -= qty` / `reserved -= qty` balance effect as `recordSale`,
        same reservation-validity/sufficiency checks, same partial-unique-
        index exactly-once defence — `inventory_transactions_exchange_dispatch_once`,
        scoped to `type='EXCHANGE_DISPATCH' AND referenceType='EXCHANGE'`)
        — but a DISTINCT type and method from `SALE`, since the
        replacement was never a second retail transaction: no second
        `Order`/`OrderLine`/invoice exists for it, and its price
        difference was already settled by `Exchange` itself
        (`CUSTOMER_PAYS` payment or `STORE_CREDIT`) at
        `REPLACEMENT_ALLOCATED` time — conflating it with `SALE` would
        misrepresent the ledger as a second sale. Any GST/invoice
        consequence of this physical dispatch is explicitly **TAX/
        COMPLIANCE REVIEW REQUIRED** — not decided or guessed here; this
        change posts only the inventory-ledger consequence, never a tax
        document.
      - **Service layer.** `WarehouseService` gained
        `createPickTaskForExchange` (the Exchange analogue of
        `createPickTasksForOrder`, called from `ExchangeService.tryComplete`'s
        own reservation-conversion transaction — the exact moment-of-parity
        with a normal order's ALLOCATED → PickTask creation) and a branch
        in `recordPickOutcome`: an exchange-anchored task has no
        `OrderLine` to re-verify (moot anyway, since `cancelExchange` is
        only reachable BEFORE `REPLACEMENT_ALLOCATED`, i.e. strictly
        before its `PickTask` can exist); a pick shortfall/exception
        routes to the ALREADY-EXISTING `ExchangeStatus.REPLACEMENT_UNAVAILABLE`
        (the same status a lost reservation already used) rather than
        inventing a new one, since both represent the identical fact:
        "the replacement this Exchange committed to is no longer
        deliverable." `OrderService` gained `assignExchangeToFulfilment`
        (the Exchange analogue of `assignLinesToFulfilment` — requires the
        replacement `PickTask` to be `PICKED`, idempotent by construction)
        and branches in `markFulfilmentShipped` (posts
        `EXCHANGE_DISPATCH` instead of iterating child lines/`recordSale`
        when `fulfilment.exchangeId` is set) and `markFulfilmentDelivered`
        (flips `Exchange.status` to `COMPLETED` — the normal, AUTOMATIC
        happy path — recording `replacementFulfilledAt`/
        `replacementFulfilledByStaffId`, the latter left `null` when
        delivery was carrier/webhook-triggered rather than a staff
        action). Both write directly to the `exchanges`/`pick_tasks`
        tables rather than importing `ExchangeService` (the same
        avoided-circular-dependency precedent `WarehouseService` already
        used for direct `order_lines` writes — `ExchangeService` imports
        `OrderService`/`WarehouseService`, so the reverse import would
        cycle). `ShippingService` needed ZERO changes: every method was
        already fully generic over `fulfilmentId`; its one RTO branch
        (`OrderService.markRTO`) already catches and reconciles-for-a-
        human exactly the `ValidationError` an exchange-anchored
        shipment's RTO produces (the original order's own lines are
        DELIVERED, not SHIPPED), via the SAME pre-existing multi-shipment
        fallback — no special-casing needed.
      - **Completion.** `Exchange.status` now reaches `COMPLETED`
        AUTOMATICALLY the instant its replacement's `OrderFulfilment`/
        `Shipment` reaches `DELIVERED` — the normal happy path.
        `markReplacementFulfilled` remains, demoted exactly as instructed
        to an exception/recovery mechanism for a replacement genuinely
        fulfilled outside this tracked pipeline — never the route a
        correctly-flowing exchange takes.
      - **New route.** `POST /exchanges/:id/fulfilment` (gated by the
        existing `exchange:fulfil` permission — no new permission
        needed) groups an exchange's already-`PICKED` replacement task
        into a new `OrderFulfilment`; pack/ready-to-ship/ship/deliver all
        REUSE the existing `/orders/fulfilments/:fulfilmentId/*` routes
        completely unchanged (gated by the existing `order:fulfil`), and
        pick reuses the existing `/warehouse/pick-tasks/:id/pick`
        (gated by the existing `warehouse:pick`) — no parallel routes,
        no new base permissions, only the one manager-level checkpoint
        `exchange:fulfil` already gated.
      - **Tests.** `test/integration/exchange-fulfilment.test.ts` (16
        adversarial tests): normal `OrderLine` fulfilment unchanged;
        full pick→pack→ship→deliver→`COMPLETED` happy path (manual staff
        routes AND real carrier tracking/webhook-driven delivery, in two
        separate tests); replacement cannot ship before allocation (no
        `PickTask` exists yet); no duplicate warehouse work (idempotent
        assign-to-fulfilment); concurrent pick; concurrent assign-to-
        fulfilment; concurrent shipment creation; duplicate `delivered`
        webhook (safe no-op, no double completion/dispatch); tracking
        visible to the owning guest (and a clean 404 for a different
        guest); `COMPLETED` reached ONLY after `DELIVERED` (not at
        `SHIPPED`/`IN_TRANSIT`); exactly-once `EXCHANGE_DISPATCH`, never
        a second `SALE`, and the original order's own `SALE` row
        untouched; a pick exception on the replacement routing to
        `REPLACEMENT_UNAVAILABLE`; a `QC_FAILED` and a `CANCELLED`
        exchange each never getting a `PickTask` at all; RBAC (a role
        without `exchange:fulfil` is rejected, unauthenticated is
        rejected); IDOR/BOLA (a role without the base
        `warehouse:pick`/`order:fulfil` permissions is rejected on an
        exchange-anchored task exactly as on a normal one); idempotency-
        key replay (retry/process-restart); and two unrelated exchanges
        on two different orders progressing independently under real
        concurrency. All existing `exchanges.test.ts`/`warehouse.test.ts`/
        `shipping.test.ts` suites re-run green, zero regressions, proving
        every preserved invariant this instruction listed.
  - Full design rationale and the 19-point adversarial matrix:
    `ExchangeService`'s own docblock in
    `services/commerce-api/src/modules/exchanges/service.ts`, and
    `services/commerce-api/test/integration/exchanges.test.ts`.
- **Affected specs:** `specs/20-exchanges.md`, `specs/18-returns.md`,
  `specs/13-payment.md`

---

## CUST — Customer 360

#### CUST-001 — Data retention & deletion policy · **P1**
- **Question:** Retention period, and account-deletion handling?
- **Dependencies:** AUD-002
- **Status:** **UNDER_REVIEW** · **Decision date:** —
- **Final decision:** Not resolved by Product Owner business instruction — this is fundamentally a data-protection **compliance/legal question requiring verification** (§28 explicitly lists "data/privacy" among items not to be settled by invented legal conclusions). Remains routed to legal verification, tracked jointly with `AUD-002`. Does not block M00/M01.
- **Affected specs:** `specs/21-customer-profile.md`, `specs/30-audit-compliance.md`

#### CUST-002 — Marketing preference center granularity · **P1**
- **Question:** Granular per-channel or one global toggle?
- **Dependencies:** MKT-001
- **Status:** DECIDED (engineering default) · **Decision date:** 2026-09-22
- **Final decision:** Granular, per-channel (SMS/WhatsApp/Email/Push — matching the required notification-channel architecture, `NOTIF-001`) and per-message-type, not a single global toggle.
- **Affected specs:** `specs/21-customer-profile.md`, `specs/24-marketing.md`
- **M22 implementation note (2026-09-26, corrected by the same-day certification repair):** built as `CommunicationPreference` (customer × channel × message type, unique per triple), with a controlled `CommunicationMessageType` vocabulary (`ORDER_UPDATES`, `OFFERS_AND_PROMOTIONS`, `PRODUCT_RECOMMENDATIONS`, `NEWSLETTER`). `ORDER_UPDATES` is the one transactional type in this vocabulary and defaults to opted-in, but the original build's HTTP-400 rejection of opting out of it was an invented rule this spec never actually authorized (this decision only requires granularity, not a non-opt-outable type) — removed in the 2026-09-26 certification repair; the customer can now set any value for it, same as every other message type. `CUST-001`/`AUD-002` remain the actual compliance authority on consent, and downstream notification-delivery enforcement for legally-required transactional messages remains a separate, undecided policy question.

#### CUST-003 — Internal Customer 360 view vs. self-service profile scope split · **P2**
- **Question:** Distinct internal view, or the same screen?
- **Dependencies:** ADM-002
- **Status:** DECIDED (engineering default) · **Decision date:** 2026-09-22
- **Final decision:** Distinct: a data-minimized, CS-facing Customer 360 view lives in Admin (`28-admin.md`), separate from the customer's own self-service profile (`21-customer-profile.md`) — per the data-minimization principle in `blueprint/CUSTOMER_360.md` §2.
- **Affected specs:** `specs/21-customer-profile.md`, `specs/28-admin.md`

---

## LOY — Loyalty

#### LOY-001 — Loyalty program model & launch scope · **P0**
- **Question:** Does a program exist, and in what shape?
- **Dependencies:** ORG-001
- **Status:** DECIDED · **Decision date:** 2026-09-22
- **Final decision:** **Loyalty IS required. Model: POINTS + TIERS** (explicit, §20). The broader benefit ecosystem (cashback, coupons, promotional/onboarding coupons) is also supported but **kept conceptually separate**, never collapsed into one data structure: `LOYALTY POINTS`, `TIER/STATUS`, `STORE CREDIT/CASHBACK VALUE`, and `PROMOTIONS/COUPONS` are four distinct concepts.
- **Affected specs:** `specs/22-loyalty.md`
- **M22 note (2026-09-26):** M23 (Loyalty) remains unauthorized and unbuilt. The M22 Customer 360 account UI represents the Loyalty section honestly as a disabled "Coming soon" navigation item (`DEPENDENCY_DEFERRED — M23/M24`) rather than fabricating a points/tier balance — see `acceptance/m22-customer-360.md`.
- **M23 implementation note (2026-09-27):** built as `LoyaltyAccount`/`LoyaltyTier`/`LoyaltyLedgerEntry`/`LoyaltyPointAllocation`/`LoyaltyRedemptionHold` — structurally separate models from `StoreCreditAccount`/`StoreCreditEntry` (M20) and from Promotion/Coupon (M24, not yet built), exactly as decided. See `acceptance/m23-loyalty.md`.

#### LOY-002 — Earn rate rules · **P0**
- **Question:** How are points earned?
- **Dependencies:** LOY-001
- **Status:** DECIDED (rate configurable) · **Decision date:** 2026-09-22
- **Final decision:** **Points are earned based on qualifying purchase value** (explicit, §20). The exact earning rate is an intentionally **configurable business parameter — no fixed commercial percentage is invented here** (explicit instruction, §20).
- **Affected specs:** `specs/22-loyalty.md`
- **M23 implementation note (2026-09-27):** qualifying value = `Order.subtotal` (the existing, already-frozen "tax-inclusive sum of lines" field — excludes only shipping), used directly without inventing a new formula. Earn rate is `LOYALTY_EARN_POINTS_PER_100_INR` (engineering default: 1), a configurable env var, never a fixed commercial percentage. EARN triggers at order **confirmation**, not delivery — a deliberate design choice: under M18's certified invariant a shipped/delivered `OrderLine` can never be cancelled, so triggering EARN at delivery would make cancellation-based point reversal (a hard financial-integrity requirement) structurally unreachable for every order that ships. Confirmation-time earning keeps both the cancellation-reversal and return-reversal paths reachable.

#### LOY-003 — Redemption mechanics & minimum redemption · **P0**
- **Question:** How do points convert to discount?
- **Dependencies:** LOY-001
- **Status:** DECIDED (mechanics configurable) · **Decision date:** 2026-09-22
- **Final decision:** **Points may be redeemed on future purchases** (explicit, §20). Exact conversion rate, minimum redemption, and maximum redemption cap per order are configurable business parameters, not invented here.
- **Affected specs:** `specs/22-loyalty.md`
- **M23 implementation note (2026-09-27):** `LOYALTY_REDEMPTION_PAISE_PER_POINT` (default 25), `LOYALTY_MIN_REDEMPTION_POINTS` (default 100), `LOYALTY_MAX_REDEMPTION_POINTS_PER_ORDER` (default 2000) — all configurable engineering defaults. Redemption is modeled as a checkout-time `LoyaltyRedemptionHold` (ACTIVE/CONVERTED/RELEASED), mirroring `InventoryReservation`'s own reservation lifecycle exactly: available-to-redeem = ledger balance minus every currently-ACTIVE hold, so the ledger itself is never mutated until the hold converts to real REDEEM entries at order confirmation. This makes two genuinely concurrent checkouts against the same account structurally unable to double-spend the same points (proven under real Postgres concurrency, `test/integration/loyalty.test.ts` test #14) — never a read-then-unlocked-write.

#### LOY-004 — Expiry policy · **P1**
- **Question:** Do points expire?
- **Dependencies:** LOY-001
- **Status:** DECIDED · **Decision date:** 2026-09-22
- **Final decision:** **Points expire. The expiry period MUST be configurable** (explicit, §20). This explicitly **contrasts with store credit, which does NOT expire** (`REF-002`) — the two ledgers have different expiry semantics by design.
- **Affected specs:** `specs/22-loyalty.md`
- **M23 implementation note (2026-09-27):** `LOYALTY_POINTS_EXPIRY_DAYS` (default 365), tracked per EARN batch (`LoyaltyLedgerEntry.expiresAt`), never as row deletion — expiry posts a real `EXPIRE` ledger entry. A FIFO batch/allocation mechanism (`LoyaltyPointAllocation`) means the oldest-earned batch always expires (and is always drawn down for redemption) first, and expiry is idempotent per batch (`expire:<batchId>`) so a doubly-fired sweep never double-expires the same batch (proven under real concurrency, test #15). Exposed as a callable, staff-gated sweep (`POST /api/v1/loyalty/sweep/expire`), the same shape as the existing `InventoryService.expireStaleReservations`/`RefundService.reconcilePendingRefunds` sweeps.

#### LOY-005 — Loyalty + promotion stacking · **P1**
- **Question:** Can loyalty redemption combine with promotions?
- **Dependencies:** LOY-003, PROMO-002
- **Status:** DECIDED · **Decision date:** 2026-09-22
- **Final decision:** **Store credit may be used together with loyalty and coupon/promotions, subject to promotion/loyalty eligibility and stacking rules** (explicit, §19). Stacking compatibility **MUST be rule-driven/configurable**, mirroring `PROMO-002`.
- **Affected specs:** `specs/22-loyalty.md`, `specs/23-promotions.md`
- **M23 implementation note (2026-09-27):** loyalty redemption and store credit can already combine on the same order — `CheckoutSession`/`Order` carry independent `loyaltyRedemptionValue` and `storeCreditApplied` fields, each computed and applied independently, with `amountPayable` netting both. The promotion/coupon side of this stacking (`PROMO-002`) is `DEPENDENCY_DEFERRED — M24` — M24 (Promotions) is the next milestone in this same authorized phase and has not been built yet at the time this note is written.
- **M24 implementation note (2026-09-27):** promotions/coupons now combine on the same order too — `PromotionService.reserveForCheckout` runs alongside (not instead of) the pre-existing loyalty/store-credit reservation calls inside the same `startCheckout` transaction, and `CheckoutSession`/`Order.promotionDiscountTotal` is a fully independent field from `loyaltyRedemptionValue`/`storeCreditApplied` — no shared "total discount" bucket. See `PROMO-002`'s M24 note for the stacking-compatibility mechanics themselves.
- **M24/M25 independent-review certification-repair note (2026-09-27, Blocker 2):** the M24 note above described independent CO-EXISTENCE of loyalty/store-credit/promotion fields, but this decision's own text ("subject to promotion/loyalty eligibility and stacking rules") requires more than co-existence — it requires the ELIGIBILITY gate itself, which the original build never implemented at all. Repaired via `Promotion.loyaltyCompatible`/`storeCreditCompatible` (both boolean, `@default(true)`), enforced in `CheckoutService.startCheckout` before any reservation begins. See `PROMO-002`'s own Blocker 2 repair note for the complete design record and test references — this entry is the loyalty-side cross-reference, not a duplicate decision.

#### LOY-006 — Reversal completeness when earned points were already spent · **P1** — **RESOLVED BY PRODUCT OWNER (2026-09-27)**
- **Question:** §43-45's requirement — "any loyalty points earned on an order MUST be reversed via a ledger entry if that order is later cancelled or returned" — assumes those points still exist to reverse. What is required when the customer has already redeemed or lost (expired) some or all of them on a different, unrelated order before the cancellation/return occurs?
- **Dependencies:** LOY-001, LOY-003
- **Status:** DECIDED (core question) — a narrow ADMIN-EXCEPTION sub-case remains its own open, separately-scoped question (see the 2026-09-27 resolution note's own tail) · **Decision date:** 2026-09-27
- **Final decision (verbatim, Product Owner, 2026-09-27):** "Loyalty points from a purchase MUST NOT become redeemable immediately after order confirmation or immediately after delivery. Points become redeemable ONLY AFTER: (1) the relevant order line has been DELIVERED; AND (2) the applicable return/exchange eligibility window for that line has CLOSED. Until BOTH conditions are satisfied, earned points are PENDING/NON-REDEEMABLE and must not contribute to the customer's available/spendable loyalty balance." This resolves the ORIGINAL question by making the scenario it worried about (a customer spending points elsewhere before their qualifying order is cancelled/returned) structurally unreachable for the NORMAL customer lifecycle: cancellation (M18) only ever applies to a not-yet-shipped line, which can never be DELIVERED, and a Return/Exchange can only be INITIATED while the calendar window is still open — so by the time a line's points would ever vest (window closed), no NEW return/exchange/cancellation can still be triggered against it through any customer-facing route. A standard return/cancellation can therefore no longer create the "already spent, now short" scenario this decision originally worried about.
- **Affected specs:** `specs/22-loyalty.md` (rewritten — see that spec's own `## LOY-006 RESOLUTION` section for the full lifecycle description; the original `DECISION_REQUIRED — LOYALTY CLAWBACK AFTER POINTS ALREADY SPENT` block is preserved, dated, and marked superseded rather than deleted, per this build's own "never rewrite history" discipline)
- **M23 independent-review certification-repair note (2026-09-27, prior to this resolution):** `LoyaltyLedgerEntry` gained a `requiredPointsDelta` column and a distinct `loyalty.reverse.shortfall` audit event, making a capped reversal's shortfall fully visible rather than silently hidden — this closed the certification's visibility/audit gap but did not select a policy option. Preserved unchanged as history; superseded by the vesting model below for the NORMAL lifecycle.
- **M23 LOY-006 vesting-repair implementation note (2026-09-27):** implemented the smallest correct lifecycle — `LoyaltyEntitlementStatus` (PENDING → VESTED, or PENDING → CANCELLED) on each EARN entry, which is now calculated PER ORDER LINE (`qualifyingOrderLineId`, replacing the original per-order `qualifyingOrderId`) rather than per order, since vesting must be line-aware (different lines can deliver, and close their own return window, on different dates). `LoyaltyAccount.balance`/`lifetimeEarnedPoints` reflect ONLY vested points — a PENDING entry never touches balance, checkout redemption eligibility, minimum-redemption checks, or FIFO draw-down (`LoyaltyService.drawDownFifo` now filters `vestingStatus: 'VESTED'`). `LoyaltyService.vestEligiblePoints()` is the idempotent, concurrency-safe vesting sweep (`POST /loyalty/sweep/vest`, staff-gated identically to every other loyalty sweep) — it reuses the SAME `resolveReturnPolicy`/`isWithinWindow` source of truth `returns/policy.ts` already established for Return/Exchange (never a second, duplicated window rule), and additionally checks for any still-unresolved (no QC decision yet, not CANCELLED) Return or Exchange on the line, since a Return/Exchange initiated just before the calendar window closed can still be mid-flight after it closes. Each candidate is vested in its own transaction that locks the `LoyaltyAccount` row first (the same serialization point `LoyaltyService.reverse` already locks first) so two concurrent sweep invocations, or a sweep racing a concurrent QC-PASS reversal, converge to exactly one outcome. `expiresAt` is set ONLY at vesting time (never at EARN creation), so the configured expiry duration is measured from when points actually became spendable, never silently shortened by time spent PENDING. Cancellation (`reverseForOrderLine`) or a QC-accepted return (`reverseForReturnLine`) against a still-PENDING entry now CANCELS it outright (no balance was ever credited, so the balance-affecting amount is truthfully 0) — but the REVERSE ledger entry, the full `requiredPointsDelta`, and an audit event (`loyalty.pending.cancelled`) are still ALWAYS recorded, satisfying the same "never silently skip a required reversal" principle the original repair established. **Critical repair applied in this same pass:** the previously-shipped `reverse()` method contained `if (actualReverse <= 0) return;` BEFORE creating the REVERSE entry/`requiredPointsDelta`/shortfall audit — meaning a 100%-shortfall case could return having recorded nothing at all, directly contradicting the prior repair's own claim that the required reversal is "always recorded." Fixed: the exceptional/admin-override VESTED-entry branch (structurally unreachable via any normal customer flow, per the reasoning above — reachable only via a hypothetical future admin override this build does not implement) now always creates the REVERSE entry and posts `loyalty.reverse.postvest` or `loyalty.reverse.postvest.shortfall`, even when the balance-affecting amount computes to exactly zero. Proven with a direct unit-level adversarial test that manufactures this exact scenario (`test/integration/loyalty.test.ts`, matrix item #16, since the normal customer-facing routes correctly refuse to reach it). Exchange is handled by extending the ALREADY-DECIDED "reverse on a QC-accepted return" rule to Exchange's own certified QC-PASS gate for the original item (`ExchangeService.recordQcAndDisposition`, mirroring `ReturnService`'s identical PASS-only gating exactly) — not a new invented policy, since Exchange's own certified design already reuses M19's QC machinery for that physical item. No further Exchange-specific `DECISION_REQUIRED` was needed: once QC-PASS fires, the entry is already CANCELLED, so it is structurally removed from the vesting-sweep's candidate pool; while an Exchange is still open (not yet QC-resolved, not CANCELLED), the sweep's own Return/Exchange-in-flight check already blocks vesting. 25 adversarial tests (`test/integration/loyalty.test.ts`, covering all 16 required matrix items plus supporting coverage), full backend regression suite, and `test/integration/promotions.test.ts`'s own cross-domain loyalty-compatibility tests updated to seed genuinely AVAILABLE (vested-equivalent, via staff manual adjustment) points rather than relying on the now-PENDING immediate-earn behavior. See `acceptance/m23-loyalty.md`'s own 2026-09-27 addendum for the corrected Definition of Done.
- **Remaining open item (ADMIN-EXCEPTION sub-case, NOT resolved by the above):** if some future exceptional/admin process ever reverses an ALREADY-VESTED entry whose points were already spent elsewhere (something no normal customer-facing flow in this codebase can trigger), what should happen to that shortfall (negative balance / debt / future-earn clawback / cash-store-credit offset / accept the loss)? This build continues to implement only the honest, fully-audited "accept the loss, record it truthfully" behavior for that narrow case (see the critical-repair note above) — it does NOT invent negative-balance/customer-debt/clawback semantics, and does NOT claim this sub-question resolved. See `specs/22-loyalty.md`'s own `## DECISION_REQUIRED — POST-VEST ADMIN-EXCEPTION SHORTFALL` block.

---

## PROMO — Promotions

#### PROMO-001 — Supported promotion types for launch · **P1**
- **Question:** Which promotion types are required?
- **Dependencies:** CAT-001
- **Status:** DECIDED · **Decision date:** 2026-09-22
- **Final decision:** **Support BOTH coupon-code promotions AND automatic promotions** (explicit, §10). Required types: promotional coupons, campaign coupons, onboarding coupons, cashback-related benefits, and other **configurable** coupon types — the type system itself must be extensible, not a fixed enum.
- **Affected specs:** `specs/23-promotions.md`
- **M24 implementation note (2026-09-27):** `PromotionType` is a genuine reference table (`id`, `key` @unique, `name`), never a fixed enum — a new type is a data row, not a code change. Seeded illustratively with `PROMOTIONAL`/`CAMPAIGN`/`ONBOARDING`/`CASHBACK`, satisfying PROMO-001's minimum list. `Promotion.isCoupon` distinguishes a coupon-code promotion from an automatic one; `couponCode` is `@unique` and only set when `isCoupon = true`. See `acceptance/m24-promotions.md`.

#### PROMO-002 — Stacking/precedence rules · **P1**
- **Question:** Can multiple promotions apply?
- **Dependencies:** PROMO-001
- **Status:** DECIDED · **Decision date:** 2026-09-22
- **Final decision:** **One coupon may coexist with explicitly compatible automatic promotions** (explicit, §10). Compatibility/stacking **MUST be rule-driven/configurable** — do not hard-code every promotion combination.
- **Affected specs:** `specs/23-promotions.md`
- **M24 implementation note (2026-09-27):** compatibility is rule-driven via `Promotion.stackGroup` (nullable string) + `Promotion.priority` (int, lower = applied first, tie-broken by `id`) — never a hard-coded per-combination table. Two promotions sharing the same non-null `stackGroup` are mutually exclusive; automatic promotions are resolved first, greedily, in priority order (the first-by-priority member of a stackGroup wins it); a requested coupon is then checked against the survivors and rejected (with a reason naming the conflicting promotion) if it shares a stackGroup with one already chosen — the coupon is rejected, never the already-applied automatic promotion silently dropped. Each promotion's discount is computed independently against the original pre-discount subtotal (never sequentially compounded); the combined total is capped at the subtotal, with overage removed from the lowest-priority promotion first — a documented engineering default. Concurrency-safe usage caps: `reserveForCheckout` row-locks each candidate `Promotion` (`SELECT ... FOR UPDATE`) and COUNTS existing HOLD/CONVERTED `PromotionRedemption` rows under that lock, rather than a separately-incrementing counter — proven under genuine `Promise.all` concurrency for a single-use coupon race (`test/integration/promotions.test.ts` test #15). See `acceptance/m24-promotions.md` and `specs/23-promotions.md`'s `DECISION_REQUIRED` block for the one open item (coupon-usage restoration after order cancellation — not yet defined or implemented).
- **M24/M25 independent-review certification-repair note (2026-09-27, Blocker 2):** the original M24 build above only ever addressed promotion↔promotion stacking — it left promotion↔loyalty and promotion↔store-credit combination entirely uncontrolled, allowing every promotion to freely combine with any redemption regardless of the approved requirement's own "SUBJECT TO configurable eligibility/stacking rules" clause. Repaired with the smallest correct design, per the reviewer's own explicit instruction not to build a general rules DSL: two plain booleans on `Promotion` — `loyaltyCompatible`/`storeCreditCompatible`, both `@default(true)` (every existing promotion's free-combination behavior is preserved unchanged; only a NEW promotion explicitly marked incompatible restricts anything). `CheckoutService.startCheckout` enforces this server-side immediately after `priceLines()` resolves the applied promotions and before any inventory reservation begins: if the customer is actually attempting to redeem loyalty points or apply store credit (redemption amount > 0) and ANY applied promotion is marked incompatible with that value system, the whole checkout is rejected with a `ValidationError` naming the specific promotion and the conflicting value system — never a silent partial application. A promotion marked incompatible with loyalty still applies normally on an order redeeming zero points. Structural separation is fully preserved: `Promotion` discount, `Loyalty` points, and `StoreCredit` remain three independent value systems and independent ledgers/fields; this repair adds only a compatibility GATE, never a shared computation. Proven in `test/integration/promotions.test.ts` tests #18–#24 (compatible/incompatible × automatic promotion/coupon × loyalty/store-credit, plus a combined coupon + compatible automatic promotion + real loyalty + real store credit scenario with deterministic server-authoritative totals) and end-to-end in the updated FLOW 18 (`test/e2e-storefront/promotions.spec.ts`, `acceptance/e2e-commerce-flows.md`).

---

## MKT — Marketing

#### MKT-001 — Marketing channels & build-vs-integrate for launch · **P2**
- **Question:** Which channels, and native or third-party?
- **Dependencies:** CUST-002
- **Status:** DECIDED (architecture); provider selection deferred · **Decision date:** 2026-09-22
- **Final decision:** Architecture supports SMS, WhatsApp, Email, and Push via a provider abstraction (explicit, §15, shared with `NOTIF-001`). Actual provider/channel activation at launch is configurable, deferred to operational decision — not a build blocker.
- **Affected specs:** `specs/24-marketing.md`
- **M25 implementation note (2026-09-27):** built as `MarketingProvider` (`services/commerce-api/src/modules/marketing/provider.ts`), the same boundary discipline as `ShippingProvider`/`PaymentProvider` — `MarketingService` depends only on the interface, never a vendor SDK. No launch provider selected, per this decision's own "deferred to operational decision": the only implementation shipped is `MockMarketingProvider`, a genuine deterministic double (a malformed/empty destination address genuinely fails, never an unconditional fabricated success). `MarketingCampaign`/`CampaignDelivery` reuse the EXISTING M22 `CommunicationChannel`/`CommunicationMessageType` enums and `CommunicationPreference` opt-in matrix verbatim (CUST-002) rather than inventing a second consent model — a campaign's `messageType` is restricted to genuine marketing types (`OFFERS_AND_PROMOTIONS`/`PRODUCT_RECOMMENDATIONS`/`NEWSLETTER`); `ORDER_UPDATES` is rejected at campaign-creation time since it is reserved for transactional messaging. `CustomerSegment` membership is a live query against `Order`/`LoyaltyAccount` data (`minLifetimeOrderCount`/`minLifetimeSpend`/`loyaltyTierId`), never a stored snapshot or a generalized query DSL — deliberately minimal, per this phase's own "no general workflow engine" boundary. A campaign send is a concurrency-safe compare-and-swap on `MarketingCampaign.status` (DRAFT/SCHEDULED → SENDING), the same idiom `RefundService.claimProcessing` established, with per-recipient idempotency via `CampaignDelivery`'s own `(campaignId, customerId)` uniqueness — proven under genuine `Promise.all` concurrency to converge to exactly one sender, never a double-send. PUSH is honestly `SKIPPED_NO_ADDRESS` for every recipient (no device-token registration flow exists anywhere in this codebase — a documented scope boundary, not a fabricated destination). See `acceptance/m25-marketing.md`.
- **M25 independent-review certification-repair note (2026-09-27, Blocker 3 — scheduling was not genuinely implemented):** the original build persisted `MarketingCampaign.scheduledAt` but never actually acted on it — every campaign, scheduled or not, was created in `DRAFT`, and the only send path was the manual staff `POST /campaigns/:id/send` route, which claimed ANY `DRAFT`/`SCHEDULED` campaign regardless of `scheduledAt`. There was no genuine due-campaign execution mechanism at all, so the acceptance document's "campaign scheduling works" checkbox was checked on a capability that did not exist. Repaired: `createCampaign` now sets `status: 'SCHEDULED'` (not `DRAFT`) whenever a `scheduledAt` is supplied at creation — `DRAFT` now genuinely means "no schedule committed; only an explicit manual send can dispatch this." A new `MarketingService.processDueCampaigns()` (`POST /marketing/sweep/send-due`, staff-gated, the same shape as `POST /loyalty/sweep/expire`) is the automatic due-campaign sweep — a plain callable function compatible with a future external scheduler/cron trigger, never a generalized job platform. Its own campaign-level claim (`claimForSend(id, { dueOnly: true })`) matches ONLY `status = SCHEDULED AND scheduledAt <= now` — literally that condition and nothing broader; a `DRAFT` campaign or a `SCHEDULED` campaign whose `scheduledAt` is still in the future is never touched by it, and a stuck `SENDING` campaign is never reclaimed by the automatic sweep either (that stale-`SENDING` recovery remains a manual-send-only path, deliberately kept separate from the sweep's literal claim condition). The pre-existing manual `sendCampaign()` is unchanged in behavior (it may still dispatch a `DRAFT` or not-yet-due `SCHEDULED` campaign immediately, an explicit separate staff operation) and does not redefine what the automatic sweep itself picks up. Proven with a controlled-time/concurrency test matrix (`test/integration/marketing.test.ts` tests #16–#22): a future-scheduled campaign is never sent early; a campaign is picked up the instant its `scheduledAt <=` now boundary is reached (inclusive, not exclusive); a genuinely past-due campaign is sent; a `DRAFT` campaign is never touched by the sweep (only a manual send dispatches it); a `CANCELLED` scheduled campaign is never sent by the sweep; two genuinely concurrent due-sweep invocations racing the SAME due campaign converge to exactly one sender (`Promise.all`, real Postgres row-level CAS); and a customer opted-in when a campaign was scheduled but who opts out before the due time arrives is correctly suppressed (`SKIPPED_OPTOUT`) by the sweep — preference is checked at SEND time, never snapshotted at schedule time, preserving the one behavior the original build already had right.
- **M25 independent-review certification-repair note (2026-09-27, Blocker 4 — per-recipient dispatch had a crash-then-duplicate-send gap):** the original per-recipient flow was: check no `CampaignDelivery` row exists → call `provider.send(...)` → create the `CampaignDelivery` row as `SENT`/`FAILED`. This left a genuine distributed-systems hole — if the provider accepted a message and the process then crashed before the `CampaignDelivery` insert, a later reclaim of the (now stale) campaign would find no delivery row for that recipient at all and call the provider again, a real duplicate-dispatch risk the campaign-level `SENDING` compare-and-swap does not close (it only prevents two workers from processing the recipient LIST twice, not one worker crashing mid-recipient). Repaired with a durable per-recipient claim taken BEFORE the external provider call: `MarketingService.dispatchToRecipient` first `create()`s a `CampaignDelivery` row with `status: 'PENDING'` — the `@@unique([campaignId, customerId])` constraint is what makes this claim atomic (a concurrent worker's own `create()` for the SAME recipient fails with a unique-constraint violation, P2002, and safely no-ops rather than racing a second provider call), only THEN calls the provider, then records the real outcome. A `PENDING` row found stale (older than `MARKETING_DELIVERY_STALE_SECONDS`, default 120s — shorter than the campaign-level `MARKETING_SENDING_STALE_SECONDS` since one provider call should complete far faster than an entire campaign send) is reclaimed directly into a new terminal status, `CampaignDeliveryStatus.AMBIGUOUS_RECONCILIATION_REQUIRED` — never silently retried, since this codebase's provider abstraction (MKT-001 above: no production provider selected yet) does not guarantee the idempotent-retry contract a blind resend would need. A provider call that itself throws/times out is recorded the same honest way — genuinely unknown, never assumed `FAILED` (which would claim a certainty not actually known) and never auto-retried. A genuine, distinct `FAILED` status remains reserved for a provider's OWN definite rejection of the message (a new `AlwaysFailsMarketingProvider` test double proves this path exists and is distinguishable from the ambiguous one, since `MockMarketingProvider` alone can never reach a provider-level `FAILED` — its only failure trigger, an empty/malformed address, is already intercepted earlier as `SKIPPED_NO_ADDRESS`). Proven adversarially (`test/integration/marketing.test.ts` tests #23–#27): two workers racing to durably claim the same recipient converge to exactly one winner (a direct concurrency proof of the unique-constraint claim mechanism itself); a recipient with an existing FRESH, non-stale `PENDING` claim is skipped, never redispatched; a stale `PENDING` claim (the crash-then-reclaim scenario) is reclaimed as ambiguous WITHOUT a second provider call (`providerMessageId` stays null, proving no redispatch occurred); a provider's definite rejection is recorded `FAILED`; and a provider call that throws is recorded ambiguous and is never auto-resolved or redispatched by a later send (the campaign itself is `FAILED`/terminal once ambiguous, so a subsequent manual send does not even reclaim it). This build does NOT claim universal exactly-once delivery — that would require guarantees the provider abstraction does not make; it claims the honest, weaker, and correct thing: no INTENTIONAL duplicate dispatch, and every genuinely unknown outcome is labeled as such rather than guessed. See `acceptance/m25-marketing.md` for the corrected Definition of Done.

---

## CHAN — Channel Publishing

#### CHAN-001 — Which channels launch first · **P2**
- **Question:** Which marketplace/social channels launch first?
- **Dependencies:** none
- **Status:** DECIDED · **Decision date:** 2026-09-22
- **Final decision:** **None launch now.** Build the **adapter/contract publishing architecture** (core catalog must not embed marketplace-specific fields; use channel-specific mappings) so future integrations to Meta, Instagram, Facebook, Google Merchant, Amazon, Flipkart, Myntra, and Ajio are possible without redesign (explicit, §3, §24). **Actual marketplace integrations are explicitly deferred — not built without separate milestone authorization** (explicit, §3: "DO NOT build these marketplace integrations now unless their milestone is explicitly authorized").
- **Affected specs:** `specs/25-social-channel-publishing.md`
- **M26 implementation note (2026-09-28):** built exactly the adapter/
  contract architecture this decision authorizes, nothing more. A
  `Channel` model (`key`, `providerName`, `isActive`, `config` JSON)
  holds ALL channel-specific field mapping as configuration - the core
  Product Master (`Style`/`Sku`/`Price`) gained zero marketplace-
  specific columns, verified by schema review. `ChannelListing`
  (`@@unique([channelId, skuId])`) tracks publishing status per channel
  per SKU with zero real channels connected, proven against
  `MockChannelProvider` alone (`services/commerce-api/src/modules/
  channels/provider.ts`, the same interface+mock+factory shape
  `MarketingProvider`/`ShippingProvider` already established) plus
  `UnreliableChannelProvider`/`AlwaysFailsChannelProvider` test doubles
  for the outage/definite-rejection distinction. Every publish/unpublish
  attempt - success or failure, validation-rejected or provider-
  rejected - is recorded in an immutable `ChannelPublicationAttempt`
  history row, never silently skipped; a failed listing carries
  `lastError` and an incrementing `retryCount` for reconciliation. New
  `channel:manage`/`channel:read` permissions (deliberately not reused
  from any existing key, the same audit-by-permission precedent M25's
  `campaign:manage` established). No marketplace-specific field was
  ever available to add to core schema in the implemented design - the
  only path for channel requirements is `Channel.config`. Still **no
  concrete integration built** - `MOCK`/`MOCK_UNRELIABLE`/
  `MOCK_ALWAYS_FAILS` remain the only registered provider names.
- **Independent-review certification repair (2026-09-28), two
  blockers:** (1) `buildFeedItem`'s `availability` field was fabricated
  ('in_stock' unconditionally) instead of derived from canonical
  inventory - fixed with a new shared
  `InventoryService.getAvailableToSellBySku(skuIds)` method (the SAME
  cross-location `onHand - reserved` formula the certified public PDP
  already used, extracted from PDP's own inline query so both
  consumers share one implementation - PDP's own output is unchanged,
  proven by its full pre-existing test suite passing byte-for-byte).
  No new inventory table/ledger/channel-specific location-allocation
  policy was invented. Publishability and stock level are kept
  deliberately separate, per the review's own explicit instruction - a
  catalog-publishable zero-stock SKU still publishes as
  `out_of_stock`, no auto-unpublish-at-zero-stock policy exists. Stale-
  projection detection is a pure read-time comparison against
  `ChannelListing.payloadSnapshot` (no new persisted flag, no event
  bus); correction is a new staff-callable sweep
  (`POST /channels/sweep/resync-stale`) that reuses `publishSku` itself
  rather than duplicating any claim/dispatch logic. (2) A thrown/
  timed-out provider call was recorded as an ordinary definite
  failure - fixed with a three-outcome model (`SUCCESS`/`FAILED`-
  definite-known/`AMBIGUOUS_RECONCILIATION_REQUIRED`-genuinely-unknown),
  the SAME status name and reasoning `CampaignDeliveryStatus` (M25) and
  `NotificationDeliveryStatus` (M29) already established for an
  identical reliability problem, applied to both publish and
  unpublish. A durable, row-locked (`SELECT ... FOR UPDATE`) `PROCESSING`
  claim on `ChannelListing`, committed BEFORE any provider call, is the
  real serialization point for concurrent publish/unpublish requests -
  the initial `updateMany`-only CAS design was found, during this
  repair's OWN adversarial testing, to have a genuine window where
  `unpublishSku`'s narrower eligibility check could observe a stale
  pre-claim status; fixed by having the claim's own row lock capture
  the row's true pre-claim status atomically. A staff-callable sweep
  (`POST /channels/sweep/reclaim-stale`) reclaims a claim whose owning
  process crashed mid-flight (`CHANNEL_PUBLISH_STALE_SECONDS`, the same
  idiom `REFUND_PROCESSING_STALE_SECONDS` established). The stable
  `channelId:skuId` idempotency key is unchanged - a real provider is
  expected to de-duplicate on it, including for an operator-safe retry
  of an ambiguous outcome (never a blind automatic retry). A second
  genuine bug this repair's own testing caught: `getChannelProvider`
  was called outside the publish/unpublish try/catch blocks, so a
  provider-resolution failure (unknown name, or the repair's own new
  production guard) would leave a claimed listing stuck at `PROCESSING`
  forever with no outcome recorded at all - fixed by resolving the
  provider inside its own try/catch, recording a DEFINITE `FAILED`
  (never ambiguous, since no external call was ever attempted). New
  production guard: `getChannelProvider` refuses to resolve any
  `MOCK_*` provider when `NODE_ENV=production`. 19 new adversarial
  tests (`test/integration/channels.test.ts`), 2 genuine concurrency
  tests (one using a deterministic manufactured in-flight-claim
  precondition for publish, since `MockChannelProvider`'s near-instant
  completion makes true `Promise.all` overlap non-deterministic through
  the full service call and a non-overlapping second call is a
  legitimate independent resync by design; one genuine `Promise.all`/
  `Promise.allSettled` race for unpublish, whose narrower eligibility
  check makes every interleaving deterministically safe). See
  `specs/25-social-channel-publishing.md`'s own repair addendum and
  `acceptance/m26-social-channel-publishing.md` for the corrected
  Definition of Done. **Note (2026-09-29): the "`channelId:skuId`
  idempotency key is unchanged" claim in this entry was itself found
  unsafe by the next repair below - see that entry for the correction.**
- **Independent-review certification repair (2026-09-29), Blocker 1 -
  provider idempotency operation identity:** the `2026-09-28` repair
  above left the provider-facing `idempotencyKey` as `${channelId}:${skuId}`
  for BOTH publish and unpublish, reused verbatim across every
  publish/resync/unpublish call for a listing. A real provider
  implementing idempotency could conflate an initial publish, a later
  resync after a price/availability change, and an unpublish as the
  same already-processed external operation - genuinely unsafe, and the
  mock provider's own lack of idempotency enforcement meant no existing
  test could have caught it. Fixed with a durable, pre-dispatch
  operation identity: `ChannelListing.currentOperationId` (new column,
  migration `20260929084236_m26_channel_operation_idempotency`),
  resolved inside `ChannelService.claimProcessing`'s own transaction -
  the same point the `PROCESSING` claim itself is committed, BEFORE any
  provider call. Claiming from a SETTLED status (`NOT_PUBLISHED`,
  `PUBLISHED` - a resync, `FAILED` - a retry after a definite,
  presumably-now-different rejection) MINTS a brand new id, since each
  is genuinely a new logical operation; claiming to reconcile a still-
  genuinely-open operation (`AMBIGUOUS_RECONCILIATION_REQUIRED`, or a
  reclaimed stale `PROCESSING`) REUSES the existing id, since it is the
  SAME operation being retried. The provider-facing key is now
  `${channelId}:${skuId}:${action}:${currentOperationId}` - `action`
  (`PUBLISH`/`UNPUBLISH`) keeps the two identity spaces separate even in
  the one legitimate scenario where the SAME operationId is reused
  across both (an ambiguous UNPUBLISH reconciled via a subsequent
  PUBLISH call), proven directly by a dedicated adversarial test. A new
  `ChannelPublicationAttempt.operationId` column (same migration)
  freezes which operation each historical attempt belonged to, for
  reconciliation/audit and so tests can observe the key's components
  directly without a spy provider. No new inventory/catalog table or
  read/write path - purely a Channel-domain identity concern, proven by
  a dedicated test that InventoryBalance is unchanged across a full
  retry/resync sequence. 9 new adversarial tests
  (`test/integration/channels.test.ts`, now 42 total) covering:
  publish/unpublish identity separation (including the operationId-
  reuse-across-actions edge case), retry-preserves-identity for both
  publish and unpublish, resync-and-retry-after-FAILED both mint a new
  identity, a stale `PROCESSING` claim reclaimed inline preserves the
  crashed attempt's own identity, concurrent publish requests still
  converge to exactly one dispatch under the new identity scheme, and
  the read-only-inventory guarantee. See
  `specs/25-social-channel-publishing.md`'s own repair addendum and
  `acceptance/m26-social-channel-publishing.md` for the corrected
  Definition of Done.

---

## SEO — SEO

#### SEO-001 — URL structure/canonicalization strategy · **P2**
- **Question:** URL structure and redirect handling?
- **Dependencies:** SF-002
- **Status:** DECIDED (engineering default) · **Decision date:** 2026-09-22
- **Final decision:** Standard SEO-friendly structure (`/category/product-slug`), canonical URLs, 301 redirects for discontinued/unpublished products. Finalized as an engineering convention at M27 implementation time.
- **Affected specs:** `specs/26-seo.md`
- **M27 implementation note (2026-09-28):** canonical URLs are
  implemented (`alternates.canonical` on the PDP, one per style ID -
  this codebase has no query-param PDP variants, so no further
  de-duplication logic was needed). The 301-redirect half of this
  decision was investigated and found to conflict with an already-
  decided M11 invariant: `PdpService.getProductDetail`'s own docblock
  states the public read path "must never let a draft product's
  existence be distinguished from a genuinely unknown one." A 301 to a
  category page requires exactly that distinguishing existence check
  (is this ID a real-but-unpublished style, vs a genuinely unknown
  one?) - building it would silently reverse that already-decided
  invariant, which this milestone has no authorization to do, and this
  codebase also has no category browsing page to redirect to yet. Per
  `acceptance/m27-seo.md`'s own explicit "either 301s... or returns a
  proper 404" wording, the second branch was implemented: an
  unpublished/discontinued PDP returns a genuine 404, proven identical
  to a truly-unknown ID's 404 (`test/e2e-storefront/seo.spec.ts`). A
  real category page and any relaxation of the no-existence-leak
  invariant remain open items for a future, separately-authorized pass
  - not decided or guessed here.
- **M29 final-validation fix (2026-09-28):** the full-suite E2E
  validation run for the M26-M29 phase (not the original M27 build)
  caught a genuine freshness bug in `apps/storefront/src/app/
  sitemap.ts`: Next.js's own route-level ISR (the metadata route was
  statically generated at build time with an implicit revalidate
  window) meant `sitemap.xml` could silently serve its BUILD-TIME
  snapshot - omitting any product published after that build - for up
  to the whole window, directly contradicting "kept current with
  publish state." Fixed with `export const revalidate = 0` on the
  route plus a dedicated `cache: 'no-store'` fetch in
  `getAllPublicStylesForSitemap` (`apps/storefront/src/lib/api.ts`),
  independent of the shared `apiGet` cache other pages correctly keep
  for performance. Reproduced against a real production build/start
  before the fix (empty product list until the ISR window elapsed) and
  confirmed fixed after it (always current), across five full E2E
  suite runs.

---

## ANL — Analytics / Reporting

#### ANL-001 — Build vs. integrate analytics/BI & launch KPI list · **P2**
- **Question:** Native or third-party BI? Which KPIs?
- **Dependencies:** none
- **Status:** DECIDED · **Decision date:** 2026-09-22
- **Final decision:** Required analytics are now explicit and extensive (§27): sales, orders, returns, refunds, inventory, customer metrics, margin, profitability; fashion-specific (style/colour/size performance, stock ageing, sell-through, availability, return reasons, size-related returns); procurement (supplier fill rate, short/excess/damaged receipts, lead time, purchase vs. sales, supplier performance). Build-vs-integrate: build native event/data foundations first (so these are producible reliably), evaluate a BI/dashboard layer for presentation later — an engineering default, not blocking.
- **Affected specs:** `specs/27-analytics-reporting.md`
- **M28 implementation note (2026-09-28):** built the native event/data
  foundation half of this decision only, as scoped -
  `AnalyticsService` (`services/commerce-api/src/modules/analytics/`)
  exposes three staff-gated read routes
  (`GET /analytics/{commerce,fashion,procurement}`) computing every
  required KPI directly from the EXISTING ledger models - zero new
  tables, zero shadow balance tracking. Margin/profitability reconciles
  real `PurchaseOrderLine.unitCost` against real
  `OrderLine.taxableValueSnapshot`; net sales correctly subtracts
  completed refunds from gross sales and excludes cancelled orders
  entirely, so nothing is double-counted. Return reasons are grouped by
  the real free-text `ReturnLine.reason` (no structured reason-category
  field exists in this codebase); "size-related" is a documented
  keyword heuristic over that same text, not a fabricated taxonomy. A
  BI/dashboard presentation layer remains the explicitly deferred,
  separate evaluation this decision always described - not built here.
  9 adversarial integration tests, one per required category plus the
  negative net-sales-reconciliation scenario and staff RBAC.
- **Independent-review certification repair (2026-09-29), Blockers 2 and
  2B - fashion sell-through/availability correctness:** **Blocker 2:**
  `getFashionReport`'s dimensional-metadata lookup (`skuById`) was
  resolved from ONLY the SKUs appearing in `soldLines`, then reused
  against the FULL SKU universe (sold SKUs union inventory-balance
  SKUs) when attributing sell-through to a style. A SKU carrying real
  on-hand stock that had never sold had no entry in `skuById` and was
  silently `continue`d past, dropping its on-hand contribution from the
  style-level sell-through denominator entirely (e.g. a style with one
  sold-out SKU and one never-sold, fully-stocked SKU reported 100%
  sell-through instead of the true blended rate). Fixed by resolving
  `balances` (the inventory half of the SKU universe) FIRST, computing
  the complete `allSkuIds` union, then loading dimensional metadata for
  THAT set - still the exact same single `InventoryBalance.groupBy`
  query this method always used, no shadow analytics inventory model.
  **Blocker 2B:** `availability.inStockSkus` counted raw `onHand > 0`,
  while customer-facing/channel availability everywhere else in this
  codebase (PDP, M26 Channel Publishing) uses the canonical sellable
  formula `onHand - reserved` via `InventoryService.
  getAvailableToSellBySku`. A SKU with real onHand but fully consumed
  by reservations was wrongly counted as "available" even though zero
  units are actually purchasable right now. Fixed by switching ONLY the
  `availability` metric to the canonical sellable formula (now
  `AnalyticsService` also depends on `InventoryService`, the same
  dependency M26's own repair already established); `sellThrough`
  deliberately keeps using raw accounting `onHand` unchanged, since it
  is a stock-turnover metric, not a "can a customer buy this" metric -
  proven by a dedicated regression test asserting both figures
  simultaneously on the same fully-reserved SKU. 4 new adversarial
  tests (`test/integration/analytics.test.ts`, now 13 total): the
  exact inventory-only-SKU sell-through regression scenario from the
  review, a fully-reserved SKU excluded from availability, cross-
  location sellable aggregation, and the sellThrough-vs-availability
  independence proof. No accounting/onHand figures were altered.

---

## ADM — Admin / Operating Roles

#### ADM-001 — Final RBAC role list & permission matrix · **P0**
- **Question:** What is the complete role list and permission matrix?
- **Dependencies:** AUTH-002
- **Status:** DECIDED (engineering-authored per explicit Product Owner delegation) · **Decision date:** 2026-09-22
- **Final decision:** The Product Owner explicitly delegated this ("Finalize a sensible RBAC model based on these operating responsibilities," §25). Adopted role set: **Super Admin, Business Admin, Buying, Merchandising, Catalog, Warehouse Manager, Warehouse Operator, Customer Service, Marketing, Finance, Analytics** — see `blueprint/OPERATING_ROLES.md` and `specs/28-admin.md` for the full permission matrix and sensitive-action approval gates (large/exceptional discounts, manual inventory adjustments, exceptional refunds, high-risk financial actions, role/permission changes all require elevated authorization, per §25/§26).
- **Affected specs:** `specs/01-auth-rbac.md`, `specs/28-admin.md`
- **M29 implementation note (2026-09-28):** re-audited the full role/permission matrix against every existing permission-gated route (`packages/db/prisma/seed.ts`) — no gaps found; the matrix was already complete and correct from M01 onward. FLOW 19 (`acceptance/e2e-commerce-flows.md`) proves three specific role/action rejections server-side and, as this milestone's own genuine finding, closed a real gap: denied attempts were not being logged. `requirePermission` (`services/commerce-api/src/plugins/auth.ts`) now records an `authz.denied` audit row on every 403 across the entire application, not just the three FLOW 19 cases.

#### ADM-002 — Separate admin app vs. shared app with role-gated routes · **P1**
- **Question:** Separate app or shared codebase?
- **Dependencies:** SF-001
- **Status:** DECIDED (engineering default) · **Decision date:** 2026-09-22
- **Final decision:** One admin application (separate from the customer storefront app) with role-gated routes internally — not a fully separate deployment/tech stack per role.
- **Affected specs:** `specs/28-admin.md`
- **M29 implementation note (2026-09-28):** built `apps/admin` (Next.js, mirroring `apps/storefront`'s own conventions), a genuinely separate application from the customer storefront, on its own port (3001). Role-gating is client-side navigation filtering by the staff session's own permission list (`GET /auth/staff/me`) for UX only — the actual authorization boundary is server-side on every route, exactly as FLOW 19 requires; the admin app's own screens never assume a hidden nav item is a security control. Covers CMS (all four content types), manual inventory adjustment, internal Customer 360 lookup, channel-publishing management, and analytics — deliberately minimal, not a full screen for every staff-only action in the system (PO approval and refund issuance remain API-only, an honest scope boundary — see `acceptance/m29-admin-cms.md`).

#### ADM-003 — Manual inventory adjustment authorization workflow · **P1**
- **Question:** Who can adjust stock, and what's required?
- **Dependencies:** INV-007, AUD-001
- **Status:** DECIDED · **Decision date:** 2026-09-22
- **Final decision:** **Manual inventory adjustments require appropriate authorization** (explicit, §26/§36) — restricted to Warehouse Manager and above (Finance co-approval for high-value adjustments), mandatory justification field, fully audited (who/what/when/old-value/new-value/reference).
- **Affected specs:** `specs/28-admin.md`, `specs/06-inventory.md`
- **M29 implementation note (2026-09-28):** this workflow was already fully built (pre-M29, ADM-003). This milestone re-verified it end to end with a dedicated FLOW 20 test matrix (`test/integration/flow20-inventory-adjustment-audited.test.ts`, `test/e2e-admin/flow19-20.spec.ts`) rather than assuming prior coverage was sufficient — below-threshold completion, above-threshold rejection-then-completion with a valid co-approver, missing-justification rejection, an invalid co-approver, and self-co-approval rejection, all proven both at the API layer and through the real `apps/admin` inventory-adjustment screen.

---

## NOTIF — Notifications

#### NOTIF-001 — Notification channels & build-vs-integrate for launch · **P2**
- **Question:** Which channels, native or integrated?
- **Dependencies:** none
- **Status:** DECIDED · **Decision date:** 2026-09-22
- **Final decision:** **Architecture MUST support SMS, WhatsApp, Email, and Push** via provider abstraction — order logic must not couple directly to one messaging provider (explicit, §15). Actual providers/configuration are selected later, deferred to operational decision.
- **Affected specs:** `specs/29-notifications.md`
- **M29 implementation note (2026-09-28):** `NotificationService` (`services/commerce-api/src/modules/notifications`) REUSES the existing `MarketingProvider` interface verbatim (M25) rather than inventing a second provider abstraction — the send contract is identical, and this milestone's own scope is SMS only (the platform's baseline channel, every customer has a mandatory verified mobile number); WhatsApp/Email/Push activation for notifications remains deferred, same as M25's own honest scope boundary. Reuses the existing `CommunicationPreference` opt-in matrix (M22, CUST-002) rather than a second consent model. Duplicate-send prevention follows the exact durable-claim-before-provider-call idiom M25's Blocker 4 repair established: `NotificationDelivery`'s own `@@unique([event, referenceId, channel])` constraint, proven under genuine `Promise.all` concurrency. Wired from six real, already-committed state-change call sites (order confirmation — both COD and prepaid/webhook paths, shipment dispatch, exchange completion, return receipt, refund completion, loyalty vesting); `ORDER_DELIVERED`/`ORDER_CANCELLED` are defined in the vocabulary but not yet wired to a call site — documented as an open scope boundary in `acceptance/m29-admin-cms.md`, not silently left unstated.

---

## AUD — Audit / Compliance

#### AUD-001 — Audit log access control & retention period · **P1**
- **Question:** Who can access audit logs, and for how long?
- **Dependencies:** ADM-001
- **Status:** DECIDED · **Decision date:** 2026-09-22
- **Final decision:** **Full auditability is required** for inventory, pricing, orders, refunds, store credit, loyalty, promotions, permissions, and product publishing (explicit, §26) — recording who/what/when/old value/new value/reference. Access restricted to Super Admin, Business Admin, and Finance by default (extendable per `ADM-001`'s matrix). Exact retention period ties to `AUD-002`'s legal verification.
- **Affected specs:** `specs/30-audit-compliance.md`

#### AUD-002 — Regulatory/compliance requirement identification · **P1**
- **Question:** What regulations apply?
- **Dependencies:** none
- **Status:** **UNDER_REVIEW** · **Decision date:** —
- **Final decision:** Not resolved by Product Owner business instruction — explicitly flagged as requiring legal verification, not invented conclusions (§28). Routed to external legal review; does not block M00/M01.
- **Affected specs:** `specs/30-audit-compliance.md`

---

## TAX — India Tax / GST

**Now owned by `specs/32-india-tax-invoicing.md`** (created in this
update — see §28 of the Product Owner instruction, which required this
spec at minimum).

#### TAX-001 — GST registration/multi-state model & computation approach · **P0**
- **Question:** GST registration model, CGST/SGST vs. IGST determination?
- **Dependencies:** ORG-001, ORG-002
- **Status:** **UNDER_REVIEW** · **Decision date:** —
- **Final decision:** **COMPLIANCE/LEGAL QUESTION REQUIRING VERIFICATION** — not resolved by this instruction, and explicitly must not be resolved by invented legal conclusions (§28). The **engineering approach is decided** (see `CHK-002`): a configurable, parameterized tax-computation engine that can apply whatever registration model/rate logic is legally confirmed, without an architecture change. Does not block M00/M01; blocks the tax-computation-correctness portion of M13/M08.
- **Affected specs:** `specs/32-india-tax-invoicing.md`

#### TAX-002 — MRP vs. selling-price display & inclusive/exclusive presentation · **P0**
- **Question:** MRP disclosure requirements?
- **Dependencies:** CAT-001
- **Status:** **UNDER_REVIEW** · **Decision date:** —
- **Final decision:** **COMPLIANCE/LEGAL QUESTION REQUIRING VERIFICATION** (Legal Metrology Act implications). The **business display decision is made** (`CAT-001`: MRP + tax-inclusive display, matching stated market norm); the specific legal disclosure/labeling mechanics still need verification.
- **Affected specs:** `specs/32-india-tax-invoicing.md`, `specs/02-product-master.md`

#### TAX-003 — HSN code assignment · **P0**
- **Question:** Is HSN required, and at what level?
- **Dependencies:** PROD-001
- **Status:** **UNDER_REVIEW** · **Decision date:** —
- **Final decision:** **COMPLIANCE/LEGAL QUESTION REQUIRING VERIFICATION** (turnover-threshold-dependent under Indian GST rules). **Engineering readiness decided:** an HSN field exists on the product/category schema now (nullable/configurable), so the verified rule can be applied without a schema change.
- **Affected specs:** `specs/32-india-tax-invoicing.md`, `specs/02-product-master.md`

#### TAX-004 — GST-compliant invoice generation · **P0**
- **Question:** Invoice format and generation trigger point?
- **Dependencies:** TAX-001, ORD-001
- **Status:** **UNDER_REVIEW** · **Decision date:** —
- **Final decision:** **COMPLIANCE/LEGAL QUESTION REQUIRING VERIFICATION.** **Engineering readiness decided:** invoicing capability is required and built with a versioned, configurable template and configurable numbering sequence at order confirmation, so the legally-verified format can be applied without a redesign once confirmed.
- **Affected specs:** `specs/32-india-tax-invoicing.md`, `specs/14-order-management.md`

#### TAX-005 — Credit note generation for returns/refunds/cancellations · **P0**
- **Question:** Credit note requirements?
- **Dependencies:** TAX-004, REF-001
- **Status:** **UNDER_REVIEW** · **Decision date:** —
- **Final decision:** **COMPLIANCE/LEGAL QUESTION REQUIRING VERIFICATION**, same treatment as `TAX-004` applied to the reverse flow (return/refund/cancellation).
- **Affected specs:** `specs/32-india-tax-invoicing.md`, `specs/19-refunds.md`, `specs/17-cancellation.md`

#### TAX-006 — Discount presentation on invoice · **P1**
- **Question:** Pre-tax or post-tax discount application?
- **Dependencies:** TAX-004, PROMO-001
- **Status:** DECIDED (engineering default; subject to TAX-001 verification) · **Decision date:** 2026-09-22
- **Final decision:** Pre-tax discount application by default (common practice), implemented as a configurable computation flag so it can be switched if legal verification under `TAX-001` indicates otherwise.
- **Affected specs:** `specs/32-india-tax-invoicing.md`, `specs/23-promotions.md`
- **M24 implementation note (2026-09-27):** `PROMOTIONS_DISCOUNT_PRETAX` (default `true`) gates `CheckoutService.priceLines`. When enabled, the resolved discount total is allocated pro-rata across lines by each line's undiscounted share (rounding remainder assigned to the last line for exact-sum guarantee), and each line's taxable value is reduced by its share **before** calling the pre-existing, unmodified `splitTax` function — `TAX-006`'s "without rewriting tax logic" requirement is satisfied by never touching `splitTax` itself, only its input. `unitPriceInclusive` is preserved unchanged for invoice presentation; a new `discountAmountSnapshot` field records each line's own discount share separately, copied onto `OrderLine` at order creation so the invoice can always independently reconstruct pre-discount vs. post-discount taxable value. Proven exact (no rounding drift across lines) in `test/integration/promotions.test.ts` test #11. Still subject to `TAX-001` legal verification, per this decision's own caveat.

---

## IND — Other India-specific commerce

#### IND-001 — COD availability rules & reconciliation process · **P0**
- **Question:** COD restrictions, and reconciliation?
- **Dependencies:** SHIP-001, REF-001
- **Status:** DECIDED · **Decision date:** 2026-09-22
- **Final decision:** **COD is required** (explicit, §13). Availability rules (value cap, excluded PIN codes) are configurable business parameters. Reconciliation of cash collected by the delivery partner against platform records is a required operational process, built on the same ledger/audit discipline as everything else (`AUD-001`). Per `INV-002`, **COD orders commit/reserve inventory at successful order acceptance**, not at a later point.
- **Affected specs:** `specs/13-payment.md`, `specs/32-india-tax-invoicing.md`

#### IND-002 — PIN-code serviceability check · **P0**
- **Question:** Data source, and check point?
- **Dependencies:** SHIP-001
- **Status:** DECIDED · **Decision date:** 2026-09-22
- **Final decision:** **Required** (explicit, §12) — see `CHK-004`. Data source: carrier API where available (via the `SHIP-002` abstraction), with a static/periodically-updated list as fallback (engineering default). Checked at PDP and re-validated at checkout.
- **Affected specs:** `specs/12-checkout.md`, `specs/10-pdp.md`

#### IND-003 — Indian address structure · **P1**
- **Question:** Address fields and auto-complete?
- **Dependencies:** IND-002
- **Status:** DECIDED (engineering default) · **Decision date:** 2026-09-22
- **Final decision:** Standard Indian address field set (house/flat, locality, landmark, city, state, PIN code); PIN-to-city/state auto-complete included where feasible.
- **Affected specs:** `specs/12-checkout.md`, `specs/21-customer-profile.md`

#### IND-004 — UPI/net-banking/wallet support at launch · **P1**
- **Question:** Which rails beyond cards?
- **Dependencies:** PAY-001
- **Status:** DECIDED · **Decision date:** 2026-09-22
- **Final decision:** **Required payment capabilities include UPI, cards, net banking, and other appropriate Razorpay-supported rails where configured** (explicit, §13), in addition to COD.
- **Affected specs:** `specs/13-payment.md`

#### IND-005 — Free-shipping threshold & shipping charge policy · **P2**
- **Question:** Is there a free-shipping threshold?
- **Dependencies:** CHK-003
- **Status:** DECIDED (configurable) · **Decision date:** 2026-09-22
- **Final decision:** Supported as a configurable business parameter; exact threshold and below-threshold charge are business configuration, not a build blocker.
- **Affected specs:** `specs/12-checkout.md`

---

## NFR — Non-functional requirements

Initial engineering-default targets below (informed by the given
operating scale: **10,000–50,000 SKUs, 1,000–10,000 orders/day
supportable without fundamental redesign**, §2). All are revisable
after real load testing at M32 — none block M00/M01.

#### NFR-001 — Performance targets · **P1**
- **Status:** DECIDED (engineering default) · **Decision date:** 2026-09-22
- **Final decision:** Initial targets: PDP LCP < 2.5s on a representative 4G mobile profile; checkout/payment API p95 < 500ms; search response < 300ms. Revised after M32 load testing.
- **M32 implementation note (2026-09-29):** all three targets measured
  for the first time against a real 16,000-SKU perf-seeded catalog and
  a real Meilisearch instance — every target CONFIRMED (PDP/Home LCP
  2.1s/2.2s; checkout preview p95 38ms; search p97.5 64ms), none
  revised. See `performance/HOT_PATH_BENCHMARKS.md` for full method and
  the honest single-container-sandbox scope caveat;
  `PRODUCTION_VERIFICATION_REQUIRED` remains correct for a genuine
  production-topology measurement.
- **Affected specs:** `TESTING.md`, `specs/08-storefront.md`

#### NFR-002 — Availability/uptime target · **P1**
- **Status:** DECIDED (engineering default) · **Decision date:** 2026-09-22
- **Final decision:** Storefront target 99.9%; admin target 99.5% (tolerates more maintenance-window flexibility). Revisable.
- **Affected specs:** `DEPLOYMENT.md`

#### NFR-003 — Data retention & backup/restore/DR targets · **P1**
- **Status:** DECIDED (engineering default) · **Decision date:** 2026-09-22
- **Final decision:** Daily backups; RPO ≤ 24h; RTO ≤ 4h at current scale. Compliance-driven data-category-specific retention periods still depend on `AUD-002`.
- **Affected specs:** `DEPLOYMENT.md`, `SECURITY.md`

#### NFR-004 — Accessibility conformance level · **P2**
- **Status:** DECIDED (engineering default) · **Decision date:** 2026-09-22
- **Final decision:** WCAG 2.1 AA target for the storefront.
- **Affected specs:** `specs/08-storefront.md`

#### NFR-005 — Browser/device support matrix · **P2**
- **Status:** DECIDED (engineering default) · **Decision date:** 2026-09-22
- **Final decision:** Last 2 versions of Chrome, Safari, Firefox, Edge; current iOS Safari and Android Chrome for mobile.
- **Affected specs:** `specs/08-storefront.md`

#### NFR-006 — Rate limiting / API reliability targets · **P2**
- **Status:** DECIDED (engineering default) · **Decision date:** 2026-09-22
- **Final decision:** Standard per-IP/per-session rate limits on public storefront APIs; exact figures tuned during M32 load testing.
- **Affected specs:** `SECURITY.md`

---

## SEC — Pre-Production Security & Privacy Gate

**Status as of 2026-09-24 (M16 build):** this section exists because the
M16 build instruction made security/privacy a **binding, cross-cutting
acceptance requirement from M16 onward**, not something bolted on at
launch, and required the roadmap to explicitly track a consolidated
pre-production gate covering every area below. This is a **tracking
record, not a completed security program** - almost everything below is
`UNDER_REVIEW`/`EXTERNAL_VERIFICATION_REQUIRED`, deliberately: engineering
has applied per-feature security discipline throughout Phase 1/2/M16
(server-side authorization on every route, parameterized queries via
Prisma everywhere, webhook signature verification, idempotency/replay
protection on every payment/inventory/pick mutation, audit logging, no
raw card storage, clean input validation), but a **holistic external
security/privacy review has not been performed**, and this agent does
**not** claim `DPDP_COMPLIANT`, `CERT-IN_COMPLIANT`, or `PCI_COMPLIANT` -
those require qualified external verification no engineering agent may
self-certify.

#### SEC-001 — Pre-production security & privacy program · **P0**
- **Question:** What must be independently verified/completed before this
  platform is production-ready from a security and privacy standpoint?
- **Dependencies:** CART-004, CUST-001, AUD-002, TAX-001–005 (all already
  tracked above - this entry does not duplicate them, it indexes them
  alongside the areas below that have no existing entry yet)
- **Status:** `UNDER_REVIEW` / `EXTERNAL_VERIFICATION_REQUIRED` ·
  **Identified:** 2026-09-24 (M16 build instruction, binding from M16
  onward)
- **Authentication / account security:** OTP brute-force protection
  beyond the existing per-code `maxAttempts`/expiry (M01) - rate limiting
  across OTP *requests*, not just verify attempts; credential/account
  enumeration resistance (login/OTP error messages already avoid
  confirming account existence - not independently pen-tested); staff
  session security is implemented (Redis-backed, revoked on deactivation,
  M01) but staff/admin **MFA is enforced only for `MFA_REQUIRED_ROLES`**
  (`SUPER_ADMIN`/`BUSINESS_ADMIN`/`FINANCE`) - extending to all
  privileged roles before production is a policy decision, not yet made;
  privileged-session controls (step-up auth for high-risk actions) not
  built.
- **Application / API security:** no formal OWASP web/API Top-10 threat
  review has been performed end to end (per-feature IDOR/BOLA tests exist
  for order/payment/warehouse/cart resources - see `warehouse.test.ts`'s
  own IDOR/BOLA describe block for M16's own contribution - but this is
  not the same as a systematic review); injection defense relies on
  Prisma's parameterized queries throughout (no raw string-concatenated
  SQL exists in this codebase) but has not been independently verified;
  no storefront user-generated HTML rendering exists yet so XSS surface
  is currently small, unreviewed; CSRF is not applicable to this
  bearer-token API design but that assumption is unverified; SSRF surface
  (webhook/URL-accepting endpoints) not reviewed; no file-upload endpoint
  exists yet; security headers/CSP are not yet configured at the
  reverse-proxy/CDN layer (out of this repo's scope until that
  infrastructure exists); rate limiting exists only as an `NFR-006`
  engineering-default target, not yet implemented/tuned.
- **Bot / scraper / abuse protection:** no CDN/WAF, DDoS protection, or
  bot-management layer is provisioned (infrastructure decision, outside
  application code); no scraping/catalog-enumeration throttling; OTP
  abuse controls are limited to per-code attempt/expiry limits (no
  per-mobile-number or per-IP request-rate cap yet); checkout-abuse and
  inventory-hoarding/reservation-abuse controls rely on the existing
  reservation TTL (`INVENTORY_RESERVATION_TTL_SECONDS`) and per-SKU cart
  quantity cap (`CART_MAX_QUANTITY_PER_SKU`) - no dedicated anti-abuse
  layer beyond those.
- **Customer data:** data classification has not been formally documented
  (see `AUD-002`); TLS/encryption-in-transit is an infrastructure/deploy
  concern outside this repo; encryption-at-rest depends on the production
  database provider's configuration (not yet chosen); PII minimization is
  applied per-feature (e.g. `PickTask` deliberately carries zero customer
  PII - see the M16 final report's own explicit accounting) but not
  formally audited platform-wide; secrets management today is
  environment-variable-based (`.env`, never committed - `SECURITY.md`)
  with no vault/rotation system yet; production access controls, backup
  security, and deletion/retention architecture all depend on `CUST-001`.
- **Payment security:** webhook authentication (HMAC-SHA256 signature
  verification, `timingSafeEqual`), replay/idempotency protection
  (`PaymentEvent` uniqueness + durable processing-state recovery, M14),
  provider-boundary secret isolation, and "never store raw card data" are
  all already implemented and adversarially tested (`payment.test.ts`).
  Reconciliation tooling (`CAPTURE_RECONCILIATION_REQUIRED` state, M14
  finding #3) exists for the capture/expiry race; broader payment-ops
  reconciliation dashboards are not built.
- **Software supply chain:** `npm audit` is run ad hoc, not wired into CI
  as a blocking gate; no dependency-scanning/SAST/secret-scanning/SBOM
  tooling is configured in `.github/workflows/ci.yml`; no formal
  patch/update cadence is documented.
- **Operations:** no security monitoring/alerting, suspicious-activity
  detection, incident-response runbook, or breach-response process exists
  yet; audit-log protection (append-only at the application layer via
  `recordAudit` - no separate row ever mutates a prior entry) exists, but
  database-level immutability (e.g. a trigger preventing `UPDATE`/`DELETE`
  on `audit_logs`) is not enforced; backup/restore verification is an
  infrastructure/deploy-time concern (`NFR-003`), not yet exercised.
- **Privacy / India (DPDP):** `CUST-001` (data retention/deletion) and
  `AUD-002` (applicable regulatory requirements) remain `UNDER_REVIEW` -
  no statutory retention period has been guessed or hard-coded anywhere
  in this codebase. No privacy notice, data inventory, purpose-mapping
  document, consent-collection workflow, data-subject-rights (access/
  correction/erasure/withdrawal) workflow, grievance-officer process, or
  processor/vendor inventory exists yet. CERT-In incident-reporting
  readiness has not been assessed. None of `DPDP_COMPLIANT`,
  `CERT-IN_COMPLIANT`, or `PCI_COMPLIANT` may be claimed until a
  qualified external reviewer confirms each.
- **Affected specs:** cross-cutting - `SECURITY.md`,
  `specs/01-auth-rbac.md`, `specs/21-customer-profile.md`,
  `specs/30-audit-compliance.md`, and every milestone spec touching
  customer or payment data.
