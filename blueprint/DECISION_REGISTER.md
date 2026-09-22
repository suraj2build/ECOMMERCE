# Decision Register

**Status:** This register is a working tool for Product Blueprint V2. It
does not itself decide anything. Every entry's `Status` is `OPEN` unless
noted; **no entry in this register may be marked `DECIDED` by an
engineering agent** — only the human Product Owner (optionally advised by
ChatGPT as Product Architect, per `AGENTS.md`) may do that, and doing so
must be accompanied by updating the referenced spec(s) in `/specs`.

See `OPEN_QUESTIONS.md` for the prioritized, human-facing questionnaire
built from this register. See `READINESS.md` for how these decisions gate
each domain's build-readiness.

## How to use this register

- Every decision has a stable **ID** (`DOMAIN-NNN`) that will never be
  reused or renumbered, even if the decision is later superseded.
- **Priority** (P0/P1/P2) reflects how blocking the decision is —
  see `OPEN_QUESTIONS.md` §"Priority definitions" for the exact criteria.
- When a decision is made, update its `Status`, `Final decision`, and
  `Decision date` fields here, then propagate the decision into the
  `Affected specs` (updating their status and content as appropriate —
  see `CLAUDE.md` §3–4 for the spec status lifecycle).
- `Status` values: `OPEN` (not yet decided) · `UNDER_REVIEW` (Product
  Owner actively considering) · `DECIDED` (final) · `SUPERSEDED`
  (replaced by a later decision — link the new ID).

## Domain index

| Prefix | Domain | Count |
|---|---|---|
| AUTH | Authentication / RBAC | 3 |
| ORG | Organization / business entity model | 2 |
| PROD | Product Master | 6 |
| SUP | Suppliers | 2 |
| PO | Purchase Orders | 3 |
| GRN | Goods Receipt / QC | 3 |
| INV | Inventory | 7 |
| CAT | Catalog / Merchandising / Pricing | 4 |
| SF | Storefront | 2 |
| SRCH | Search / Discovery | 2 |
| PDP | Product Detail Page | 2 |
| CART | Wishlist / Cart | 3 |
| CHK | Checkout | 4 |
| PAY | Payment | 6 |
| ORD | Order Management | 6 |
| WH | Warehouse / Fulfilment | 2 |
| SHIP | Shipping / Tracking | 4 |
| CAN | Cancellation | 3 |
| RET | Returns | 4 |
| REF | Refunds | 4 |
| EXC | Exchanges | 3 |
| CUST | Customer 360 | 3 |
| LOY | Loyalty | 5 |
| PROMO | Promotions | 2 |
| MKT | Marketing | 1 |
| CHAN | Channel Publishing | 1 |
| SEO | SEO | 1 |
| ANL | Analytics / Reporting | 1 |
| ADM | Admin / Operating Roles | 3 |
| NOTIF | Notifications | 1 |
| AUD | Audit / Compliance | 2 |
| TAX | India Tax / GST (new domain — no existing spec) | 6 |
| IND | Other India-specific commerce | 5 |
| NFR | Non-functional requirements | 6 |
| **Total** | | **112** |

**P0: 39 · P1: 49 · P2: 24** — see `OPEN_QUESTIONS.md` for the
prioritized questionnaire built from this list.

**Note on ORG/INV overlap:** `ORG-002` and `INV-004` describe the same
underlying decision (single- vs. multi-location at launch) from two
angles (business/org model vs. inventory ledger design). They are kept
as two entries because they affect different specs, but they **must be
decided together** — see cross-references in both entries.

---

## AUTH — Authentication / RBAC

#### AUTH-001 — Customer authentication method(s) · **P0**
- **Question:** Which authentication method(s) must the storefront support at launch — password, mobile OTP, email OTP, social login, or a combination?
- **Why it matters:** Determines the identity schema, session design, and support burden; materially shapes conversion for an India-first, mobile-heavy audience.
- **Dependencies:** IND-001, CUST-001
- **Recommended options:** (a) Mobile OTP only; (b) Mobile OTP + password fallback; (c) Mobile OTP + email + social login.
- **Trade-offs:** OTP-only is fast and India-idiomatic but fails for unreliable SMS delivery or shared/changed numbers; broader methods add build and support cost.
- **Status:** OPEN · **Final decision:** — · **Decision date:** —
- **Affected specs:** `specs/01-auth-rbac.md`

#### AUTH-002 — Staff/admin authentication & MFA requirement · **P0**
- **Question:** What authentication method(s) do internal/admin users use, and is multi-factor authentication (MFA) mandatory for any role?
- **Why it matters:** Admin accounts can touch inventory, pricing, refunds, and customer PII — the security posture here is a direct SECURITY.md concern, not just a UX one.
- **Dependencies:** ADM-001
- **Recommended options:** (a) Password + mandatory MFA for all staff; (b) Password + mandatory MFA only for high-risk roles (finance, super admin); (c) Password only, MFA optional.
- **Trade-offs:** Mandatory MFA is safer but adds onboarding friction for a possibly small internal team; role-scoped MFA balances risk vs. friction but requires the role model (ADM-001) to exist first.
- **Status:** OPEN · **Final decision:** — · **Decision date:** —
- **Affected specs:** `specs/01-auth-rbac.md`, `SECURITY.md`

#### AUTH-003 — Session/token strategy · **P1**
- **Question:** JWT vs. server-side session store (Redis-backed) for both customer and staff sessions?
- **Why it matters:** Affects scalability, logout/revocation semantics, and integration with Medusa v2's own auth model.
- **Dependencies:** none
- **Recommended options:** (a) Server-side session in Redis (simpler revocation); (b) JWT with short expiry + refresh token; (c) Defer to whatever Medusa v2 provides natively for its own admin/customer auth, layering a custom solution only for staff roles Medusa doesn't model.
- **Trade-offs:** Server sessions are easier to revoke instantly (important for staff offboarding) but add Redis as a hard dependency for auth; JWT scales better statelessly but revocation is harder.
- **Status:** OPEN · **Final decision:** — · **Decision date:** —
- **Affected specs:** `specs/01-auth-rbac.md`

---

## ORG — Organization / business entity model

**Audit note:** No existing spec owns this domain explicitly — it is a
gap discovered during this audit (see `README.md` §Audit Findings).
Decisions here should be recorded against `specs/00-platform-overview.md`
until/unless the Product Owner authorizes a dedicated spec.

#### ORG-001 — Single legal entity vs. multi-brand/multi-tenant model · **P0**
- **Question:** Does the platform operate as a single legal entity/single brand, or must it support multiple brands/legal entities (e.g., sub-brands, marketplace-style multi-seller) from day one?
- **Why it matters:** This is a foundational data-modeling decision — it affects product master, inventory, invoicing (TAX-004), and RBAC scoping. Retrofitting multi-tenancy later is expensive.
- **Dependencies:** TAX-001, PROD-001
- **Recommended options:** (a) Single entity, single brand — simplest, matches "independent fashion commerce platform" framing in PRODUCT.md; (b) Single entity, multiple internal sub-brands (shared inventory/ops, distinct storefront presentation); (c) Multi-entity/multi-tenant from day one.
- **Trade-offs:** (a) is fastest to build and matches the stated vision, but blocks future white-label/marketplace ambitions without a rework; (c) is heavy upfront cost with no stated current need.
- **Status:** OPEN · **Final decision:** — · **Decision date:** —
- **Affected specs:** `specs/00-platform-overview.md`, `PRODUCT.md`

