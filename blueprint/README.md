# Product Blueprint V2 — Decision System

**Status update (2026-09-22): DECISIONS RESOLVED.** This directory was
originally a decision-support framework for an unresolved 112-item
register. The Product Owner's Blueprint V2 decision session has since
resolved 105 of those 112 decisions (7 remain `UNDER_REVIEW`, routed to
external compliance/legal verification — 0 remain genuinely `OPEN`).
**This still does not by itself authorize implementation** — see
`BUILD_PLAN.md`, which now shows most milestones
`READY_FOR_IMPLEMENTATION` but still requires a separate, explicit
human **START BUILD** authorization before any code is written (see
`blueprint/READINESS.md` for the full hierarchy of readiness states —
decision readiness is not the same thing as implementation
authorization).

## How to use this directory

1. **For current decision status**, go directly to
   `DECISION_REGISTER.md` — every decision's resolution (or
   `UNDER_REVIEW` status) is recorded there.
2. **For current readiness**, see `READINESS.md` — the authoritative,
   up-to-date per-milestone scorecard and the six-layer readiness
   hierarchy (decision status → spec status → milestone readiness →
   implementation authorization → compliance verification → production
   readiness).
3. `OPEN_QUESTIONS.md` is preserved as the **original, historical**
   questionnaire this register was built from — it is no longer an
   active task list; read its 2026-09-22 status banner before treating
   anything in it as unresolved.
4. For domain-specific deep dives (gap analyses, integrity models,
   role/journey design material), see the specialized documents below
   — each now carries its own 2026-09-22 status update where its
   original content was superseded by a decision.

## Files in this directory

| File | Purpose | Current status |
|---|---|---|
| `README.md` | This file — index, original audit findings, how to use the blueprint | Audit findings section is historical (labeled) |
| `DECISION_REGISTER.md` | Master register of all 112 decisions, with stable IDs | **Authoritative — 105 DECIDED, 7 UNDER_REVIEW, 0 OPEN** |
| `OPEN_QUESTIONS.md` | The original, historical Product Owner questionnaire | Answered — historical record only |
| `DEPENDENCY_MAP.md` | Cross-domain dependency analysis | Recommendations **adopted** into `BUILD_PLAN.md` |
| `END_TO_END_FLOWS.md` | Full cross-domain flow map: primary flow + 9 exception/post-purchase flows | Updated — see `acceptance/e2e-commerce-flows.md` for the current, testable version |
| `INDIA_COMMERCE_GAPS.md` | India-market-specific gap analysis, classified by BUSINESS/TECHNICAL/COMPLIANCE-LEGAL | Domain now owned by `specs/32-india-tax-invoicing.md`; compliance items remain `UNDER_REVIEW` |
| `FASHION_DOMAIN_GAPS.md` | Fashion-domain-specific gap analysis | All originally-identified gaps now `DECIDED` |
| `INVENTORY_INTEGRITY.md` | Conceptual inventory ledger model | All decisions it identified now `DECIDED` — see `specs/06-inventory.md` |
| `ORDER_PAYMENT_INTEGRITY.md` | Why order state and payment state are separate state machines | Shape now `DECIDED` — see `specs/13-payment.md`, `specs/14-order-management.md` |
| `CUSTOMER_360.md` | Conceptual Customer 360 data model and privacy implications | Mostly `DECIDED`; `CUST-001` retention policy remains `UNDER_REVIEW` |
| `OPERATING_ROLES.md` | Admin/operations personas and RBAC | **Adopted** as the approved `ADM-001` role list |
| `CUSTOMER_JOURNEYS.md` | Storefront customer journeys | Referenced decisions now `DECIDED` |
| `NON_FUNCTIONAL_REQUIREMENTS.md` | Structured NFR checklist | `NFR-001`–`006` now `DECIDED` (initial targets); some sub-items remain `TARGET_REQUIRED` |
| `READINESS.md` | Per-domain/per-milestone readiness scorecard | **Authoritative — rewritten 2026-09-22** |

---

## Documentation Audit Findings (HISTORICAL — as of the original audit, before 2026-09-22)

**Everything in this section describes the state of the repository
*before* the Product Owner's 2026-09-22 decision session.** It is
preserved verbatim as the audit record that justified creating
`specs/31`–`34` and the 112-item decision register. Where a finding
below says something is "missing," "unresolved," or "open," that was
true when this audit was performed — **it is very likely resolved
now**; check `blueprint/DECISION_REGISTER.md` and `blueprint/READINESS.md`
for current status before acting on anything in this section.

Performed against the existing foundation (`PRODUCT.md`,
`ARCHITECTURE.md`, `BUILD_PLAN.md`, `CLAUDE.md`, `AGENTS.md`,
`TESTING.md`, `SECURITY.md`, `DEPLOYMENT.md`, `docs/decisions/*`,
`specs/*`, `acceptance/*`). The prior documentation was **not** assumed
complete or internally consistent — this audit looked specifically for
the categories below. No business decisions were resolved during this
audit; every finding routes to a decision ID in `DECISION_REGISTER.md`
or is flagged as a genuine gap.

