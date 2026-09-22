# 34. AI Product Enrichment

**Status:** DRAFT — architectural direction APPROVED; full capability
build is deferred/optional sub-scope, not a launch-blocking milestone.

## Purpose

Own the AI-assisted content and image generation capability for
product enrichment, and its mandatory human review/approval boundary.
This spec did not exist in the original 31-spec index; created now
because §23 of the Product Owner's instruction describes a substantial,
architecturally-significant capability ("AI integration is part of the
intended platform") that needs a clear owner and, critically, an
explicit review-gate requirement that must not be silently dropped
when implementation begins.

## Approved requirements

### Scope of AI assistance

The product-enrichment workflow (`specs/02-product-master.md`
`PROD-003`) SHOULD eventually support AI-assisted generation of:

- Product titles, descriptions, bullet points
- Attributes (suggested values for the taxonomy in
  `specs/02-product-master.md`)
- SEO metadata, keywords, search tags
- Styling suggestions, social captions, alt text
- **AI-generated product imagery**

### AI image generation — character consistency

- Image-generation workflows MUST be capable of using **fixed/approved
  model character sheets**, so the business can maintain a consistent
  AI fashion model appearance across a catalog (explicit, §23).
- Character sheets themselves are content subject to the same
  review/approval boundary below before being adopted as a "fixed/
  approved" reference.

### Mandatory review boundary (hard requirement, not configurable away)

- AI-generated content or images **MUST NOT automatically publish**
  without passing through the standard product QA/approval workflow
  (`specs/02-product-master.md` `PROD-003`: `ready_for_qa -> published`)
  — explicit, §23.
- Generated content MUST carry **provenance/metadata sufficient for
  operational traceability** — at minimum: which model/provider
  generated it, when, and against what prompt/character-sheet
  reference, so a human reviewer (and later audit, per `AUD-001`) can
  trace any published asset back to its generation parameters.
- Content that came from an AI provider MUST NOT bypass product/content
  QA merely because of its origin — the same completeness/QA gate
  applies uniformly regardless of whether a human or an AI produced the
  draft content.

### Provider abstraction

- AI provider/model integration SHOULD be abstracted where reasonable
  — the business domain (enrichment workflow, review gate, provenance
  tracking) MUST NOT be tightly coupled to one specific AI provider's
  API, mirroring the payment (`PAY-001`) and carrier (`SHIP-002`)
  abstraction pattern already established elsewhere in this
  architecture.

### Explicitly deferred (not built in early milestones)

Per the Product Owner's instruction not to "attempt to build all AI
capability in early milestones unless explicitly sequenced" (§23):

- Full AI capability (all listed content types plus image generation)
  is **not** required for M02 Product Master to be considered
  complete. M02's core scope is the product data model and manual
  enrichment workflow; AI assistance is an **optional, deferred
  sub-scope** layered on top once the core workflow exists.
- The architecture (data model, provenance fields, review-gate
  workflow state) MUST be built in a way that does **not block**
  adding AI-assisted generation later — this is the one binding
  constraint on early milestones from this spec.

## Blueprint references

See `blueprint/DECISION_REGISTER.md` — this domain was not part of the
original 112-decision register (it is new scope introduced in the
2026-09-22 Product Owner session); no decision IDs are retrofitted
here to avoid implying a false continuity. Treat this spec's
"Approved requirements" section as the authoritative record instead.

## Acceptance criteria

See `acceptance/m02-product-master.md` for the review-gate requirement
as it applies even to manually-authored content (the same gate AI
content must pass). Dedicated AI-enrichment acceptance criteria are
deferred until this sub-scope is actually sequenced into a milestone.

## Dependencies

Depends on: `specs/02-product-master.md` (enrichment/QA workflow this
plugs into). Feeds: `specs/07-catalog-merchandising.md` (published
content quality), `specs/26-seo.md` (AI-generated SEO metadata),
`specs/30-audit-compliance.md` (provenance/traceability).