#### ORG-002 — Warehouse/location model at launch · **P0**
- **Question:** Single warehouse/location, or multi-location from launch? (Same underlying decision as `INV-004`.)
- **Why it matters:** Determines whether the inventory ledger, order allocation, and fulfilment routing need location-awareness from day one.
- **Dependencies:** INV-004 (must be decided together), WH-001
- **Recommended options:** (a) Single warehouse at launch, location field reserved in the schema for future multi-location; (b) Multi-location from launch.
- **Trade-offs:** (a) is significantly simpler to build and test correctly (see `INVENTORY_INTEGRITY.md`) but requires a follow-up milestone to add location-aware allocation later; (b) is more future-proof but adds real complexity to every inventory and fulfilment flow before there is operational need.
- **Status:** OPEN · **Final decision:** — · **Decision date:** —
- **Affected specs:** `specs/06-inventory.md`, `specs/15-warehouse-fulfilment.md`, `specs/04-purchase-orders.md`

---

## PROD — Product Master

#### PROD-001 — Attribute taxonomy governance · **P0**
- **Question:** Who defines and extends the fashion attribute taxonomy (department, category, fabric, fit, etc.), and through what mechanism — admin UI, versioned config file, or both?
- **Why it matters:** This is the concrete design of the "extensible attribute system" architectural requirement (`ARCHITECTURE.md` §4). Getting the governance model wrong risks either an uncontrolled attribute sprawl or a system that's extensible in theory but not in practice.
- **Dependencies:** ORG-001
- **Recommended options:** (a) Config-file-managed taxonomy, changed via reviewed PR (developer-mediated); (b) Admin-UI-managed taxonomy (merchandiser self-service); (c) Hybrid — core/structural attributes in config, merchandising-facing tags/badges in admin UI.
- **Trade-offs:** (a) is safest against data-quality drift but slows merchandising agility; (b) is agile but risks taxonomy sprawl without review; (c) balances both but is more to design and build.
- **Status:** OPEN · **Final decision:** — · **Decision date:** —
- **Affected specs:** `specs/02-product-master.md`

#### PROD-002 — Required vs. optional attributes per department/category · **P1**
- **Question:** Which attributes are mandatory for a product to be publishable, and does this vary by department/category (e.g., "sleeve" required for tops, meaningless for footwear)?
- **Why it matters:** Directly feeds product-completeness/QA rules (`FASHION_DOMAIN_GAPS.md`) and the publish gate in `CAT-002`.
- **Dependencies:** PROD-001, CAT-002
- **Status:** OPEN · **Final decision:** — · **Decision date:** —
- **Affected specs:** `specs/02-product-master.md`

#### PROD-003 — Product lifecycle states · **P1**
- **Question:** What is the full product lifecycle state set — e.g., `draft -> ready_for_enrichment -> ready_for_qa -> published -> unpublished -> archived` — and who can transition each state?
- **Why it matters:** Without this, "enrichment," "QA," and "publish" have no formal gate, undermining product-completeness assurance.
- **Dependencies:** PROD-001
- **Recommended options:** Adopt the six-state model listed in the question as a starting proposal, subject to Product Owner revision.
- **Status:** OPEN · **Final decision:** — · **Decision date:** —
- **Affected specs:** `specs/02-product-master.md`, `specs/07-catalog-merchandising.md`

#### PROD-004 — Size chart model & versioning · **P1**
- **Question:** How are size charts modeled — per style, per category, per brand? Must size charts be versioned (so a past order can show the size chart in effect at purchase time)?
- **Why it matters:** Size/fit is the single largest driver of fashion returns (see `RET-001`); an unversioned size chart makes post-hoc return-reason analysis unreliable.
- **Dependencies:** PROD-001
- **Recommended options:** (a) Size chart per category/brand, versioned with an effective-date range; (b) Size chart per individual style (most accurate, most enrichment effort).
- **Status:** OPEN · **Final decision:** — · **Decision date:** —
- **Affected specs:** `specs/02-product-master.md`, `specs/10-pdp.md`

#### PROD-005 — Model measurements / model-worn-size display · **P2**
- **Question:** Is displaying model body measurements and the size the model is wearing in scope for launch?
- **Why it matters:** Common fashion-ecommerce fit aid; not currently mentioned anywhere in `/specs`.
- **Dependencies:** PROD-004
- **Status:** OPEN · **Final decision:** — · **Decision date:** —
- **Affected specs:** `specs/02-product-master.md`, `specs/10-pdp.md`

#### PROD-006 — Bulk product operations scope · **P2**
- **Question:** Are bulk price changes and bulk publish/unpublish operations required for launch, or can merchandising operate SKU-by-SKU initially?
- **Why it matters:** Not mentioned anywhere in current specs; materially affects admin tooling scope (`ADM-002`) and catalog throughput at scale.
- **Dependencies:** CAT-002, ADM-002
- **Status:** OPEN · **Final decision:** — · **Decision date:** —
- **Affected specs:** `specs/02-product-master.md`, `specs/28-admin.md`

---

## SUP — Suppliers

#### SUP-001 — Supplier hierarchy support · **P1**
- **Question:** Must the platform model supplier hierarchies (agents/sub-vendors acting on behalf of a principal supplier), or is a flat supplier list sufficient at launch?
- **Why it matters:** Affects PO routing and payment-terms modeling.
- **Dependencies:** PO-001
- **Status:** OPEN · **Final decision:** — · **Decision date:** —
- **Affected specs:** `specs/03-suppliers-procurement.md`

#### SUP-002 — Supplier portal/self-service access · **P2**
- **Question:** Do suppliers get any self-service access (e.g., to confirm PO receipt, view payment status), or is all supplier data internal-only at launch?
- **Why it matters:** A supplier portal is a significant scope addition (external-facing auth, RBAC) beyond internal admin tooling.
- **Dependencies:** AUTH-001, ADM-001
- **Status:** OPEN · **Final decision:** — · **Decision date:** —
- **Affected specs:** `specs/03-suppliers-procurement.md`

---

## PO — Purchase Orders

#### PO-001 — PO approval hierarchy & thresholds · **P0**
- **Question:** Who can approve a PO, and are there value-based approval thresholds (e.g., PO > ₹X requires a second approver)?
- **Why it matters:** Financial control gate before any committed spend; blocks `04-purchase-orders.md` implementation without it.
- **Dependencies:** ADM-001
- **Status:** OPEN · **Final decision:** — · **Decision date:** —
- **Affected specs:** `specs/04-purchase-orders.md`