### Duplicated open questions (consolidated into single decision IDs)

The following questions were independently raised in **two different
specs**, unaware of each other. Each is now a single decision ID
referenced from both specs, rather than two separate unresolved
threads that could drift apart:

- **Cart reservation timing** — raised separately in
  `specs/06-inventory.md` and `specs/11-wishlist-cart.md` →
  consolidated as `INV-002`.
- **Exchange data model** (linked return+order vs. first-class entity)
  — raised separately in `specs/18-returns.md` and
  `specs/20-exchanges.md` → consolidated as `EXC-001`.
- **Loyalty + promotion stacking** — raised separately in
  `specs/22-loyalty.md` and `specs/23-promotions.md` → consolidated as
  `LOY-005`.
- **Marketing preference granularity** — raised separately in
  `specs/21-customer-profile.md` and `specs/24-marketing.md` →
  consolidated as `CUST-002`.
- **Multi-warehouse/multi-location support** — raised in
  `specs/06-inventory.md` and `specs/15-warehouse-fulfilment.md`, and
  implicitly relevant to `specs/04-purchase-orders.md` → consolidated
  as `ORG-002`/`INV-004` (kept as two IDs since they affect different
  specs, but must be decided together — see `DECISION_REGISTER.md`
  note).

### Missing domains (no owning spec at all) — RESOLVED, see note above

Both domains below now have owning specs (`specs/31`, `specs/32`,
created 2026-09-22); this subsection is kept for historical context
only.

- **India Tax / GST / Invoicing.** This is the most significant gap
  found. `specs/12-checkout.md` mentions "tax calculation approach —
  not yet decided" as one line item, but there is no spec anywhere
  covering GST registration model, HSN codes, MRP display
  requirements, GST-compliant invoice generation, or credit notes for
  returns/refunds. Given these are likely legal requirements (not
  optional scope) for a registered Indian seller, this gap is treated
  as high-priority — see the new `TAX-*` decision domain and the
  recommendation in `DEPENDENCY_MAP.md` §4 to give this its own
  workstream in `BUILD_PLAN.md`.
- **Organization / business entity model.** No spec owns "is this one
  legal entity, one brand?" — a foundational data-modeling question
  that affects product master, inventory, RBAC, and tax registration.
  See `ORG-001`, `ORG-002`.
- **Product media requirements** (image count/ordering, video,
  swatches, variant imagery). See `FASHION_DOMAIN_GAPS.md`.
- **Size chart & size-chart versioning.** See `PROD-004`,
  `FASHION_DOMAIN_GAPS.md`.
- **Bulk product operations** (bulk price change, bulk publish). See
  `PROD-006`.
- **"Recently viewed" and "customer service history"** as Customer 360
  data domains. See `CUSTOMER_360.md` §1.
- **Damaged-item-reported-post-delivery** as a named flow distinct
  from a standard return. See `END_TO_END_FLOWS.md` flow 14.

### Ambiguous ownership

- **Catalog browsing category vs. product attribute category**
  (`specs/07-catalog-merchandising.md` vs. `specs/02-product-master.md`)
  — both specs mention "category" without clarifying if it's one
  taxonomy or two. Consolidated as `CAT-003`.
- **Merchandiser vs. Catalog Manager** admin roles — `OPERATING_ROLES.md`
  surfaces these as two candidate roles with significant overlap; the
  Product Owner should confirm whether they're one role or two.
- **Customer Service's Customer 360 view vs. the customer's own
  self-service profile** (`specs/21-customer-profile.md` vs.
  `specs/28-admin.md`) — not previously distinguished. See `CUST-003`.

### Missing cross-domain dependencies (now made explicit)

- `PAY-002` (payment state machine) depends on `ORD-001` (order state
  machine) conceptually, but `BUILD_PLAN.md` sequences Payment (M13)
  before Order Management (M14) for build purposes. This is a
  design-time dependency that wasn't previously flagged — see
  `DEPENDENCY_MAP.md` §3.4 and `ORDER_PAYMENT_INTEGRITY.md`.
- `ORG-001`/`ORG-002` sit upstream of Product Master (M02) but weren't
  previously identified as needing resolution before M02 rather than
  during it.
- The full dependency graph is in `DEPENDENCY_MAP.md`.

### Prematurely approved assumptions

**None found.** All 31 specs in `/specs` are correctly `DRAFT` except
`specs/00-platform-overview.md`, which is `APPROVED` only as a
scope/index document restating already-approved architecture — it
contains no business rules. All 15 ADRs cover technology/architecture
decisions that the original founding brief explicitly authorized as
approvable (`ARCHITECTURE.md`, `AGENTS.md` decision-authority matrix).
This audit found no case of a business rule being marked `APPROVED`
without Product Owner sign-off.

