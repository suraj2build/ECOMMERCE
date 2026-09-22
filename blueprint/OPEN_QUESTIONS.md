# Open Questions — Product Owner Questionnaire

**Purpose:** This is the consolidated questionnaire for the human
Product Owner (working with ChatGPT as Product Architect, per
`AGENTS.md`) to work through in producing **Product Blueprint V2**.
It is derived from `DECISION_REGISTER.md` — every question here has a
matching decision ID there with full context (dependencies, trade-offs,
affected specs). Answer here in summary; record the full decision back
in the register and the affected spec(s).

**112 total open decisions: 39 P0, 49 P1, 24 P2.** This document gives
full treatment to the 39 P0 questions (the ones blocking any
implementation start), then lists P1 and P2 as a lighter checklist —
see the register for their full context when you get to them.

## Priority definitions

- **P0** — Architecture/business-critical. Blocks development of any
  milestone that touches this decision, directly or through a
  dependency chain. Concentrated in: identity/RBAC foundations, the
  order and payment state machines, the inventory ledger, and India
  tax/compliance (which touches checkout, catalog, and order on day
  one).
- **P1** — Required before the specific milestone that depends on it
  reaches implementation, but does not block the platform as a whole
  from starting foundational work.
- **P2** — Can safely be decided later; affects a specific feature's
  quality/completeness, not platform viability.

Note: this classification is the engineering agent's assessment based
on dependency analysis (see `DEPENDENCY_MAP.md`), not a business
judgment about what matters most commercially — the Product Owner
should feel free to reprioritize.

---

## Part 1 — P0 decisions (39)

### Identity & organization

**AUTH-001 — Customer authentication method(s)**
- Why it matters: Determines identity schema and session design; shapes conversion for a mobile-heavy India audience.
- Options: (a) Mobile OTP only · (b) Mobile OTP + password fallback · (c) Mobile OTP + email + social login.
- Implications: (a) fastest/most India-idiomatic but fragile to SMS delivery issues; (c) most flexible, most build cost.

**AUTH-002 — Staff/admin authentication & MFA requirement**
- Why it matters: Admin accounts touch inventory, pricing, refunds, and customer PII.
- Options: (a) Mandatory MFA for all staff · (b) Mandatory MFA for high-risk roles only · (c) MFA optional.
- Implications: (a) safest, more onboarding friction; (b) balances risk vs. friction but needs the role model (ADM-001) first.

**ORG-001 — Single legal entity vs. multi-brand/multi-tenant model**
- Why it matters: Foundational data-modeling decision affecting product master, inventory, invoicing, and RBAC scoping; expensive to retrofit.
- Options: (a) Single entity, single brand · (b) Single entity, multiple sub-brands · (c) Multi-entity/multi-tenant from day one.
- Implications: (a) matches the stated "independent platform" vision and is fastest; (c) is heavy upfront cost with no stated current need.

**ORG-002 — Warehouse/location model at launch** *(decide together with INV-004)*
- Why it matters: Determines whether inventory, allocation, and fulfilment need location-awareness from day one.
- Options: (a) Single warehouse at launch, schema reserves a location field for later · (b) Multi-location from launch.
- Implications: (a) much simpler to build correctly; (b) more future-proof but adds complexity with no current operational need.

**ADM-001 — Final RBAC role list & permission matrix**
- Why it matters: Gates nearly every domain's admin surface.
- Options: (a) Minimal role set (Admin, Warehouse, Customer Service) · (b) Full candidate list in `OPERATING_ROLES.md` (Super Admin, Business Admin, Buyer, Merchandiser, Catalog Manager, Warehouse Manager, Warehouse Operator, Customer Service, Marketing, Finance, Analyst) · (c) Something in between, chosen per actual team structure.
- Implications: Fewer roles ship faster but risk over-broad permissions; the full candidate list needs the Product Owner to confirm which roles actually exist in the organization.

### Product & inventory foundations

