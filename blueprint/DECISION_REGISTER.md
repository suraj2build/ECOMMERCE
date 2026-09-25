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

#### LOY-002 — Earn rate rules · **P0**
- **Question:** How are points earned?
- **Dependencies:** LOY-001
- **Status:** DECIDED (rate configurable) · **Decision date:** 2026-09-22
- **Final decision:** **Points are earned based on qualifying purchase value** (explicit, §20). The exact earning rate is an intentionally **configurable business parameter — no fixed commercial percentage is invented here** (explicit instruction, §20).
- **Affected specs:** `specs/22-loyalty.md`

#### LOY-003 — Redemption mechanics & minimum redemption · **P0**
- **Question:** How do points convert to discount?
- **Dependencies:** LOY-001
- **Status:** DECIDED (mechanics configurable) · **Decision date:** 2026-09-22
- **Final decision:** **Points may be redeemed on future purchases** (explicit, §20). Exact conversion rate, minimum redemption, and maximum redemption cap per order are configurable business parameters, not invented here.
- **Affected specs:** `specs/22-loyalty.md`

#### LOY-004 — Expiry policy · **P1**
- **Question:** Do points expire?
- **Dependencies:** LOY-001
- **Status:** DECIDED · **Decision date:** 2026-09-22
- **Final decision:** **Points expire. The expiry period MUST be configurable** (explicit, §20). This explicitly **contrasts with store credit, which does NOT expire** (`REF-002`) — the two ledgers have different expiry semantics by design.
- **Affected specs:** `specs/22-loyalty.md`

#### LOY-005 — Loyalty + promotion stacking · **P1**
- **Question:** Can loyalty redemption combine with promotions?
- **Dependencies:** LOY-003, PROMO-002
- **Status:** DECIDED · **Decision date:** 2026-09-22
- **Final decision:** **Store credit may be used together with loyalty and coupon/promotions, subject to promotion/loyalty eligibility and stacking rules** (explicit, §19). Stacking compatibility **MUST be rule-driven/configurable**, mirroring `PROMO-002`.
- **Affected specs:** `specs/22-loyalty.md`, `specs/23-promotions.md`

---

## PROMO — Promotions

#### PROMO-001 — Supported promotion types for launch · **P1**
- **Question:** Which promotion types are required?
- **Dependencies:** CAT-001
- **Status:** DECIDED · **Decision date:** 2026-09-22
- **Final decision:** **Support BOTH coupon-code promotions AND automatic promotions** (explicit, §10). Required types: promotional coupons, campaign coupons, onboarding coupons, cashback-related benefits, and other **configurable** coupon types — the type system itself must be extensible, not a fixed enum.
- **Affected specs:** `specs/23-promotions.md`

#### PROMO-002 — Stacking/precedence rules · **P1**
- **Question:** Can multiple promotions apply?
- **Dependencies:** PROMO-001
- **Status:** DECIDED · **Decision date:** 2026-09-22
- **Final decision:** **One coupon may coexist with explicitly compatible automatic promotions** (explicit, §10). Compatibility/stacking **MUST be rule-driven/configurable** — do not hard-code every promotion combination.
- **Affected specs:** `specs/23-promotions.md`

---

## MKT — Marketing

#### MKT-001 — Marketing channels & build-vs-integrate for launch · **P2**
- **Question:** Which channels, and native or third-party?
- **Dependencies:** CUST-002
- **Status:** DECIDED (architecture); provider selection deferred · **Decision date:** 2026-09-22
- **Final decision:** Architecture supports SMS, WhatsApp, Email, and Push via a provider abstraction (explicit, §15, shared with `NOTIF-001`). Actual provider/channel activation at launch is configurable, deferred to operational decision — not a build blocker.
- **Affected specs:** `specs/24-marketing.md`

---

## CHAN — Channel Publishing

#### CHAN-001 — Which channels launch first · **P2**
- **Question:** Which marketplace/social channels launch first?
- **Dependencies:** none
- **Status:** DECIDED · **Decision date:** 2026-09-22
- **Final decision:** **None launch now.** Build the **adapter/contract publishing architecture** (core catalog must not embed marketplace-specific fields; use channel-specific mappings) so future integrations to Meta, Instagram, Facebook, Google Merchant, Amazon, Flipkart, Myntra, and Ajio are possible without redesign (explicit, §3, §24). **Actual marketplace integrations are explicitly deferred — not built without separate milestone authorization** (explicit, §3: "DO NOT build these marketplace integrations now unless their milestone is explicitly authorized").
- **Affected specs:** `specs/25-social-channel-publishing.md`

