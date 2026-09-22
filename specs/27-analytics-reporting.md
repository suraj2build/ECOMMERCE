# 27. Analytics / Reporting

**Status:** DRAFT

## Purpose

Define what business and operational analytics/reporting the platform
must produce — sales, inventory, customer, marketing, and operational
KPIs — and how that data is collected and surfaced.

## Scope

- Event tracking (storefront behavior, conversion funnel)
- Business reporting (sales, inventory turnover, return rates,
  procurement performance)
- Data warehouse / analytics store (if separate from the operational
  PostgreSQL database) — not yet decided
- Dashboards / reporting surfaces (in `28-admin.md` or a separate BI
  tool — not yet decided)

## Key architectural constraints (approved)

None domain-specific yet. Should be designed to read from the ledger
models (inventory, loyalty) rather than duplicating/bypassing them, to
stay consistent with the audit/traceability principles in ADR-0012 and
ADR-0013.

## Open questions — DECISION_REQUIRED

- Build vs. integrate: native reporting vs. third-party analytics/BI
  tool integration — not yet decided.
- Which KPIs are required for launch vs. later? Business-owned, not
  yet defined.
- Data retention for analytics/event data — not yet defined (may have
  compliance implications, see `30-audit-compliance.md`).

## Blueprint references

See `blueprint/DECISION_REGISTER.md` for full context on: `ANL-001`.

## Acceptance criteria

Not yet defined — requires `APPROVED` status first.

## Dependencies

Depends on nearly every other domain as a data source (inventory,
orders, loyalty, marketing, etc.). Feeds: `28-admin.md`.