#### PO-002 — Partial receipt / over-under delivery tolerance · **P1**
- **Question:** What tolerance (if any) is allowed for a supplier delivering more or less than the PO quantity before it's flagged as an exception?
- **Why it matters:** Directly affects `05-grn.md` exception handling and inventory ledger accuracy.
- **Dependencies:** GRN-002
- **Status:** OPEN · **Final decision:** — · **Decision date:** —
- **Affected specs:** `specs/04-purchase-orders.md`, `specs/05-grn.md`

#### PO-003 — Costing basis captured on PO · **P1**
- **Question:** Does the PO capture landed cost (including freight/duties/taxes) or unit cost only, with landed cost computed later?
- **Why it matters:** Feeds margin calculations in `CAT-001` pricing and GST input-credit accounting (`TAX-001`).
- **Dependencies:** TAX-001
- **Status:** OPEN · **Final decision:** — · **Decision date:** —
- **Affected specs:** `specs/04-purchase-orders.md`

---

## GRN — Goods Receipt / QC

#### GRN-001 — QC inspection criteria & pass/fail workflow · **P0**
- **Question:** What quality inspection checklist/criteria apply at receipt, and does it vary by category? What happens on QC fail (quarantine, return-to-supplier, or conditional acceptance)?
- **Why it matters:** This is the gate before stock becomes sellable inventory — without it, `06-inventory.md` receipt transactions have no defined quality trigger.
- **Dependencies:** SUP-001
- **Status:** OPEN · **Final decision:** — · **Decision date:** —
- **Affected specs:** `specs/05-grn.md`

#### GRN-002 — GRN exception resolution · **P1**
- **Question:** For short/over shipments or damaged-on-arrival goods, what is the resolution workflow — supplier debit/credit note, return-to-supplier, or write-off?
- **Why it matters:** Determines what ledger entries an exception produces and what financial follow-up is required.
- **Dependencies:** PO-002, TAX-005
- **Status:** OPEN · **Final decision:** — · **Decision date:** —
- **Affected specs:** `specs/05-grn.md`

#### GRN-003 — Barcode/scanning requirement at GRN · **P2**
- **Question:** Is barcode/scanning-based receipt required for launch, or is manual/UI-based receipt entry acceptable initially?
- **Why it matters:** Affects warehouse tooling scope and receipt speed/accuracy.
- **Dependencies:** WH-001
- **Status:** OPEN · **Final decision:** — · **Decision date:** —
- **Affected specs:** `specs/05-grn.md`

---

## INV — Inventory

#### INV-001 — Complete ledger transaction type list & required fields · **P0**
- **Question:** What is the definitive, exhaustive list of inventory ledger transaction types (receipt, sale, cancellation, return, transfer, adjustment, reservation, release, damage, and any others), and what fields does each require?
- **Why it matters:** This is the concrete implementation of the binding architectural principle in ADR-0012. `ARCHITECTURE.md` §5 lists a minimum set, not a final schema.
- **Dependencies:** GRN-001, ORD-001, RET-002
- **Status:** OPEN · **Final decision:** — · **Decision date:** —
- **Affected specs:** `specs/06-inventory.md`

#### INV-002 — Reservation trigger point & timeout · **P0**
- **Question:** Does adding an item to cart reserve inventory, or does reservation only begin at checkout start? What is the reservation timeout, and what releases it?
- **Why it matters:** Flagged as unresolved in both `specs/06-inventory.md` and `specs/11-wishlist-cart.md` (duplicate open question, now consolidated here). Directly determines oversell risk and cart-abandonment behavior.
- **Dependencies:** CART-001, CHK-001
- **Recommended options:** (a) Reserve only at checkout start, short timeout (e.g., 10–15 min), release on abandonment/payment failure; (b) Reserve on add-to-cart with a longer timeout; (c) No reservation until payment authorization succeeds (highest oversell risk, simplest to build).
- **Trade-offs:** (a) balances conversion protection against oversell risk and is the common ecommerce pattern; (b) protects customers better but risks unnecessary stock lockup during high-traffic periods; (c) is simplest but risks overselling at checkout, especially for low-stock/limited-size SKUs.
- **Status:** OPEN · **Final decision:** — · **Decision date:** —
- **Affected specs:** `specs/06-inventory.md`, `specs/11-wishlist-cart.md`, `specs/12-checkout.md`

#### INV-003 — Oversell policy · **P0**
- **Question:** Is oversell ever permitted (e.g., pre-order/backorder on a not-yet-received PO), and if so, how is it represented in the ledger without corrupting "available" stock figures for in-hand inventory?
- **Why it matters:** A pre-order/backorder capability is a common fashion-retail feature but has real inventory-integrity implications if not explicitly modeled.
- **Dependencies:** INV-001
- **Status:** OPEN · **Final decision:** — · **Decision date:** —
- **Affected specs:** `specs/06-inventory.md`

#### INV-004 — Multi-warehouse/multi-location support at launch · **P0**
- **Question:** Same decision as `ORG-002` — see that entry. Recorded separately here because it directly determines the inventory ledger's schema (does every transaction carry a location dimension from day one?).
- **Why it matters:** Retrofitting location-awareness into an already-live ledger is a major migration; deciding now avoids it.
- **Dependencies:** ORG-002 (decide together), WH-001
- **Status:** OPEN · **Final decision:** — · **Decision date:** —
- **Affected specs:** `specs/06-inventory.md`

#### INV-005 — Safety/buffer stock rules · **P1**
- **Question:** Does the platform need a safety-stock/buffer concept (stock reserved from sale below a threshold), and if so, how is it configured (per SKU, per category)?
- **Dependencies:** INV-001
- **Status:** OPEN · **Final decision:** — · **Decision date:** —
- **Affected specs:** `specs/06-inventory.md`

#### INV-006 — Damaged/return-pending stock re-entry · **P1**
- **Question:** Can damaged or return-pending stock ever re-enter sellable inventory (e.g., as marked-down "damaged/clearance" stock), or is it always quarantined/written off/returned to supplier?
- **Dependencies:** RET-002, GRN-001
- **Status:** OPEN · **Final decision:** — · **Decision date:** —
- **Affected specs:** `specs/06-inventory.md`, `specs/18-returns.md`

#### INV-007 — Cycle count / stock take workflow · **P2**
- **Question:** Is a periodic physical stock count / reconciliation workflow (and its ledger-adjustment mechanism) required for launch?
- **Dependencies:** INV-001, ADM-003
- **Status:** OPEN · **Final decision:** — · **Decision date:** —
- **Affected specs:** `specs/06-inventory.md`

---

## CAT — Catalog / Merchandising / Pricing

#### CAT-001 — Pricing model: tax treatment, currency, region scope · **P0**
- **Question:** Is displayed pricing tax-inclusive or tax-exclusive? Single currency/region at launch, or multi-currency/region from day one?
- **Why it matters:** In India, MRP-based, tax-inclusive pricing is the market norm (see `TAX-002`) — this is not a purely technical choice.
- **Dependencies:** TAX-001, TAX-002, ORG-001
- **Status:** OPEN · **Final decision:** — · **Decision date:** —
- **Affected specs:** `specs/07-catalog-merchandising.md`

