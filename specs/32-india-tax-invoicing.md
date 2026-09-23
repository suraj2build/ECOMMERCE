# 32. India Tax / GST / Invoicing

**Status:** APPROVED for the engineering-architecture requirements
only (Product Owner "START BUILD — PHASE 2" instruction, 2026-09-23,
explicitly directs this configurable-architecture approach in detail —
see M08 in `BUILD_PLAN.md`). **Core legal/compliance content remains
UNDER_REVIEW pending qualified professional verification** and MUST
NOT be implemented as final. `TAX-001` through `TAX-005` in
`blueprint/DECISION_REGISTER.md` gate *production configuration*
(real GSTIN/rate/HSN values), not the build of the configurable
engine itself — the engine is required to fail safely whenever that
configuration is absent, precisely so it can be built now without
resolving the compliance questions. See
`blueprint/INDIA_COMMERCE_GAPS.md`.

## Purpose

Own India GST/tax computation, MRP/pricing-disclosure compliance, HSN
classification, and GST-compliant invoice and credit-note generation.
This spec did not exist in the original 31-spec index — it was
identified as the single largest missing domain during the Product
Blueprint V2 audit and is created now per explicit Product Owner
instruction (§28), which required it "at minimum."

## Critical framing

**Nothing in this spec asserts a settled legal position.** Every
requirement below is either (a) an **engineering architecture
requirement** — decided, and safe to build regardless of the eventual
legal specifics, because it is designed to be reconfigured without a
redesign — or (b) explicitly marked **COMPLIANCE/LEGAL QUESTION
REQUIRING VERIFICATION**, meaning it must not be implemented as final
until a qualified tax/legal professional confirms it.

## Approved engineering architecture requirements (DECIDED)

- The platform MUST implement tax computation as a **pluggable,
  configurable engine**, not hard-coded rates or logic scattered
  across checkout/order code. It MUST support line-item, HSN-rate-based
  computation.
- The platform MUST be able to determine CGST/SGST vs. IGST
  applicability per order via a **configurable rule** (parameterized by
  shipping state and registration state), without requiring a code
  change to adjust the rule once the registration model (`TAX-001`) is
  confirmed.
- Pricing MUST display MRP and selling price, tax-inclusive, per
  `specs/07-catalog-merchandising.md` `CAT-001`.
- The product schema MUST include an HSN code field at the
  category-default and per-SKU-override level (nullable/configurable
  until `TAX-003` confirms exact requirements), per
  `specs/02-product-master.md`.
- The platform MUST generate an invoice-equivalent document per order
  at order confirmation, using a **versioned, configurable template**
  and a **configurable numbering sequence** — so the legally-verified
  final format can be applied without an architecture change. See
  `specs/14-order-management.md`.
- The platform MUST generate a credit-note-equivalent document linked
  to the original invoice for every cancellation, return, or refund
  that reduces the order value, using the same versioned/configurable
  template approach. See `specs/17-cancellation.md`,
  `specs/19-refunds.md`.
- Discount presentation on the invoice (pre-tax vs. post-tax) MUST be
  a configurable computation flag, defaulting to pre-tax application
  (engineering default per `TAX-006`), switchable without a redesign.

## COMPLIANCE/LEGAL QUESTIONS REQUIRING VERIFICATION (UNDER_REVIEW)

The following MUST NOT be treated as decided, implemented as final, or
silently approved. Each requires a qualified tax/legal professional's
confirmation before the corresponding engineering-ready capability
above is parameterized for production use:

- **`TAX-001`** — GST registration model (single- vs. multi-state) and
  the exact CGST/SGST/IGST determination rule.
- **`TAX-002`** — MRP disclosure requirements under the Legal
  Metrology (Packaged Commodities) Rules, as applicable to this
  platform's specific product categories.
- **`TAX-003`** — Whether HSN codes are mandatory given the business's
  turnover, and at what digit-length/granularity.
- **`TAX-004`** — The exact required fields and numbering-sequence
  rules for a GST-compliant tax invoice.
- **`TAX-005`** — The exact required fields and linkage rules for a
  GST credit note.

See `blueprint/DECISION_REGISTER.md` for full context on each, and
`blueprint/INDIA_COMMERCE_GAPS.md` for the classification of every
related India-commerce item (business / technical / compliance-legal).

## Acceptance criteria

Not yet defined for the compliance-dependent portions of this spec —
see `acceptance/m08-tax-invoicing-foundation.md` for the
engineering-scaffolding acceptance criteria that **can** be satisfied
now (configurable engine exists, schema fields exist, template
mechanism exists), separate from the legal-correctness criteria that
cannot be finalized until verification completes.

## Dependencies

Depends on: `specs/31-organization-locations.md` (registration may be
location/state-dependent), `specs/02-product-master.md` (HSN field),
`specs/07-catalog-merchandising.md` (MRP/pricing display). Feeds:
`specs/12-checkout.md` (tax computation), `specs/14-order-management.md`
(invoicing), `specs/17-cancellation.md`, `specs/19-refunds.md` (credit
notes).