**PROD-001 — Attribute taxonomy governance**
- Why it matters: Concrete design of the "extensible attribute system" requirement; wrong governance risks either sprawl or false extensibility.
- Options: (a) Config-file-managed, developer-reviewed · (b) Admin-UI-managed, merchandiser self-service · (c) Hybrid (structural attributes in config, merchandising tags in UI).
- Implications: (a) safest against data drift, slower; (b) most agile, riskiest; (c) balanced, more to build.

**PO-001 — PO approval hierarchy & thresholds**
- Why it matters: Financial control gate before committed spend.
- Options: (a) Single approver, no thresholds · (b) Value-based threshold triggers a second approver · (c) Category/supplier-based approval routing.
- Implications: More approval steps slow procurement but reduce financial risk exposure.

**GRN-001 — QC inspection criteria & pass/fail workflow**
- Why it matters: The gate before stock becomes sellable — without it, inventory "receipt" transactions have no defined quality trigger.
- Options: (a) Uniform checklist for all categories · (b) Category-specific checklists · (c) Spot-check sampling rather than 100% inspection.
- Implications: Category-specific checklists are more accurate but require more enrichment/setup effort per category.

**INV-001 — Complete ledger transaction type list & required fields**
- Why it matters: Concrete implementation of the binding ADR-0012 ledger principle; `ARCHITECTURE.md` lists a minimum set only.
- Options: Adopt the minimum set as-is · Extend it with the additional types surfaced in `INVENTORY_INTEGRITY.md` (QC pass/fail, transfer in/out, exchange-driven movements).
- Implications: A richer transaction type set gives better auditability but is more to implement and test correctly.

**INV-002 — Reservation trigger point & timeout**
- Why it matters: Determines oversell risk and cart-abandonment behavior; flagged as a duplicate open question across two existing specs.
- Options: (a) Reserve only at checkout start, short timeout (10–15 min) · (b) Reserve on add-to-cart, longer timeout · (c) No reservation until payment succeeds.
- Implications: (a) is the common ecommerce pattern balancing conversion and oversell risk; (c) is simplest but risks overselling low-stock SKUs.

**INV-003 — Oversell policy**
- Why it matters: A pre-order/backorder capability is common in fashion retail but needs explicit ledger modeling to avoid corrupting "available" stock figures.
- Options: (a) No oversell ever permitted (safest, may lose pre-order sales) · (b) Oversell permitted only for explicitly flagged pre-order SKUs, tracked in a distinct ledger state.
- Implications: (b) unlocks a real merchandising tool but adds ledger complexity.

**INV-004 — Multi-warehouse/multi-location support** *(same decision as ORG-002)*
- See ORG-002 above.

**CAT-001 — Pricing model: tax treatment, currency, region scope**
- Why it matters: In India, MRP-based, tax-inclusive pricing is the market norm — not a purely technical choice.
- Options: (a) Tax-inclusive, single currency/region (INR, India-only) · (b) Tax-exclusive display with tax shown at checkout · (c) Multi-currency/region-ready from day one.
- Implications: (a) matches market norm and is simplest; (c) adds real complexity with no stated current need for multiple markets.

### Cart, checkout, payment

**CART-001 — Guest cart/wishlist persistence & merge-on-login**
- Why it matters: Entangled with INV-002 — if guest carts reserve stock, abandoned guest sessions have real inventory consequences.
- Options: (a) Guest cart is session-only, no reservation · (b) Guest cart persists via cookie/device ID for N days, merges into account cart on login.
- Implications: (b) is better UX but must be reconciled with whatever INV-002 decides about reservation timing.

**CHK-001 — Guest checkout vs. account-required**
- Why it matters: Major conversion-rate lever; determines minimum identity data captured per order.
- Options: (a) Guest checkout allowed, account optional post-purchase · (b) Account required before checkout.
- Implications: (a) typically converts better; (b) simplifies customer-order linkage and loyalty/CUST-001 tracking.

**CHK-002 — Tax calculation approach**
- Why it matters: Depends entirely on the TAX-001–TAX-003 decisions below; cannot be answered independently of them.
- Options: See TAX-001–TAX-003.
- Implications: See TAX-001–TAX-003.

