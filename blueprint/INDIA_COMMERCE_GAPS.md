# India Commerce Gap Analysis

**Purpose:** Product requirement gap analysis for India-market-specific
commerce requirements, since India is the initial target market
(`PRODUCT.md`). Every item below is classified as one of:

- **BUSINESS REQUIREMENT** — a policy choice the Product Owner makes;
  no legal constraint, purely a business decision.
- **TECHNICAL REQUIREMENT** — an implementation detail following from
  a business or compliance decision; not itself uncertain once the
  upstream decision is made.
- **COMPLIANCE/LEGAL QUESTION REQUIRING VERIFICATION** — this
  repository **does not** assert a settled legal position. These items
  need verification with a qualified tax/legal professional before any
  implementation decision is made. Nothing in this document should be
  read as legal advice or as a confirmed regulatory requirement.

None of the items below currently have an owning spec unless noted —
this entire document is itself a gap-discovery exercise per the task
that produced it.

## GST (Goods and Services Tax)

| Item | Classification | Notes | Decision ID |
|---|---|---|---|
| GST registration status (single/multi-state) | **COMPLIANCE/LEGAL — VERIFY** | Determines CGST/SGST vs. IGST logic | `TAX-001` |
| Tax computation approach (per-line HSN-rate lookup vs. flat rate) | TECHNICAL (follows from TAX-001) | | `TAX-001` |
| GST-compliant invoice format/fields | **COMPLIANCE/LEGAL — VERIFY** | No spec currently owns invoice generation | `TAX-004` |
| Credit note requirements on return/refund/cancellation | **COMPLIANCE/LEGAL — VERIFY** | No spec currently owns this | `TAX-005` |
| GST return filing support (e.g., data export for GSTR filings) | **COMPLIANCE/LEGAL — VERIFY**, likely out of initial scope but should be flagged | Not currently mentioned anywhere in `/specs` | *(no ID yet — recommend adding if confirmed in scope)* |

## HSN (Harmonized System of Nomenclature)

| Item | Classification | Notes | Decision ID |
|---|---|---|---|
| HSN code requirement (whether required, and at what turnover threshold) | **COMPLIANCE/LEGAL — VERIFY** | Thresholds change over time; do not hard-code an assumed digit-length requirement | `TAX-003` |
| HSN code assignment mechanism (category default vs. per-SKU) | TECHNICAL (follows from TAX-003) | | `TAX-003` |

## MRP (Maximum Retail Price)

| Item | Classification | Notes | Decision ID |
|---|---|---|---|
| MRP display requirement for pre-packaged goods | **COMPLIANCE/LEGAL — VERIFY** | Legal Metrology Act implications; verify applicability to the platform's specific product categories | `TAX-002` |
| MRP vs. selling price presentation (strikethrough, "you save") | BUSINESS REQUIREMENT (once MRP legal question is resolved) | | `TAX-002` |

## Inclusive/exclusive tax handling

| Item | Classification | Notes | Decision ID |
|---|---|---|---|
| Tax-inclusive vs. tax-exclusive product pricing display | BUSINESS REQUIREMENT (India market norm is inclusive, but confirm) | | `CAT-001` |

## Discount presentation

| Item | Classification | Notes | Decision ID |
|---|---|---|---|
| Pre-tax vs. post-tax discount application on invoice | TECHNICAL, but has GST accounting implications — **VERIFY** the accounting treatment | | `TAX-006` |

## Invoicing

| Item | Classification | Notes | Decision ID |
|---|---|---|---|
| Invoice generation trigger point in order lifecycle | BUSINESS REQUIREMENT (once legal format is verified) | Currently no spec owns this — see `DEPENDENCY_MAP.md` recommendation for a dedicated tax/invoicing workstream | `TAX-004` |
| Invoice numbering sequence requirements | **COMPLIANCE/LEGAL — VERIFY** | | `TAX-004` |

## Credit notes

| Item | Classification | Notes | Decision ID |
|---|---|---|---|
| Credit note issuance on return/refund/cancellation | **COMPLIANCE/LEGAL — VERIFY** | | `TAX-005` |

## COD (Cash on Delivery)

| Item | Classification | Notes | Decision ID |
|---|---|---|---|
| COD availability rules (value cap, PIN-code exclusions) | BUSINESS REQUIREMENT | Already an approved payment method per ADR-0011; operational rules undefined | `IND-001` |
| COD reconciliation process (cash collected by delivery partner vs. platform ledger) | TECHNICAL + BUSINESS | Not currently mentioned in any spec | `IND-001` |
| COD refund mechanism | BUSINESS REQUIREMENT | Explicitly flagged in `ARCHITECTURE.md` §9 as needing a first-class answer | `REF-001` |