#### CAT-002 — Publishing decision ownership · **P1**
- **Question:** Is a SKU's storefront visibility a manual merchandiser decision, an automated rule based on availability/QA-completeness (`PROD-003`), or both?
- **Dependencies:** PROD-002, PROD-003
- **Status:** OPEN · **Final decision:** — · **Decision date:** —
- **Affected specs:** `specs/07-catalog-merchandising.md`

#### CAT-003 — Browsing category vs. attribute category taxonomy · **P1**
- **Question:** Is the catalog's browsing/merchandising category tree the same taxonomy as the product attribute "category" field, or two independent structures?
- **Dependencies:** PROD-001
- **Status:** OPEN · **Final decision:** — · **Decision date:** —
- **Affected specs:** `specs/07-catalog-merchandising.md`, `specs/02-product-master.md`

#### CAT-004 — Merchandising tags/badges rule ownership · **P2**
- **Question:** Are badges like "New Arrival," "Bestseller," "Sale" manually curated or rule-driven (e.g., "New Arrival" = published within last 30 days)?
- **Dependencies:** CAT-002
- **Status:** OPEN · **Final decision:** — · **Decision date:** —
- **Affected specs:** `specs/07-catalog-merchandising.md`

---

## SF — Storefront

#### SF-001 — Design system / component library choice · **P1**
- **Question:** Build a custom design system, or adopt an existing component library as a base?
- **Dependencies:** none
- **Status:** OPEN · **Final decision:** — · **Decision date:** —
- **Affected specs:** `specs/08-storefront.md`

#### SF-002 — Internationalization/localization scope · **P1**
- **Question:** Single locale/currency (India/English/INR) at launch, or multi-locale architecture from day one?
- **Why it matters:** Affects SEO (`SEO-001`), pricing (`CAT-001`), and routing structure.
- **Dependencies:** ORG-001, CAT-001
- **Status:** OPEN · **Final decision:** — · **Decision date:** —
- **Affected specs:** `specs/08-storefront.md`

---

## SRCH — Search / Discovery

#### SRCH-001 — Relevance ranking rules · **P1**
- **Question:** What signals drive search/PLP ranking (recency, sales velocity, margin, manual curation, stock availability)?
- **Dependencies:** CAT-002
- **Status:** OPEN · **Final decision:** — · **Decision date:** —
- **Affected specs:** `specs/09-search-discovery.md`

#### SRCH-002 — Personalization/recommendation scope · **P2**
- **Question:** Is personalized search/recommendation in scope for launch, or a post-launch addition?
- **Dependencies:** ANL-001
- **Status:** OPEN · **Final decision:** — · **Decision date:** —
- **Affected specs:** `specs/09-search-discovery.md`

---

## PDP — Product Detail Page

#### PDP-001 — Reviews/ratings in scope for launch · **P1**
- **Question:** Are customer reviews and ratings required for launch?
- **Dependencies:** CUST-001
- **Status:** OPEN · **Final decision:** — · **Decision date:** —
- **Affected specs:** `specs/10-pdp.md`

#### PDP-002 — Cross-sell/related-products logic ownership · **P2**
- **Question:** Manually curated or rule/algorithm-driven cross-sell?
- **Dependencies:** SRCH-002
- **Status:** OPEN · **Final decision:** — · **Decision date:** —
- **Affected specs:** `specs/10-pdp.md`

---

## CART — Wishlist / Cart

#### CART-001 — Guest cart/wishlist persistence & merge-on-login · **P0**
- **Question:** How long does a guest cart/wishlist persist, and what happens to it when the guest logs in (merge with existing account cart, replace, or prompt)?
- **Why it matters:** Directly entangled with `INV-002` reservation timing — if guest carts reserve stock, an abandoned guest session has real inventory consequences.
- **Dependencies:** INV-002, AUTH-001
- **Status:** OPEN · **Final decision:** — · **Decision date:** —
- **Affected specs:** `specs/11-wishlist-cart.md`

#### CART-002 — Cart quantity limits per SKU · **P1**
- **Question:** Is there a maximum quantity of one SKU a customer can add to cart (anti-scalping / fair-access control)?
- **Dependencies:** none
- **Status:** OPEN · **Final decision:** — · **Decision date:** —
- **Affected specs:** `specs/11-wishlist-cart.md`

#### CART-003 — Wishlist sharing · **P2**
- **Question:** Is a shareable wishlist link in scope for launch?
- **Dependencies:** none
- **Status:** OPEN · **Final decision:** — · **Decision date:** —
- **Affected specs:** `specs/11-wishlist-cart.md`

---

## CHK — Checkout

#### CHK-001 — Guest checkout vs. account-required · **P0**
- **Question:** Can a customer complete checkout without creating an account?
- **Why it matters:** Major conversion-rate lever; also determines the minimum identity data captured per order (ties to `CUST-001`).
- **Dependencies:** AUTH-001, CART-001
- **Status:** OPEN · **Final decision:** — · **Decision date:** —
- **Affected specs:** `specs/12-checkout.md`

#### CHK-002 — Tax calculation approach · **P0**
- **Question:** How is GST calculated at checkout (line-item HSN-based rate lookup, single blanket rate, or provider-integrated tax engine)? See `TAX-001`–`TAX-003` for the underlying tax-model decisions this depends on.
- **Dependencies:** TAX-001, TAX-002, TAX-003
- **Status:** OPEN · **Final decision:** — · **Decision date:** —
- **Affected specs:** `specs/12-checkout.md`

#### CHK-003 — Shipping cost calculation rules · **P1**
- **Question:** Flat rate, weight/value-based, carrier-calculated, or free-shipping-threshold-based (`IND-005`)?
- **Dependencies:** IND-005, SHIP-001
- **Status:** OPEN · **Final decision:** — · **Decision date:** —
- **Affected specs:** `specs/12-checkout.md`

#### CHK-004 — Address serviceability check · **P1**
- **Question:** Is PIN-code serviceability validated at checkout before order placement, and against what data source (carrier API, static list)?
- **Dependencies:** IND-002, SHIP-001
- **Status:** OPEN · **Final decision:** — · **Decision date:** —
- **Affected specs:** `specs/12-checkout.md`

---

## PAY — Payment

#### PAY-001 — Payment provider abstraction interface shape · **P0**
- **Question:** What is the exact method/error-model contract every payment provider (Razorpay, COD, future providers) must implement?
- **Why it matters:** Concretizes the binding ADR-0011 abstraction; every other payment decision builds on this interface existing first.
- **Dependencies:** none
- **Status:** OPEN · **Final decision:** — · **Decision date:** —
- **Affected specs:** `specs/13-payment.md`

#### PAY-002 — Payment state machine definition · **P0**
- **Question:** What are the payment states (e.g., `initiated -> authorized -> captured -> failed/refunded`) and how do they map to, but remain distinct from, order states (`ORD-001`)?
- **Why it matters:** See `ORDER_PAYMENT_INTEGRITY.md` — conflating payment state and order state is a likely-by-default implementation mistake that this decision must explicitly prevent.
- **Dependencies:** ORD-001
- **Status:** OPEN · **Final decision:** — · **Decision date:** —
- **Affected specs:** `specs/13-payment.md`, `specs/14-order-management.md`

