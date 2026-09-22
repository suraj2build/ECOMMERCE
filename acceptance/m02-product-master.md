# M02 — Product Master Acceptance Criteria

**Spec(s):** `specs/02-product-master.md`, `specs/34-ai-product-enrichment.md` (optional sub-scope)
**Status:** READY_FOR_IMPLEMENTATION

## Business acceptance

- [ ] A Style can be created with Color and Size variants resolving to
      unique Sellable SKUs (`STYLE -> COLOR -> SIZE -> SKU`).
- [ ] Every Style references exactly one Brand.
- [ ] Season and Collection are **required** fields — a Style cannot be
      saved without them.
- [ ] A Style progresses through
      `draft -> ready_for_enrichment -> ready_for_qa -> published -> unpublished -> archived`,
      and `published` is unreachable without passing `ready_for_qa`.

## Functional acceptance

- [ ] Size charts can be created per category/gender/brand, are
      versioned (effective-dated), and a historical order can display
      the chart version active at purchase time.
- [ ] Product media supports multiple images with explicit ordering,
      per-variant (colour) imagery, swatches, optional video, alt text,
      and SEO metadata per asset.
- [ ] Bulk import, bulk enrichment, bulk pricing, bulk publish, and
      bulk unpublish operations are available and each produces an
      auditable batch record.
- [ ] An HSN field exists on category and SKU level (nullable).

## Data integrity

- [ ] A new custom attribute can be added to the taxonomy without a
      schema migration (config-driven extensibility, `PROD-001`).
- [ ] Required-attribute rules differ correctly per category (e.g., a
      rule requiring "sleeve" for tops does not apply to footwear).

## Authorization

- [ ] Only Catalog/Merchandising roles can create/edit product master
      data; publish action requires Merchandiser role specifically
      (not Catalog alone) alongside the automated QA gate.
- [ ] Bulk inventory-affecting operations require `ADM-003`
      authorization.

## Auditability

- [ ] Every publish/unpublish action is logged with actor and
      timestamp.
- [ ] Bulk operations log the full before/after diff set, not just "a
      bulk operation occurred."

## Positive scenarios

1. Create a Style with 3 colors × 4 sizes → 12 SKUs generated
   correctly, each inheriting Style-level attributes and Season/
   Collection.
2. Move a Style from `draft` through to `published` via the full
   lifecycle, each transition gated correctly.
3. Bulk-publish 50 `ready_for_qa` products in one operation; all reach
   `published` and the batch is auditable.
4. AI-generated draft content (if this optional sub-scope is built) is
   created in `ready_for_enrichment` state and **cannot** reach
   `published` without passing the same QA gate as manually-authored
   content.

## Negative scenarios / edge cases

1. Attempt to publish a Style missing a required category attribute →
   blocked with a specific, actionable validation message (not a
   generic error).
2. Attempt to save a Style without Season or Collection → blocked.
3. Attempt to reference a non-existent Brand → rejected.
4. Bulk price change containing one invalid row → the batch either
   fully rejects with a clear per-row error report, or partially
   applies with an explicit per-row success/failure report (pick one
   behavior and test it consistently — do not silently partial-apply
   without reporting which rows failed).

## Mobile / Desktop behavior

- [ ] Product media (multiple images, variant imagery) renders
      correctly and performantly on both viewports once surfaced on
      PDP (cross-referenced with `acceptance/m11-pdp.md`).

## API / Database behavior

- [ ] Product master API supports pagination for large catalogs (design
      for the 10,000–50,000 SKU scale from day one).

## Security

- [ ] Bulk import endpoints validate and sanitize uploaded file content
      (no arbitrary code execution via crafted import files).

## Performance expectations

- [ ] Bulk operations on 1,000+ SKUs complete within a documented time
      budget or run asynchronously with progress/status reporting —
      never a synchronous request that can time out.

## Observability

- [ ] Bulk operation progress/failure is observable (logs or a status
      endpoint), not a black box.

## Test requirements

- [ ] Unit tests: attribute validation rules, lifecycle state
      transitions.
- [ ] Integration tests: SKU generation from Style×Color×Size, bulk
      operations.
- [ ] E2E: `acceptance/e2e-commerce-flows.md` FLOW 2 (enrichment →
      pricing → publish → search → PLP → PDP).

## Definition of Done

All boxes above checked, plus `acceptance/README.md`.
