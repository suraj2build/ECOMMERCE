# 27. Analytics / Reporting

**Status:** APPROVED (decided 2026-09-22 — see `blueprint/DECISION_REGISTER.md` `ANL-001`)

## Purpose

Define the business and operational analytics/reporting the platform
must produce.

## Scope

- Event tracking, business reporting, data foundations

## Approved requirements (2026-09-22)

Required analytics categories (explicit, §27):

- **Commerce:** sales, orders, returns, refunds, inventory, customer
  metrics, margin, profitability.
- **Fashion-specific:** style performance, colour performance, size
  performance, stock ageing, sell-through, availability, return
  reasons, size-related returns.
- **Procurement:** supplier fill rate, short receipts, excess receipts,
  damaged receipts, lead time, purchase vs. sales, supplier
  performance.

Build-vs-integrate: build native event/data foundations first (reading
from the ledger models — inventory, loyalty, store credit — rather
than duplicating or bypassing them, consistent with ADR-0012/0013);
evaluate a BI/dashboard presentation layer separately, later. This is
an engineering default, not a business blocker.

## Remaining open items

None.

## Acceptance criteria

See `acceptance/m28-analytics-reporting.md`.

## Dependencies

Depends on nearly every other domain as a data source. Feeds:
`specs/28-admin.md`.