**PAY-001 — Payment provider abstraction interface shape**
- Why it matters: Every other payment decision builds on this interface existing first; concretizes binding ADR-0011.
- Options: This is primarily a technical/design choice.
- **Recommendation:** Define a minimal interface (`initiate`, `authorize`, `capture`, `refund`, `handleWebhook`) with a provider-agnostic result/error type, modeled after Razorpay's own order/payment/refund objects but not exposing Razorpay-specific fields to calling code.
- Implications: Getting this interface right early avoids leaking provider-specific assumptions into order/checkout logic later.

**PAY-002 — Payment state machine definition**
- Why it matters: Payment state and order state must not be conflated — see `ORDER_PAYMENT_INTEGRITY.md`. This is a likely-by-default implementation mistake if not explicitly decided.
- Options: This is primarily a technical/design choice, though the mapping to order states has business implications (e.g., does "payment pending" block order confirmation?).
- **Recommendation:** `initiated -> authorized -> captured -> (refunded | partially_refunded)` plus `failed`/`expired` terminal states, kept as a field on the order/payment link, never merged into the order's own status field.
- Implications: Keeping the two state machines separate (even if visually shown together in admin UI) prevents a large class of future bugs.

**PAY-003 — Idempotency & webhook duplicate-event handling**
- Why it matters: Direct financial-integrity risk — a duplicate webhook processed twice can double-charge or double-refund a customer.
- Options: This is primarily a technical/design choice.
- **Recommendation:** Every payment-affecting operation carries a caller-supplied idempotency key; every inbound webhook is deduplicated by provider event ID before processing, with processed-event IDs retained for a defined window.
- Implications: This is cheap to build correctly up front and very expensive to retrofit after a real double-charge incident.

### Order lifecycle

**ORD-001 — Complete order state machine**
- Why it matters: Flagged in the specs themselves as the single most consequential open decision — almost every post-purchase domain depends on it.
- Options: This is a business-policy choice requiring the Product Owner's operational model, not a technical one.
- Implications: Under-specifying this now means every downstream domain (cancellation, return, refund, exchange, shipping) will hit ambiguity during implementation.

**ORD-002 — Partial cancellation & partial shipment rules**
- Options: (a) Not supported at launch (whole-order only) · (b) Supported at line-item level.
- Implications: (a) is simpler to build and test; (b) matches real fashion-retail operations (multi-item orders routinely ship/cancel partially) but is materially more complex.