---

## SEO — SEO

#### SEO-001 — URL structure/canonicalization strategy · **P2**
- **Question:** URL structure and redirect handling?
- **Dependencies:** SF-002
- **Status:** DECIDED (engineering default) · **Decision date:** 2026-09-22
- **Final decision:** Standard SEO-friendly structure (`/category/product-slug`), canonical URLs, 301 redirects for discontinued/unpublished products. Finalized as an engineering convention at M27 implementation time.
- **Affected specs:** `specs/26-seo.md`

---

## ANL — Analytics / Reporting

#### ANL-001 — Build vs. integrate analytics/BI & launch KPI list · **P2**
- **Question:** Native or third-party BI? Which KPIs?
- **Dependencies:** none
- **Status:** DECIDED · **Decision date:** 2026-09-22
- **Final decision:** Required analytics are now explicit and extensive (§27): sales, orders, returns, refunds, inventory, customer metrics, margin, profitability; fashion-specific (style/colour/size performance, stock ageing, sell-through, availability, return reasons, size-related returns); procurement (supplier fill rate, short/excess/damaged receipts, lead time, purchase vs. sales, supplier performance). Build-vs-integrate: build native event/data foundations first (so these are producible reliably), evaluate a BI/dashboard layer for presentation later — an engineering default, not blocking.
- **Affected specs:** `specs/27-analytics-reporting.md`

---

## ADM — Admin / Operating Roles

#### ADM-001 — Final RBAC role list & permission matrix · **P0**
- **Question:** What is the complete role list and permission matrix?
- **Dependencies:** AUTH-002
- **Status:** DECIDED (engineering-authored per explicit Product Owner delegation) · **Decision date:** 2026-09-22
- **Final decision:** The Product Owner explicitly delegated this ("Finalize a sensible RBAC model based on these operating responsibilities," §25). Adopted role set: **Super Admin, Business Admin, Buying, Merchandising, Catalog, Warehouse Manager, Warehouse Operator, Customer Service, Marketing, Finance, Analytics** — see `blueprint/OPERATING_ROLES.md` and `specs/28-admin.md` for the full permission matrix and sensitive-action approval gates (large/exceptional discounts, manual inventory adjustments, exceptional refunds, high-risk financial actions, role/permission changes all require elevated authorization, per §25/§26).
- **Affected specs:** `specs/01-auth-rbac.md`, `specs/28-admin.md`

#### ADM-002 — Separate admin app vs. shared app with role-gated routes · **P1**
- **Question:** Separate app or shared codebase?
- **Dependencies:** SF-001
- **Status:** DECIDED (engineering default) · **Decision date:** 2026-09-22
- **Final decision:** One admin application (separate from the customer storefront app) with role-gated routes internally — not a fully separate deployment/tech stack per role.
- **Affected specs:** `specs/28-admin.md`

#### ADM-003 — Manual inventory adjustment authorization workflow · **P1**
- **Question:** Who can adjust stock, and what's required?
- **Dependencies:** INV-007, AUD-001
- **Status:** DECIDED · **Decision date:** 2026-09-22
- **Final decision:** **Manual inventory adjustments require appropriate authorization** (explicit, §26/§36) — restricted to Warehouse Manager and above (Finance co-approval for high-value adjustments), mandatory justification field, fully audited (who/what/when/old-value/new-value/reference).
- **Affected specs:** `specs/28-admin.md`, `specs/06-inventory.md`

---

## NOTIF — Notifications

#### NOTIF-001 — Notification channels & build-vs-integrate for launch · **P2**
- **Question:** Which channels, native or integrated?
- **Dependencies:** none
- **Status:** DECIDED · **Decision date:** 2026-09-22
- **Final decision:** **Architecture MUST support SMS, WhatsApp, Email, and Push** via provider abstraction — order logic must not couple directly to one messaging provider (explicit, §15). Actual providers/configuration are selected later, deferred to operational decision.
- **Affected specs:** `specs/29-notifications.md`

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