## RTO (Return to Origin)

| Item | Classification | Notes | Decision ID |
|---|---|---|---|
| RTO handling and reconciliation | BUSINESS REQUIREMENT | See `END_TO_END_FLOWS.md` flow 13 | `ORD-003` |

## Shipping charges & free-shipping thresholds

| Item | Classification | Notes | Decision ID |
|---|---|---|---|
| Shipping charge policy | BUSINESS REQUIREMENT | | `CHK-003` |
| Free-shipping threshold | BUSINESS REQUIREMENT | | `IND-005` |

## PIN-code serviceability

| Item | Classification | Notes | Decision ID |
|---|---|---|---|
| Serviceability data source (carrier API vs. static list) | TECHNICAL | Depends on carrier selection | `IND-002` |
| At what point serviceability is checked (PDP/cart/checkout) | BUSINESS REQUIREMENT (UX decision) | | `IND-002` |

## Address structure

| Item | Classification | Notes | Decision ID |
|---|---|---|---|
| Indian address field set (house/flat, locality, landmark, city, state, PIN) | TECHNICAL | Common pattern, low ambiguity once confirmed | `IND-003` |
| PIN-code-to-city/state auto-complete | TECHNICAL | Nice-to-have UX; not yet scoped | `IND-003` |

## Indian mobile numbers & OTP authentication

| Item | Classification | Notes | Decision ID |
|---|---|---|---|
| Mobile number as primary identity field | BUSINESS REQUIREMENT | Strongly recommended for India market but not yet decided | `AUTH-001` |
| OTP delivery provider/mechanism | TECHNICAL | Not yet scoped — no SMS/OTP provider decision exists anywhere in `/specs` | `AUTH-001` |

## Payment rails: UPI, cards, net banking, wallets

| Item | Classification | Notes | Decision ID |
|---|---|---|---|
| Which rails are exposed via Razorpay at launch | BUSINESS REQUIREMENT | Razorpay itself supports all of these; platform must decide which to enable | `IND-004` |

## Customer communication — cancellation/return information

| Item | Classification | Notes | Decision ID |
|---|---|---|---|
| Consumer-facing disclosure of cancellation/return policy (a common e-commerce consumer-protection expectation in India) | **COMPLIANCE/LEGAL — VERIFY** whether specific disclosure requirements apply | Not currently addressed in any spec | *(recommend adding to `RET-001` scope once verified)* |

## Data/privacy requirements

| Item | Classification | Notes | Decision ID |
|---|---|---|---|
| Applicable data-protection law and its specific obligations | **COMPLIANCE/LEGAL — VERIFY** | Explicitly flagged as unresolved in `specs/21-customer-profile.md` and `specs/30-audit-compliance.md` | `AUD-002`, `CUST-001` |

## Product declarations / legal metrology / labeling

| Item | Classification | Notes | Decision ID |
|---|---|---|---|
| Country-of-origin declaration | **COMPLIANCE/LEGAL — VERIFY** | Partially covered as a product attribute in `specs/02-product-master.md` but the *display/declaration requirement* itself is unverified | `TAX-003` (related), *(no dedicated ID — recommend adding under Legal Metrology if confirmed in scope)* |
| Fabric composition / wash care labeling declaration on PDP | **COMPLIANCE/LEGAL — VERIFY** | Attributes exist in `specs/02-product-master.md` (fabric, wash care) but legal *display requirement* on the PDP is unverified | *(no dedicated ID — recommend adding if confirmed)* |
| Legal Metrology (Packaged Commodities) Rules applicability | **COMPLIANCE/LEGAL — VERIFY** | Same underlying question as MRP (`TAX-002`) | `TAX-002` |

---

## Summary

This gap analysis surfaces **an entire missing domain** (India
tax/GST/invoicing — see `TAX-*` decisions) that has no owning spec in
`/specs` today, plus a cluster of India-market-specific commerce
details (COD reconciliation, PIN serviceability, address structure,
mobile/OTP identity) that are referenced only glancingly in existing
specs. See `DEPENDENCY_MAP.md` §4 for the recommendation to the
Product Owner about inserting a dedicated tax/invoicing workstream
into `BUILD_PLAN.md`.

**No compliance/legal question in this document has been treated as
settled.** Every such item is explicitly marked for verification with
a qualified professional before it informs implementation.