**ORD-003 — RTO handling & interaction with refunds**
- Options: (a) RTO always triggers full refund flow (even for COD, where it's really just "no charge occurred") · (b) RTO handling differs by payment method.
- Implications: A single unified RTO-to-refund path (option a, treating COD as a zero-amount refund) is simpler to implement and test than two divergent paths.

### Returns, refunds, exchanges

**RET-001 — Return window length & category exclusions**
- Why it matters: Core commercial policy with consumer-protection dimensions — not purely technical.
- Options: Typical India fashion-ecommerce ranges from 7–30 days; category exclusions commonly include innerwear/swimwear for hygiene reasons.
- Implications: A longer window increases customer trust but also return-rate/logistics cost.

**RET-002 — Return condition inspection criteria**
- Options: (a) Rule-based (tags attached, unworn) checked by warehouse QC on arrival · (b) Automated customer-declared condition at return-initiation time, trusted until contradicted by QC.
- Implications: (a) is more reliable but slower to refund; (b) is faster for the customer but exposes the business to more disputed returns.

**REF-001 — COD refund mechanism**
- Why it matters: `ARCHITECTURE.md` explicitly calls this out as needing a first-class answer.
- Options: (a) Bank transfer/UPI to customer-provided details · (b) Store credit (requires REF-002 to be decided first) · (c) Customer's choice between (a) and (b).
- Implications: (c) is best for customer trust but is the most to build; (a) alone is simplest but has no advantage if store credit is desired for other reasons too.

**REF-002 — Store credit / wallet as a platform concept**
- Options: (a) No store credit concept — all refunds are cash-equivalent (bank/UPI/original method) · (b) Store credit exists as a first-class ledgered concept, usable for future purchases and available as a refund method.
- Implications: (b) adds real scope (its own ledger, per ADR-0012/0013 pattern) but is a common retention lever and simplifies REF-001.

**EXC-001 — Exchange data model**
- Why it matters: Flagged identically in two existing specs — genuinely unresolved, not just under-documented.
- Options: (a) Exchange = linked return + new order (reuses existing return/order machinery) · (b) Exchange = first-class entity with its own state machine.
- Implications: (a) is faster to build by reusing existing flows but risks losing the "this was one customer action" context; (b) is cleaner but is new machinery to build and test.

### India tax & compliance (new domain — all P0)

**TAX-001 — GST registration/multi-state model & computation approach**
- **COMPLIANCE/LEGAL QUESTION REQUIRING VERIFICATION** — not a technical preference.
- Why it matters: Determines whether CGST/SGST or IGST applies per order, and whether multi-state GST registration is needed.
- Recommendation: Verify with a tax professional/CA before treating any assumption as settled; the engineering answer follows directly from the legal one.

**TAX-002 — MRP vs. selling-price display & inclusive/exclusive presentation**
- **COMPLIANCE/LEGAL QUESTION REQUIRING VERIFICATION.**
- Why it matters: MRP disclosure for pre-packaged goods has Legal Metrology Act implications in India.
- Recommendation: Verify applicability to the platform's specific product categories before implementation.

**TAX-003 — HSN code assignment**
- **COMPLIANCE/LEGAL QUESTION REQUIRING VERIFICATION.**
- Why it matters: HSN code requirements on invoices depend on business turnover thresholds under Indian GST rules.
- Recommendation: Verify current thresholds and requirements with a tax professional; do not assume a specific digit-length requirement.

**TAX-004 — GST-compliant invoice generation**
- **COMPLIANCE/LEGAL QUESTION REQUIRING VERIFICATION.**
- Why it matters: A genuinely missing capability in current specs; likely legally required for a registered Indian seller.
- Recommendation: This needs a dedicated spec once TAX-001–003 are answered — currently there is no owner in `/specs` for invoice generation.

**TAX-005 — Credit note generation for returns/refunds/cancellations**
- **COMPLIANCE/LEGAL QUESTION REQUIRING VERIFICATION.**
- Why it matters: Same gap as TAX-004, specific to the reverse flow.

**IND-001 — COD availability rules & reconciliation process**
- Why it matters: COD is a named, approved payment method (ADR-0011) but its operational rules (eligibility, cash reconciliation with the delivery partner) are undefined.
- Options: (a) COD available everywhere serviceable, no value cap · (b) COD capped at a maximum order value and/or excluded in certain PIN codes (common risk-mitigation pattern).
- Implications: (b) reduces COD-related loss risk (non-payment on delivery, RTO) at some cost to accessibility/conversion in cash-preferring segments.

**IND-002 — PIN-code serviceability check**
- Why it matters: Determines whether checkout can even be attempted for a given address; depends on SHIP-001 (carrier choice) existing first.
- Options: (a) Static/periodically-updated serviceable-PIN-code list · (b) Real-time carrier API serviceability check.
- Implications: (b) is more accurate but requires the carrier integration (SHIP-001/SHIP-002) to be further along.

---

## Part 2 — P1 decisions (49) — checklist

Work through these after the P0 set above is resolved enough to start
foundational implementation. Each references its full entry in
`DECISION_REGISTER.md`.

**Identity/Org:** AUTH-003 (session/token strategy)

**Product:** PROD-002 (required attributes per category), PROD-003
(product lifecycle states), PROD-004 (size chart model & versioning)

**Suppliers/Procurement:** SUP-001 (supplier hierarchy), PO-002
(partial receipt tolerance), PO-003 (costing basis on PO)

**GRN:** GRN-002 (exception resolution)

**Inventory:** INV-005 (safety stock), INV-006 (damaged stock
re-entry)

**Catalog:** CAT-002 (publishing decision ownership), CAT-003
(browsing vs. attribute category taxonomy)

**Storefront:** SF-001 (design system choice), SF-002
(internationalization scope)

**Search:** SRCH-001 (relevance ranking rules)

**PDP:** PDP-001 (reviews/ratings in scope)

**Cart:** CART-002 (cart quantity limits)

**Checkout:** CHK-003 (shipping cost rules), CHK-004 (address
serviceability check)

**Payment:** PAY-004 (partial/split payment), PAY-005 (retry/failure
handling)

**Order:** ORD-004 (exception handling), ORD-005 (allocation timing)

**Warehouse:** WH-001 (pick/pack technology), WH-002 (pick exception
feedback loop)

**Shipping:** SHIP-002 (carrier abstraction — proposed new ADR),
SHIP-003 (real-time vs. polling tracking), SHIP-004 (redelivery
attempt policy)

**Cancellation:** CAN-002 (who can cancel)

**Returns:** RET-003 (self-service vs. assisted), RET-004 (reverse
logistics model)

**Refunds:** REF-003 (refund timelines & partial refunds)

**Exchanges:** EXC-002 (price difference handling)

**Customer:** CUST-001 (data retention & deletion), CUST-002
(marketing preference granularity)

**Loyalty:** LOY-004 (expiry policy), LOY-005 (loyalty + promotion
stacking)

**Promotions:** PROMO-001 (supported promotion types), PROMO-002
(stacking/precedence rules)

**Admin:** ADM-002 (separate app vs. shared app), ADM-003 (manual
inventory adjustment workflow)

**Audit:** AUD-001 (audit log access & retention), AUD-002
(regulatory requirement identification — needs legal input)

**Tax:** TAX-006 (discount presentation on invoice)

**India:** IND-003 (address structure), IND-004 (UPI/net-banking/wallet
support at launch)

**NFR:** NFR-001 (performance targets), NFR-002 (availability target),
NFR-003 (backup/restore/DR targets)

---

## Part 3 — P2 decisions (24) — checklist

Defer these without blocking anything; revisit when their owning
milestone approaches.

PROD-005 (model measurements display), PROD-006 (bulk product
operations), SUP-002 (supplier portal), GRN-003 (barcode/scanning
requirement), INV-007 (cycle count workflow), CAT-004 (merchandising
badge rules), SRCH-002 (personalization scope), PDP-002 (cross-sell
logic ownership), CART-003 (wishlist sharing), PAY-006 (PCI posture
confirmation), ORD-006 (order history retention), CAN-003
(cancellation reason capture), REF-004 (refund reason vs. return
reason), EXC-003 (exchange eligibility window), CUST-003 (internal
Customer 360 view scope), MKT-001 (marketing channels &
build-vs-integrate), CHAN-001 (channel publishing launch scope),
SEO-001 (URL structure), ANL-001 (analytics build-vs-integrate &
launch KPIs), NOTIF-001 (notification channels &
build-vs-integrate), IND-005 (free-shipping threshold), NFR-004
(accessibility conformance level), NFR-005 (browser/device support
matrix), NFR-006 (rate limiting targets).

---

## What happens after this questionnaire is answered

1. Update each decision's `Status`, `Final decision`, and `Decision
   date` in `DECISION_REGISTER.md`.
2. Update the corresponding spec(s) in `/specs` — move affected
   sections from their `DECISION_REQUIRED` blocks into approved
   content, and advance the spec's status per `CLAUDE.md` §3 (a spec
   can only move to `APPROVED` once all its `DECISION_REQUIRED` items
   relevant to the milestone at hand are resolved — see `READINESS.md`).
3. Re-run the readiness assessment in `READINESS.md` for the affected
   domains.
4. Only then does `BUILD_PLAN.md` unblock for that milestone — and
   only with explicit human authorization, per `CLAUDE.md` §0.
