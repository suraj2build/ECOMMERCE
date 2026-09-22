# M08 — Tax & Invoicing Foundation Acceptance Criteria

**Spec(s):** `specs/32-india-tax-invoicing.md`
**Status:** **BLOCKED** — see below. This document separates what can
be built/tested now from what cannot be finalized until compliance
verification completes (`TAX-001`–`005` in
`blueprint/DECISION_REGISTER.md`).

## Engineering-scaffolding acceptance (testable now)

- [ ] A tax-computation engine exists that accepts a configurable
      rate/rule set and computes line-item tax on an order, without
      any tax rate or CGST/SGST/IGST logic hard-coded in checkout or
      order code.
- [ ] Switching the configured rule set (e.g., from a placeholder rate
      to a different one) changes computed tax with **no code
      deployment**.
- [ ] An HSN field exists on the product schema (nullable) and is
      readable by the tax engine when present.
- [ ] An invoice document is generated at order confirmation using a
      **versioned template** and a **configurable numbering sequence**;
      regenerating with a different template version does not corrupt
      previously-issued invoice numbers.
- [ ] A credit-note document is generated and linked to the original
      invoice for a qualifying cancellation/return/refund, using the
      same versioned-template mechanism.
- [ ] Discount pre-tax/post-tax application is a configurable flag,
      not hard-coded.

## Compliance-dependent acceptance (BLOCKED — cannot be finalized yet)

The following **cannot** be marked done until a qualified tax/legal
professional confirms the underlying rule, per
`blueprint/DECISION_REGISTER.md` `TAX-001`–`005`:

- [ ] GST registration model (single/multi-state) and CGST/SGST/IGST
      determination rule are configured to the **legally verified**
      values (not a placeholder).
- [ ] MRP disclosure display meets confirmed Legal Metrology
      requirements.
- [ ] HSN code mandatoriness/threshold/digit-length is confirmed and
      enforced (or correctly not enforced, if confirmed not applicable
      at current scale).
- [ ] Invoice format matches the legally confirmed required-field set
      and numbering rules.
- [ ] Credit note format matches the legally confirmed required-field
      set.

**This milestone is BLOCKED as a whole** because its core purpose —
legally correct GST computation and documentation — cannot be
certified done while these five items remain `UNDER_REVIEW`. The
engineering-scaffolding items above MAY be built and tested during
other milestones' development (they are prerequisites those milestones
need), but this milestone itself is not closeable until verification
completes.

## Test requirements (for the scaffolding portion only)

- [ ] Unit tests: tax computation against a range of configured rule
      sets (not asserting any specific rate is "correct" — asserting
      the engine correctly applies whatever rule it's configured
      with).
- [ ] Integration tests: invoice/credit-note generation and linkage.

## Definition of Done

**Not achievable until external compliance verification completes.**
See `blueprint/README.md` for the recommended next step (engage a
qualified tax/GST professional).