#### PAY-003 — Idempotency & webhook duplicate-event handling · **P0**
- **Question:** What idempotency key strategy and webhook deduplication approach prevents double-processing of a payment event (e.g., a retried webhook double-capturing or double-refunding)?
- **Why it matters:** Direct financial-integrity risk — a duplicate webhook processed twice can double-charge or double-refund a customer.
- **Dependencies:** PAY-001
- **Status:** OPEN · **Final decision:** — · **Decision date:** —
- **Affected specs:** `specs/13-payment.md`

#### PAY-004 — Partial/split payment support · **P1**
- **Question:** Is part-COD + part-prepaid, or split payment across methods, in scope for launch?
- **Dependencies:** PAY-001
- **Status:** OPEN · **Final decision:** — · **Decision date:** —
- **Affected specs:** `specs/13-payment.md`

#### PAY-005 — Payment retry/failure handling policy · **P1**
- **Question:** How many retry attempts are allowed on a failed payment, and what happens to the reserved inventory (`INV-002`) during retries?
- **Dependencies:** INV-002
- **Status:** OPEN · **Final decision:** — · **Decision date:** —
- **Affected specs:** `specs/13-payment.md`

#### PAY-006 — PCI/compliance posture confirmation · **P2**
- **Question:** Confirm the Razorpay integration uses a hosted/tokenized flow such that the platform never touches raw card data.
- **Why it matters:** `SECURITY.md` §4 states this as an assumption to confirm, not yet a verified fact.
- **Dependencies:** PAY-001
- **Status:** OPEN · **Final decision:** — · **Decision date:** —
- **Affected specs:** `specs/13-payment.md`, `SECURITY.md`

---

## ORD — Order Management

#### ORD-001 — Complete order state machine · **P0**
- **Question:** What is the full, definitive set of order states and valid transitions (payment, allocation, picking, packing, shipment, delivery, cancellation, partial cancellation, return, refund, exchange, RTO, exceptions), and which role/system may trigger each transition?
- **Why it matters:** Flagged in `specs/14-order-management.md` as "one of the most consequential open decisions in the whole platform." Nearly every other post-order-placement domain (`CAN`, `RET`, `REF`, `EXC`, `SHIP`) depends on this existing first.
- **Dependencies:** PAY-002, INV-001
- **Status:** OPEN · **Final decision:** — · **Decision date:** —
- **Affected specs:** `specs/14-order-management.md`

#### ORD-002 — Partial cancellation & partial shipment rules · **P0**
- **Question:** Can an order be partially cancelled or partially shipped at the line-item level? If so, how are shipping cost and promotion allocation apportioned across the remaining lines?
- **Dependencies:** ORD-001, CAN-001
- **Status:** OPEN · **Final decision:** — · **Decision date:** —
- **Affected specs:** `specs/14-order-management.md`, `specs/17-cancellation.md`

#### ORD-003 — RTO handling & interaction with refunds · **P0**
- **Question:** When a shipment is returned-to-origin (delivery failed/refused), what order state results, and how does it trigger refund (for prepaid) vs. simple closure (for COD, where no payment was collected)?
- **Dependencies:** ORD-001, REF-001
- **Status:** OPEN · **Final decision:** — · **Decision date:** —
- **Affected specs:** `specs/14-order-management.md`

#### ORD-004 — Order exception handling · **P1**
- **Question:** What is the defined handling for exceptions such as undeliverable address, repeated failed delivery attempts, or a warehouse pick shortfall discovered after order confirmation?
- **Dependencies:** ORD-001, WH-002
- **Status:** OPEN · **Final decision:** — · **Decision date:** —
- **Affected specs:** `specs/14-order-management.md`

#### ORD-005 — Order-to-inventory allocation timing · **P1**
- **Question:** At what point does reserved stock become "allocated" (committed to a specific order, no longer releasable by a generic timeout)?
- **Dependencies:** INV-002, ORD-001
- **Status:** OPEN · **Final decision:** — · **Decision date:** —
- **Affected specs:** `specs/14-order-management.md`, `specs/06-inventory.md`

#### ORD-006 — Order history/audit trail retention · **P2**
- **Question:** How long is full order history retained and queryable, and does this differ for compliance-relevant records (`AUD-001`)?
- **Dependencies:** AUD-001
- **Status:** OPEN · **Final decision:** — · **Decision date:** —
- **Affected specs:** `specs/14-order-management.md`

---

## WH — Warehouse / Fulfilment

#### WH-001 — Pick/pack technology for launch · **P1**
- **Question:** Barcode scanning + mobile app, or manual/paper-based pick-pack for launch?
- **Dependencies:** ORG-002
- **Status:** OPEN · **Final decision:** — · **Decision date:** —
- **Affected specs:** `specs/15-warehouse-fulfilment.md`

#### WH-002 — Pick exception feedback loop · **P1**
- **Question:** When an item is missing/damaged at pick time, what ledger adjustment and order exception (`ORD-004`) does it trigger, and who is notified?
- **Dependencies:** INV-001, ORD-004
- **Status:** OPEN · **Final decision:** — · **Decision date:** —
- **Affected specs:** `specs/15-warehouse-fulfilment.md`

---

## SHIP — Shipping / Tracking

#### SHIP-001 — Carrier(s) supported at launch · **P0**
- **Question:** Which shipping carrier(s)/logistics partners does the platform integrate with for launch?
- **Why it matters:** Blocks `16-shipping-tracking.md` and materially affects `CHK-004` serviceability checking and `CHK-003` shipping cost rules.
- **Dependencies:** ORG-002
- **Status:** OPEN · **Final decision:** — · **Decision date:** —
- **Affected specs:** `specs/16-shipping-tracking.md`

#### SHIP-002 — Carrier integration abstraction · **P1**
- **Question:** Should carrier integrations go through a provider-abstraction layer analogous to `PAY-001`, so carriers are replaceable without rewriting fulfilment logic? (Currently only a recommendation in `specs/16-shipping-tracking.md`, not yet an ADR.)
- **Dependencies:** SHIP-001
- **Status:** OPEN · **Final decision:** — · **Decision date:** —
- **Affected specs:** `specs/16-shipping-tracking.md`

#### SHIP-003 — Real-time tracking vs. polling · **P1**
- **Question:** Webhook-driven real-time tracking updates, or scheduled polling of carrier status?
- **Dependencies:** SHIP-001
- **Status:** OPEN · **Final decision:** — · **Decision date:** —
- **Affected specs:** `specs/16-shipping-tracking.md`

#### SHIP-004 — Failed delivery / redelivery attempt policy · **P1**
- **Question:** How many redelivery attempts before an order is marked RTO (`ORD-003`)?
- **Dependencies:** ORD-003
- **Status:** OPEN · **Final decision:** — · **Decision date:** —
- **Affected specs:** `specs/16-shipping-tracking.md`

---

## CAN — Cancellation

