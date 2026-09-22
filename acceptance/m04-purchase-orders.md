# M04 — Purchase Orders Acceptance Criteria

**Spec(s):** `specs/04-purchase-orders.md`
**Status:** READY_FOR_IMPLEMENTATION

## Business acceptance

- [ ] A PO can be created against a supplier for a set of SKUs with
      quantities and unit cost, referencing a receiving Location.
- [ ] PO approval workflow is enforced: a PO above a configurable
      value threshold requires a second approver before becoming
      `approved`.
- [ ] Purchase cost is captured and retrievable for margin analysis
      (feeds `acceptance/m28-analytics-reporting.md`).

## Functional acceptance

- [ ] PO status lifecycle: `draft -> submitted -> approved | rejected
      -> partially_received -> fully_received -> closed`, plus
      `cancelled` from any pre-receipt state.
- [ ] Partial receipt is supported — a PO can move through multiple
      GRN events before reaching `fully_received`.

## Data integrity

- [ ] A PO's total committed quantity/cost is always derivable from its
      line items — no separate mutable summary field that can drift.

## Authorization

- [ ] Only Buying can create/submit a PO; only roles with approval
      permission (per the configurable threshold) can approve.
- [ ] A Buyer cannot approve their own PO above the threshold (control
      separation).

## Auditability

- [ ] Every PO state transition (submit, approve, reject, cancel) is
      audited with actor and timestamp.

## Positive scenarios

1. Create a PO below the approval threshold → single approver
   sufficient → `approved`.
2. Create a PO above the threshold → requires second approver →
   blocked until obtained → then `approved`.
3. Partially receive a PO (see `acceptance/m05-grn.md`) → PO correctly
   shows `partially_received` with remaining outstanding quantity.

## Negative scenarios / edge cases

1. Buyer attempts to self-approve an above-threshold PO → blocked.
2. Attempt to submit a PO with zero line items → blocked.
3. Attempt to receive against a `cancelled` PO → blocked.

## API / Database behavior

- [ ] PO line items are relational, queryable independently (for
      partial-receipt tracking) — not a single JSON blob.

## Security

- [ ] Financial approval-threshold configuration is editable only by
      Finance/Business Admin.

## Test requirements

- [ ] Unit tests: PO state machine transitions, threshold-approval
      logic.
- [ ] Integration tests: PO → partial GRN → PO status update loop
      (`acceptance/e2e-commerce-flows.md` FLOW 1).

## Definition of Done

All boxes above checked, plus `acceptance/README.md`.
