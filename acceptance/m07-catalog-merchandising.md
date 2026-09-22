# M07 — Catalog / Merchandising / Pricing Acceptance Criteria

**Spec(s):** `specs/07-catalog-merchandising.md`
**Status:** READY_FOR_IMPLEMENTATION

## Business acceptance

- [ ] Every SKU displays MRP and selling price, tax-inclusive.
- [ ] Price is identical across all sizes of the same style-colour (no
      size-based pricing).
- [ ] Scheduled markdown pricing activates/deactivates automatically at
      its configured start/end date-time, with no manual intervention
      required at the boundary.
- [ ] **A price change made today does not alter the recorded value of
      any order placed before the change** — verified by placing an
      order, then changing the product price, then confirming the
      order's recorded total is unchanged.

## Functional acceptance

- [ ] Publish requires both the automated QA-completeness gate
      (`acceptance/m02-product-master.md`) and an explicit Merchandiser
      publish action — neither alone is sufficient (test both
      independently: QA-incomplete + merchandiser-clicks-publish is
      blocked; QA-complete + no merchandiser action stays unpublished).
- [ ] Catalog browsing category and product attribute category are the
      same underlying taxonomy (a change in one is immediately visible
      in the other, because they are the same data, not synced
      copies).
- [ ] Merchandising badges compute correctly from their rule (e.g.,
      "New Arrival" clears automatically once the recency window
      elapses) and support manual override.

## Data integrity

- [ ] Order line items store a **price snapshot** at order time,
      independent of the live product price record.

## Authorization

- [ ] Only Merchandiser role can execute the publish action.

## Auditability

- [ ] Every price change (including scheduled markdown activation) is
      audited with old value, new value, actor (or "system" for
      scheduled activation), and timestamp.

## Positive scenarios

1. Set a markdown with a future start date → price unchanged until
   that date/time → price changes automatically at the boundary.
2. Publish flow: QA passes → Merchandiser publishes → product visible
   in catalog within the expected propagation time.

## Negative scenarios / edge cases

1. Attempt to set a size-specific price override → rejected/not
   exposed as a normal operation.
2. Markdown end date in the past → rejected at creation.
3. Merchandiser attempts to publish a QA-incomplete product → blocked
   with a specific reason.

## API / Database behavior

- [ ] Price history is queryable (not just current price) — needed for
      the immutable-order-value guarantee above.

## Performance expectations

- [ ] Catalog listing/pricing queries perform acceptably at 10,000–50,000
      SKU scale (`NFR-001`).

## Test requirements

- [ ] Unit tests: price snapshot logic, markdown scheduling.
- [ ] Integration tests: publish gate (both conditions), price-history
      query.
- [ ] E2E: `acceptance/e2e-commerce-flows.md` FLOW 2.

## Definition of Done

All boxes above checked, plus `acceptance/README.md`.
