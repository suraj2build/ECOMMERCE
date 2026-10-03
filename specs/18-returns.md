# 18. Returns

**Status:** IMPLEMENTED (M19 build complete 2026-09-25, engineering
scope, repaired 2026-09-26 per independent review (mobile evidence
upload) — see `blueprint/DECISION_REGISTER.md` `RET-001`–`005`,
`EXC-001`; `VERIFIED` pending independent re-review, not self-declared)

## Purpose

Define the post-delivery return process: eligibility, initiation,
reverse logistics, quality inspection, and disposition.

## Scope

- Return eligibility rules
- Return initiation
- Reverse logistics
- Quality inspection on arrival
- Disposition: restock, damage, dispose
- Handoff to refunds

## Approved requirements (2026-09-22)

- **Default return window: 7 days after product delivery.** **MUST be
  configurable by category/product** — not one global hard-coded
  policy. Some categories/items **can be non-returnable** (example:
  innerwear).
- **Return reason selection is mandatory.**
- Return workflow **MUST support warehouse return receipt and QC.**
  Refund eligibility follows successful return/QC per configured
  policy — no refund fires before the QC gate (see `specs/19-refunds.md`).
- Self-service return initiation is available through the customer's
  account, with Customer-Service-assisted initiation also available.
- Reverse logistics defaults to carrier pickup from the customer
  address (via `specs/16-shipping-tracking.md`'s carrier abstraction),
  with customer drop-off as a configurable alternative where available.
- Every return disposition outcome (restock sellable, restock as
  marked-down/damaged, write-off, return-to-supplier) MUST post the
  correct inventory ledger entry (`specs/06-inventory.md` `INV-006`) —
  never automatic re-entry to sellable stock without QC.
- **Exchange (`specs/20-exchanges.md`) is modeled as a first-class
  Exchange entity**, not merely a linked return+new-order pair (see
  `EXC-001`) — this resolves the previously duplicated open question
  in this spec and `specs/20-exchanges.md`.

## Remaining open items

None for the operational rules above. **Consumer-facing disclosure of
the return/cancellation policy** (a common Indian e-commerce consumer-
protection expectation) remains a **COMPLIANCE/LEGAL QUESTION
REQUIRING VERIFICATION** — see `blueprint/INDIA_COMMERCE_GAPS.md` and
`specs/32-india-tax-invoicing.md`. It does not block building the
return workflow itself; it governs what policy text/disclosure must be
shown to the customer, which should be finalized alongside the other
compliance-verification items before production launch.

## Acceptance criteria

See `acceptance/m19-returns.md`.

## Dependencies

Depends on: `specs/14-order-management.md`, `specs/16-shipping-tracking.md`,
`specs/06-inventory.md`. Feeds: `specs/19-refunds.md`, `specs/20-exchanges.md`.

## Launch readiness addendum (2026-10-03) — IMPLEMENTING

Return-condition photos can be stored in S3-compatible object storage (`RETURN_EVIDENCE_STORAGE=s3`, SigV4, private objects, reads only through the ownership-checked route). Production refuses local-disk storage (`LR-005`).

### Implementation (2026-10-03) — evidence storage

`RETURN_EVIDENCE_STORAGE=s3` selects `S3EvidenceStorageProvider`
(`services/commerce-api/src/modules/returns/evidence-storage.ts`), which
writes each photo as a private object (no ACL) under
`RETURN_EVIDENCE_S3_PREFIX` + a server-generated UUID in
`RETURN_EVIDENCE_S3_BUCKET`, through the existing `S3_ENDPOINT`/`S3_REGION`/
`S3_ACCESS_KEY`/`S3_SECRET_KEY` settings (AWS Signature V4, no SDK; works
with AWS S3 and S3-compatible stores). Reads still go only through the
ownership-checked evidence route. With `local` (the default for development
and tests), production refuses to store or read evidence and says why; the
storage is resolved on first use, so the API still starts.
Tests: `test/integration/evidence-storage-s3.test.ts` (6, against a real S3
API server — moto — locally and in CI: round trip, shared between
instances, private, server-generated keys only, missing object, production
refusal of local disk) and `test/unit/s3-signing.test.ts` (the signer
reproduces AWS's published SigV4 example signature). Not yet verified
against the production bucket: none is configured.