#### CAN-001 — Cancellation eligibility by order state · **P0**
- **Question:** At which order states (`ORD-001`) is cancellation permitted — e.g., can a picked-but-not-shipped order be cancelled, or only pre-allocation orders?
- **Dependencies:** ORD-001
- **Status:** OPEN · **Final decision:** — · **Decision date:** —
- **Affected specs:** `specs/17-cancellation.md`

#### CAN-002 — Who can cancel · **P1**
- **Question:** Customer self-service, customer-service-agent-only, or both — and under what constraints (e.g., time window)?
- **Dependencies:** CAN-001, ADM-001
- **Status:** OPEN · **Final decision:** — · **Decision date:** —
- **Affected specs:** `specs/17-cancellation.md`

#### CAN-003 — Cancellation reason capture · **P2**
- **Question:** Is a cancellation reason mandatory, and does it feed procurement/analytics (`ANL-001`)?
- **Dependencies:** ANL-001
- **Status:** OPEN · **Final decision:** — · **Decision date:** —
- **Affected specs:** `specs/17-cancellation.md`

---

## RET — Returns

#### RET-001 — Return window length & category exclusions · **P0**
- **Question:** How many days after delivery can a return be initiated, and which categories (if any — e.g., innerwear) are excluded or restricted?
- **Why it matters:** Core commercial policy with legal/consumer-protection dimensions (see `INDIA_COMMERCE_GAPS.md`).
- **Dependencies:** none
- **Status:** OPEN · **Final decision:** — · **Decision date:** —
- **Affected specs:** `specs/18-returns.md`

#### RET-002 — Return condition inspection criteria · **P0**
- **Question:** What condition must a returned item meet to be accepted (tags attached, unworn, original packaging), and who inspects it — automated rules, warehouse QC, or both?
- **Dependencies:** GRN-001 (analogous inspection model)
- **Status:** OPEN · **Final decision:** — · **Decision date:** —
- **Affected specs:** `specs/18-returns.md`

#### RET-003 — Self-service vs. assisted return initiation · **P1**
- **Question:** Can a customer initiate a return entirely self-service through their account, or must a customer-service agent be involved?
- **Dependencies:** CUST-001
- **Status:** OPEN · **Final decision:** — · **Decision date:** —
- **Affected specs:** `specs/18-returns.md`

#### RET-004 — Reverse logistics model · **P1**
- **Question:** Courier pickup from customer address, customer drop-off, or both? Which carrier (`SHIP-001`) handles reverse pickups?
- **Dependencies:** SHIP-001
- **Status:** OPEN · **Final decision:** — · **Decision date:** —
- **Affected specs:** `specs/18-returns.md`

---

## REF — Refunds

#### REF-001 — COD refund mechanism · **P0**
- **Question:** For a COD order (no original electronic payment to reverse), how is the refund issued — bank transfer, UPI, store credit, or customer's choice?
- **Why it matters:** Flagged explicitly in `ARCHITECTURE.md` §9 as needing a first-class answer, not an afterthought.
- **Dependencies:** REF-002, PAY-001
- **Status:** OPEN · **Final decision:** — · **Decision date:** —
- **Affected specs:** `specs/19-refunds.md`

#### REF-002 — Store credit / wallet as a platform concept · **P0**
- **Question:** Does the platform have a store-credit/wallet concept at all? If yes, it needs its own ledger (per the ADR-0012/0013 pattern) — this decision gates a nontrivial scope addition.
- **Dependencies:** none
- **Status:** OPEN · **Final decision:** — · **Decision date:** —
- **Affected specs:** `specs/19-refunds.md`

#### REF-003 — Refund timelines & partial refund rules · **P1**
- **Question:** What refund SLA is communicated to customers, and are restocking fees or partial refunds (e.g., for used/damaged returns) permitted?
- **Dependencies:** RET-002
- **Status:** OPEN · **Final decision:** — · **Decision date:** —
- **Affected specs:** `specs/19-refunds.md`

#### REF-004 — Refund reason capture vs. return reason · **P2**
- **Question:** Is refund reason a separate captured field from return reason, or always inherited from it?
- **Dependencies:** RET-002
- **Status:** OPEN · **Final decision:** — · **Decision date:** —
- **Affected specs:** `specs/19-refunds.md`

---

## EXC — Exchanges

#### EXC-001 — Exchange data model · **P0**
- **Question:** Is an exchange modeled as a linked pair (return + new order), or as a single first-class "exchange" entity? (Flagged identically in both `specs/18-returns.md` and `specs/20-exchanges.md` — consolidated here as one decision.)
- **Dependencies:** ORD-001, RET-002
- **Status:** OPEN · **Final decision:** — · **Decision date:** —
- **Affected specs:** `specs/18-returns.md`, `specs/20-exchanges.md`

#### EXC-002 — Price difference handling on exchange · **P1**
- **Question:** If the replacement item has a different price, does the customer pay the difference or receive a refund of it, and through what mechanism (`PAY-001`)?
- **Dependencies:** EXC-001, PAY-001
- **Status:** OPEN · **Final decision:** — · **Decision date:** —
- **Affected specs:** `specs/20-exchanges.md`

#### EXC-003 — Exchange eligibility window · **P2**
- **Question:** Same window as returns (`RET-001`), or a distinct (possibly shorter/longer) window?
- **Dependencies:** RET-001
- **Status:** OPEN · **Final decision:** — · **Decision date:** —
- **Affected specs:** `specs/20-exchanges.md`

---

## CUST — Customer 360

#### CUST-001 — Data retention & deletion policy · **P1**
- **Question:** What is the retention period for customer PII, and how are account-deletion requests handled?
- **Why it matters:** Likely has regulatory implications depending on applicable data-protection law — see `AUD-002`; do not treat as settled without legal input.
- **Dependencies:** AUD-002
- **Status:** OPEN · **Final decision:** — · **Decision date:** —
- **Affected specs:** `specs/21-customer-profile.md`

#### CUST-002 — Marketing preference center granularity · **P1**
- **Question:** Is opt-in/opt-out granular per channel (email/SMS/push) and per message type, or a single global marketing toggle? (Flagged identically in both `specs/21-customer-profile.md` and `specs/24-marketing.md` — consolidated here.)
- **Dependencies:** MKT-001
- **Status:** OPEN · **Final decision:** — · **Decision date:** —
- **Affected specs:** `specs/21-customer-profile.md`, `specs/24-marketing.md`

#### CUST-003 — Internal Customer 360 view vs. self-service profile scope split · **P2**
- **Question:** Is there a distinct internal admin "Customer 360" view (support/ops-facing) beyond the customer's own self-service profile, and where is that scoped — this spec or `28-admin.md`?
- **Dependencies:** ADM-002
- **Status:** OPEN · **Final decision:** — · **Decision date:** —
- **Affected specs:** `specs/21-customer-profile.md`, `specs/28-admin.md`

---

## LOY — Loyalty

#### LOY-001 — Loyalty program model & launch scope · **P0**
- **Question:** Does a loyalty program exist at launch at all, and if so is it a points system, cashback/credit system, or tiered-benefits system? `PRODUCT.md` §2.C explicitly leaves this unfrozen.
- **Dependencies:** ORG-001
- **Status:** OPEN · **Final decision:** — · **Decision date:** —
- **Affected specs:** `specs/22-loyalty.md`

