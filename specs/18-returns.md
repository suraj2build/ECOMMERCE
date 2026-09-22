# 18. Returns

**Status:** APPROVED (decided 2026-09-22 — see `blueprint/DECISION_REGISTER.md` `RET-001`–`004`, `EXC-001`)

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