### Missing fashion-specific requirements

See `FASHION_DOMAIN_GAPS.md` for the full analysis. Summary: the core
attribute taxonomy is well-represented; the real gaps are size charts,
product media rules, product lifecycle/QA gating, bulk operations, and
replacement-SKU-reservation timing during exchanges.

### Missing India-specific commerce requirements

See `INDIA_COMMERCE_GAPS.md` for the full analysis, classified by
BUSINESS REQUIREMENT / TECHNICAL REQUIREMENT / COMPLIANCE-LEGAL
QUESTION REQUIRING VERIFICATION. Summary: GST/HSN/MRP/invoicing is a
missing domain entirely; COD reconciliation, PIN-code serviceability,
and address structure are mentioned only glancingly in existing specs.

### Missing operational workflows

- **Cycle count / stock take** (periodic physical inventory
  reconciliation) — not mentioned anywhere. See `INV-007`.
- **PO approval workflow specifics** (thresholds, multi-level
  approval) — named as open in `specs/04-purchase-orders.md` but not
  further decomposed until this audit. See `PO-001`.
- **Manual inventory adjustment authorization** — implied by the
  ledger's `adjustment` transaction type but no workflow/approval
  process defined. See `ADM-003`.

### Missing exception scenarios

`specs/14-order-management.md` refers generally to "exceptions"
without enumerating them. This audit named the following specific
scenarios, each now documented in `END_TO_END_FLOWS.md`: **RTO**
(flow 13), **damaged item reported post-delivery** (flow 14, a
genuinely new scenario not previously named), **partial
delivery/return/refund** (flow 15), **payment
failure/pending/duplicate** (flow 16), and **inventory shortage
discovered after order confirmation** (flow 17).

### Missing financial/inventory integrity considerations

- **Idempotency and webhook-deduplication were named as open
  questions in `specs/13-payment.md` but not treated with the urgency
  their financial-integrity risk warrants.** This audit elevates
  `PAY-003` to P0 and gives it a dedicated treatment in
  `ORDER_PAYMENT_INTEGRITY.md`.
- **The inventory ledger's transaction type list (`INV-001`) was
  referenced as "not exhaustive" in `specs/06-inventory.md` but never
  actually enumerated as a working draft.** This audit produces that
  working draft in `INVENTORY_INTEGRITY.md` §2, explicitly for Product
  Owner confirmation rather than as a final schema.
- **Payment state and order state were not explicitly distinguished
  anywhere** — `specs/13-payment.md` and `specs/14-order-management.md`
  each describe "a status lifecycle" without stating they are two
  separate state machines. This is flagged as a likely-by-default
  implementation mistake risk and given a dedicated document,
  `ORDER_PAYMENT_INTEGRITY.md`.

---

## Future considerations (explicitly out of current scope)

Per the research-boundary instruction governing this exercise: the
following are potentially useful ideas that surfaced while analyzing
the domain but are **not** part of approved scope and are **not**
added as requirements or decision IDs. They're recorded here only so
they aren't silently lost, and so a future scoping exercise doesn't
have to rediscover them from nothing.

- AR/virtual try-on or size-recommendation ML — noted while analyzing
  size/fit (`PROD-004`), not proposed as a requirement.
- Marketplace/multi-seller model — noted while analyzing `ORG-001`,
  explicitly not recommended given the "independent platform" framing
  in `PRODUCT.md`.
- Supplier self-service portal beyond basic PO confirmation — noted in
  `SUP-002`, kept as P2/optional.
- Subscription or repeat-purchase commerce models — not mentioned
  anywhere in `PRODUCT.md`'s scope; noted here only for completeness.
- Live chat customer support — noted while analyzing Customer Service
  role in `OPERATING_ROLES.md`; current scope only implies
  ticket/order-based support.
- Referral programs — adjacent to loyalty (`LOY-001`) but not part of
  the stated loyalty scope; noted for future consideration only.

---

## Relationship to `/specs`

This blueprint **does not replace** `/specs` — it is a working layer
on top of it. As originally created (before 2026-09-22), `/specs`
files were only lightly updated to reference decision IDs, and no
`DRAFT` spec was changed to `APPROVED` — that was correct for that
stage, since no decisions had been made yet.

**This changed on 2026-09-22.** Following the Product Owner's decision
session, `/specs` files were updated with normative (MUST/MUST NOT/
SHOULD/MAY) requirement text reflecting each resolved decision, and
most specs advanced to `APPROVED` — see each spec's own status line,
`specs/00-platform-overview.md`'s index table, and
`blueprint/READINESS.md` for current status. No spec was marked
`APPROVED` where a genuine compliance/legal dependency within its own
scope remains unresolved (`specs/21-customer-profile.md`,
`specs/30-audit-compliance.md`, `specs/32-india-tax-invoicing.md`
remain below `APPROVED` for exactly that reason).