#### LOY-002 — Earn rate rules · **P0**
- **Question:** How are points/credit earned (e.g., per ₹ spent), and on what basis (order value, per-line, pre- or post-discount)?
- **Dependencies:** LOY-001
- **Status:** OPEN · **Final decision:** — · **Decision date:** —
- **Affected specs:** `specs/22-loyalty.md`

#### LOY-003 — Redemption mechanics & minimum redemption · **P0**
- **Question:** How do points/credit convert to a discount, and is there a minimum redemption threshold or maximum redemption cap per order?
- **Dependencies:** LOY-001
- **Status:** OPEN · **Final decision:** — · **Decision date:** —
- **Affected specs:** `specs/22-loyalty.md`

#### LOY-004 — Expiry policy · **P1**
- **Question:** Do earned points/credit expire, and after what period?
- **Dependencies:** LOY-001
- **Status:** OPEN · **Final decision:** — · **Decision date:** —
- **Affected specs:** `specs/22-loyalty.md`

#### LOY-005 — Loyalty + promotion stacking · **P1**
- **Question:** Can loyalty redemption be combined with a promotional discount (`PROMO-002`) on the same order? (Flagged identically in both `specs/22-loyalty.md` and `specs/23-promotions.md` — consolidated here.)
- **Dependencies:** LOY-003, PROMO-002
- **Status:** OPEN · **Final decision:** — · **Decision date:** —
- **Affected specs:** `specs/22-loyalty.md`, `specs/23-promotions.md`

---

## PROMO — Promotions

#### PROMO-001 — Supported promotion types for launch · **P1**
- **Question:** Which promotion types (percentage off, fixed amount, BOGO, free shipping, etc.) are required for launch?
- **Dependencies:** CAT-001
- **Status:** OPEN · **Final decision:** — · **Decision date:** —
- **Affected specs:** `specs/23-promotions.md`

#### PROMO-002 — Stacking/precedence rules · **P1**
- **Question:** Can multiple coupons/promotions apply to one order, and in what precedence order?
- **Dependencies:** PROMO-001
- **Status:** OPEN · **Final decision:** — · **Decision date:** —
- **Affected specs:** `specs/23-promotions.md`

---

## MKT — Marketing

#### MKT-001 — Marketing channels & build-vs-integrate for launch · **P2**
- **Question:** Which channels (email/SMS/push) launch first, and is marketing automation built natively or via a third-party ESP integration?
- **Dependencies:** CUST-002
- **Status:** OPEN · **Final decision:** — · **Decision date:** —
- **Affected specs:** `specs/24-marketing.md`

---

## CHAN — Channel Publishing

#### CHAN-001 — Which channels launch first · **P2**
- **Question:** Google Shopping/Merchant Center, Meta/Instagram, both, or neither at launch? `PRODUCT.md` §2.E explicitly states no integrations are approved yet.
- **Dependencies:** none
- **Status:** OPEN · **Final decision:** — · **Decision date:** —
- **Affected specs:** `specs/25-social-channel-publishing.md`

---

## SEO — SEO

#### SEO-001 — URL structure/canonicalization strategy · **P2**
- **Question:** What is the canonical URL structure for PDP/PLP pages, and how are discontinued-product redirects handled?
- **Dependencies:** SF-002
- **Status:** OPEN · **Final decision:** — · **Decision date:** —
- **Affected specs:** `specs/26-seo.md`

---

## ANL — Analytics / Reporting

#### ANL-001 — Build vs. integrate analytics/BI & launch KPI list · **P2**
- **Question:** Native reporting vs. third-party BI tool, and which KPIs are required at launch vs. deferred?
- **Dependencies:** none
- **Status:** OPEN · **Final decision:** — · **Decision date:** —
- **Affected specs:** `specs/27-analytics-reporting.md`

---

## ADM — Admin / Operating Roles

#### ADM-001 — Final RBAC role list & permission matrix · **P0**
- **Question:** What is the complete list of internal roles (see `OPERATING_ROLES.md` for candidate personas) and their permission matrix?
- **Why it matters:** Gates nearly every domain's admin surface and `AUTH-002`.
- **Dependencies:** AUTH-002
- **Status:** OPEN · **Final decision:** — · **Decision date:** —
- **Affected specs:** `specs/01-auth-rbac.md`, `specs/28-admin.md`

#### ADM-002 — Separate admin app vs. shared app with role-gated routes · **P1**
- **Question:** Is the admin experience a fully separate application from the storefront, or a shared codebase with access-controlled routes?
- **Dependencies:** SF-001
- **Status:** OPEN · **Final decision:** — · **Decision date:** —
- **Affected specs:** `specs/28-admin.md`

#### ADM-003 — Manual inventory adjustment authorization workflow · **P1**
- **Question:** Who can manually adjust stock counts, and what justification/approval/audit trail is required (ties to `INV-007`, `AUD-001`)?
- **Dependencies:** INV-007, AUD-001
- **Status:** OPEN · **Final decision:** — · **Decision date:** —
- **Affected specs:** `specs/28-admin.md`, `specs/06-inventory.md`

---

## NOTIF — Notifications

#### NOTIF-001 — Notification channels & build-vs-integrate for launch · **P2**
- **Question:** Email only, or email + SMS + push at launch? Native or third-party transactional messaging provider?
- **Dependencies:** none
- **Status:** OPEN · **Final decision:** — · **Decision date:** —
- **Affected specs:** `specs/29-notifications.md`

---

## AUD — Audit / Compliance

#### AUD-001 — Audit log access control & retention period · **P1**
- **Question:** Who can access audit logs (which RBAC role, `ADM-001`), and what retention period applies per data category?
- **Dependencies:** ADM-001
- **Status:** OPEN · **Final decision:** — · **Decision date:** —
- **Affected specs:** `specs/30-audit-compliance.md`

#### AUD-002 — Regulatory/compliance requirement identification · **P1**
- **Question:** What data-protection, consumer-protection, and financial-record-retention regulations apply to this platform's target market? Requires legal input — see `INDIA_COMMERCE_GAPS.md`.
- **Dependencies:** none
- **Status:** OPEN · **Final decision:** — · **Decision date:** —
- **Affected specs:** `specs/30-audit-compliance.md`

---

## TAX — India Tax / GST

