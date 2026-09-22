# M05 — GRN / QC Acceptance Criteria

**Spec(s):** `specs/05-grn.md`
**Status:** READY_FOR_IMPLEMENTATION

## Business acceptance

- [ ] A GRN can be created against an approved PO, recording received
      quantity per line, with short/excess/damaged/rejected outcomes
      each representable.
- [ ] QC pass/fail is recorded per received unit or batch, gating
      whether stock becomes sellable.

## Functional acceptance

- [ ] Full and partial receipt against a PO are both supported.
- [ ] A QC-fail outcome triggers a configurable resolution path
      (supplier debit/credit note, return-to-supplier, write-off) —
      the *capability* to select a path is required; the specific
      business rule per supplier/category is configuration.

## Data integrity (binding — feeds inventory ledger)

- [ ] A QC-passed GRN line posts a `receipt` inventory ledger
      transaction (`acceptance/m06-inventory.md`); a QC-failed line
      posts a `damaged` transaction or is excluded — **never** silently
      added to sellable `ON_HAND`.
- [ ] The sum of GRN received quantities across all GRNs against one PO
      never exceeds the PO's ordered quantity plus its configured
      excess-tolerance threshold, without being flagged as an
      exception.

## Authorization

- [ ] Only Warehouse Manager/Operator roles can record a GRN.
- [ ] QC-fail disposition decisions above a configurable value require
      Warehouse Manager sign-off, not Operator alone.

## Auditability

- [ ] Every GRN and its QC outcome is fully audited, linked to the
      originating PO.

## Positive scenarios

1. Receive a PO in full, all lines QC-pass → PO reaches
   `fully_received`, inventory reflects the receipt.
2. Receive a PO partially (60%), remainder received in a second GRN a
   week later → both GRNs correctly linked to the same PO, inventory
   ledger shows two distinct `receipt` transactions.
3. A batch fails QC → `damaged` transaction posted, stock does **not**
   appear as available.

## Negative scenarios / edge cases

1. Attempt to receive more than the PO's tolerance-adjusted quantity →
   flagged as an exception, not silently accepted.
2. Attempt to record a GRN against a `cancelled` PO → blocked.

## Concurrency

- [ ] Two GRN entries submitted concurrently for the same PO line do
      not corrupt the PO's remaining-quantity calculation (both
      persist correctly, remaining quantity is accurate after both).

## Test requirements

- [ ] Unit tests: tolerance calculation, QC pass/fail branching.
- [ ] Integration tests: GRN → inventory ledger posting
      (`acceptance/e2e-commerce-flows.md` FLOW 1).

## Definition of Done

All boxes above checked, plus `acceptance/README.md`.
