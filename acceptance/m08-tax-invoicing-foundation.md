# M08 — Tax & Invoicing Foundation Acceptance Criteria

**Spec(s):** `specs/32-india-tax-invoicing.md`
**Status:** Engineering-scaffolding portion **IMPLEMENTED** (Phase 2
build, 2026-09-23) and covered by
`services/commerce-api/test/integration/tax-invoicing.test.ts` (19
tests). The milestone as a whole remains **BLOCKED** for the
compliance-dependent portion below — see below. This document
separates what can be built/tested now from what cannot be finalized
until compliance verification completes (`TAX-001`–`005` in
`blueprint/DECISION_REGISTER.md`).

## Engineering-scaffolding acceptance (testable now)

- [x] A tax-computation engine exists that accepts a configurable
      rate/rule set and computes line-item tax on an order, without
      any tax rate or CGST/SGST/IGST logic hard-coded in checkout or
      order code. See `modules/tax/tax-engine.ts` (pure functions,
      zero hard-coded rates) + `modules/tax/service.ts`
      (`TaxConfigService.resolveTaxRate`/`resolveSupplierRegistration`,
      reading `TaxRate`/`GstRegistration` configuration rows).
- [x] Switching the configured rule set (e.g., from a placeholder rate
      to a different one) changes computed tax with **no code
      deployment**. Proven by "keeps a previously issued invoice
      unchanged after the tax rate reference data later changes" -
      a new `TaxRate` row changes what a *new* invoice computes without
      any code change, while never mutating an already-issued one.
- [x] An HSN field exists on the product schema (nullable) and is
      readable by the tax engine when present. `Style.hsnCode`
      (style/category default) + `Sku.hsnCode` (per-SKU override,
      added M08) - `InvoiceService` resolves `sku.hsnCode ?? style.hsnCode`
      and fails safe (`TaxConfigurationError`) when both are absent.
- [x] An invoice document is generated using a **versioned template**
      (`Invoice.templateVersion`) and a **configurable, financial-year-
      scoped, concurrency-safe numbering sequence**
      (`InvoiceService.nextDocumentNumber`, advisory-lock + per-FY
      count, proven safe under 15-way concurrent issuance with zero
      duplicate/colliding numbers). Full generation-at-order-
      confirmation wiring is M15's job (Order doesn't exist yet); M08
      exposes `InvoiceService.issueInvoice()` as the entry point M15
      will call directly.
- [x] A credit-note document is generated and linked to the original
      invoice (`CreditNote.originalInvoiceId` FK, `CreditNoteLine.invoiceLineId`
      FK) using the same versioned-template mechanism, proportionally
      reducing the original line's *frozen* amounts (never re-resolving
      current tax reference data).
- [x] Discount pre-tax/post-tax application is a configurable flag
      (`InvoiceLineInput.discountAppliedPreTax`), not hard-coded;
      defaults to pre-tax per TAX-006.

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

- [x] Unit/integration tests: tax computation against a range of
      configured rule sets (not asserting any specific rate is
      "correct" — asserting the engine correctly applies whatever rule
      it's configured with, including intra-state CGST+SGST vs
      inter-state IGST, effective-date boundaries, and missing-
      configuration fail-safety).
- [x] Integration tests: invoice/credit-note generation and linkage,
      invoice-number and credit-note-number concurrency (15/10-way),
      duplicate-invoice-per-order rejection, and HTTP-layer RBAC.
      See `services/commerce-api/test/integration/tax-invoicing.test.ts`.

## Definition of Done

The **engineering-scaffolding acceptance** section above is DONE
(2026-09-23, Phase 2 build). The milestone's full Definition of Done —
the **compliance-dependent acceptance** section — is **not achievable
until external compliance verification completes.**
See `blueprint/README.md` for the recommended next step (engage a
qualified tax/GST professional).