**Audit note:** This entire domain is a **missing spec** — no file in
`/specs` currently owns GST/tax/invoicing. Decisions here should be
recorded against `specs/12-checkout.md` (which already flags "tax
calculation approach" as open) until/unless the Product Owner authorizes
a dedicated tax/compliance spec. See `INDIA_COMMERCE_GAPS.md`.

#### TAX-001 — GST registration/multi-state model & computation approach · **P0**
- **Question:** Is the business GST-registered in a single state or multiple states? How is CGST/SGST vs. IGST determined per order (based on shipping state vs. warehouse state)?
- **Why it matters:** **COMPLIANCE/LEGAL QUESTION REQUIRING VERIFICATION** — this is not a technical preference, it is a legal registration and tax-computation question that needs the Product Owner's finance/legal input, not an engineering assumption.
- **Dependencies:** ORG-001, ORG-002
- **Status:** OPEN · **Final decision:** — · **Decision date:** —
- **Affected specs:** `specs/12-checkout.md`

#### TAX-002 — MRP vs. selling-price display & inclusive/exclusive presentation · **P0**
- **Question:** Is pricing displayed as MRP-based and tax-inclusive (the common Indian retail norm), and how does this interact with discounts/promotions display?
- **Why it matters:** **COMPLIANCE/LEGAL QUESTION REQUIRING VERIFICATION** — MRP disclosure has Legal Metrology Act implications for pre-packaged goods in India that need verification, not assumption.
- **Dependencies:** CAT-001
- **Status:** OPEN · **Final decision:** — · **Decision date:** —
- **Affected specs:** `specs/07-catalog-merchandising.md`, `specs/02-product-master.md`

#### TAX-003 — HSN code assignment · **P0**
- **Question:** Is an HSN (Harmonized System of Nomenclature) code required per product/SKU, and at what level of the taxonomy is it assigned (category-level default vs. per-SKU override)?
- **Why it matters:** **COMPLIANCE/LEGAL QUESTION REQUIRING VERIFICATION** — required for GST invoicing/returns depending on business turnover thresholds; needs legal/finance verification of applicable thresholds.
- **Dependencies:** PROD-001
- **Status:** OPEN · **Final decision:** — · **Decision date:** —
- **Affected specs:** `specs/02-product-master.md`

#### TAX-004 — GST-compliant invoice generation · **P0**
- **Question:** Does the platform generate a GST-compliant tax invoice per order (required fields, numbering sequence), and at what point in the order lifecycle (`ORD-001`)?
- **Why it matters:** **COMPLIANCE/LEGAL QUESTION REQUIRING VERIFICATION** — a genuinely missing capability in the current specs; likely a legal requirement for any registered Indian seller, but exact format rules need verification.
- **Dependencies:** TAX-001, ORD-001
- **Status:** OPEN · **Final decision:** — · **Decision date:** —
- **Affected specs:** `specs/14-order-management.md`

#### TAX-005 — Credit note generation for returns/refunds/cancellations · **P0**
- **Question:** Does a return/refund/cancellation generate a formal GST credit note, and how does it link to the original invoice (`TAX-004`)?
- **Why it matters:** **COMPLIANCE/LEGAL QUESTION REQUIRING VERIFICATION** — a missing capability in current `19-refunds.md`/`17-cancellation.md` specs.
- **Dependencies:** TAX-004, REF-001
- **Status:** OPEN · **Final decision:** — · **Decision date:** —
- **Affected specs:** `specs/19-refunds.md`, `specs/17-cancellation.md`

#### TAX-006 — Discount presentation on invoice · **P1**
- **Question:** Are promotional discounts applied pre-tax or post-tax on the invoice, and how is this reflected in the GST computation?
- **Dependencies:** TAX-004, PROMO-001
- **Status:** OPEN · **Final decision:** — · **Decision date:** —
- **Affected specs:** `specs/23-promotions.md`

---

## IND — Other India-specific commerce

#### IND-001 — COD availability rules & reconciliation process · **P0**
- **Question:** Is COD available on all orders/PIN codes/order values, or restricted (e.g., max COD order value, excluded PIN codes)? What is the operational reconciliation process for cash collected by the delivery partner?
- **Dependencies:** SHIP-001, REF-001
- **Status:** OPEN · **Final decision:** — · **Decision date:** —
- **Affected specs:** `specs/13-payment.md`

#### IND-002 — PIN-code serviceability check · **P0**
- **Question:** What data source determines whether a PIN code is serviceable (carrier API, static/periodically-updated list), and is this checked at PDP, cart, or checkout?
- **Dependencies:** SHIP-001
- **Status:** OPEN · **Final decision:** — · **Decision date:** —
- **Affected specs:** `specs/12-checkout.md`

#### IND-003 — Indian address structure · **P1**
- **Question:** What address fields/validation are required (house/flat, locality, landmark, city, state, PIN code) and is address auto-complete (PIN-code-to-city/state lookup) required?
- **Dependencies:** IND-002
- **Status:** OPEN · **Final decision:** — · **Decision date:** —
- **Affected specs:** `specs/12-checkout.md`, `specs/21-customer-profile.md`

#### IND-004 — UPI/net-banking/wallet support at launch · **P1**
- **Question:** Beyond cards, which payment rails does the Razorpay integration expose at launch (UPI, net banking, wallets)?
- **Dependencies:** PAY-001
- **Status:** OPEN · **Final decision:** — · **Decision date:** —
- **Affected specs:** `specs/13-payment.md`

#### IND-005 — Free-shipping threshold & shipping charge policy · **P2**
- **Question:** Is there a free-shipping order-value threshold, and what is the shipping charge below it?
- **Dependencies:** CHK-003
- **Status:** OPEN · **Final decision:** — · **Decision date:** —
- **Affected specs:** `specs/12-checkout.md`

---

## NFR — Non-functional requirements

See `NON_FUNCTIONAL_REQUIREMENTS.md` for the full structured NFR document
this domain feeds.

#### NFR-001 — Performance targets · **P1**
- **Question:** What are the target page-load and API-latency figures (e.g., PDP LCP, checkout API p95)? Currently `TARGET_REQUIRED` everywhere.
- **Dependencies:** none
- **Status:** OPEN · **Final decision:** — · **Decision date:** —
- **Affected specs:** `TESTING.md`, `specs/08-storefront.md`

#### NFR-002 — Availability/uptime target · **P1**
- **Question:** What uptime SLA/SLO applies, and does it differ between storefront and admin?
- **Dependencies:** none
- **Status:** OPEN · **Final decision:** — · **Decision date:** —
- **Affected specs:** `DEPLOYMENT.md`

#### NFR-003 — Data retention & backup/restore/DR targets · **P1**
- **Question:** What is the backup frequency, restore-time objective (RTO), and recovery-point objective (RPO)?
- **Dependencies:** AUD-002
- **Status:** OPEN · **Final decision:** — · **Decision date:** —
- **Affected specs:** `DEPLOYMENT.md`, `SECURITY.md`

#### NFR-004 — Accessibility conformance level · **P2**
- **Question:** Target WCAG conformance level (A/AA/AAA) for the storefront?
- **Dependencies:** SF-001
- **Status:** OPEN · **Final decision:** — · **Decision date:** —
- **Affected specs:** `specs/08-storefront.md`

#### NFR-005 — Browser/device support matrix · **P2**
- **Question:** Which browsers/OS versions/device classes are officially supported?
- **Dependencies:** SF-001
- **Status:** OPEN · **Final decision:** — · **Decision date:** —
- **Affected specs:** `specs/08-storefront.md`

#### NFR-006 — Rate limiting / API reliability targets · **P2**
- **Question:** What rate-limiting policy and API error-budget targets apply, particularly for public storefront APIs?
- **Dependencies:** none
- **Status:** OPEN · **Final decision:** — · **Decision date:** —
- **Affected specs:** `SECURITY.md`
