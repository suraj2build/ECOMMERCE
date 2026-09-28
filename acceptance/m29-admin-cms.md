# M29 — Admin (+ CMS) Acceptance Criteria

**Spec(s):** `specs/28-admin.md`, plus cross-cutting
`specs/29-notifications.md`, `specs/30-audit-compliance.md`
**Status:** IMPLEMENTED (2026-09-28 — see `blueprint/DECISION_REGISTER.md`
`ADM-001`–`003`, `NOTIF-001`). Not yet independently reviewed/certified.

## Business acceptance

- [x] All 11 approved roles (Super Admin, Business Admin, Buying,
      Merchandising, Catalog, Warehouse Manager, Warehouse Operator,
      Customer Service, Marketing, Finance, Analytics) exist with a
      working, enforced permission matrix (`packages/db/prisma/seed.ts`,
      pre-existing since M01, re-audited this milestone; no gaps found).
- [x] Sensitive operations (manual inventory adjustments — pre-existing
      ADM-003 threshold/co-approval; exceptional refunds — pre-existing
      `payment:refund`; PO approval — pre-existing `po:approve`;
      role/permission changes) require elevated authorization beyond
      mere screen access — proven server-side (FLOW 19).
- [x] Admin-controlled content (homepage banners, campaign landing
      pages, navigation/menus, content blocks) can be changed by an
      authorized admin **without a code deployment**, via the new CMS
      module (`services/commerce-api/src/modules/cms`) and its
      corresponding `apps/admin` screens. Collections already had this
      property since M07 (`Collection`/`CollectionStyle`) — not
      duplicated here.

## Functional acceptance

- [x] A distinct, data-minimized internal Customer 360 view exists
      (`services/commerce-api/src/modules/support`, `GET
      /support/customers/:id/360`), separate from the customer's own
      self-service profile API — no address book, recently-viewed, or
      saved sizes, proven by a direct test assertion these fields are
      absent.
- [x] Manual inventory adjustment requires justification field and
      Warehouse-Manager-or-above role, with Finance co-approval above
      the configured value threshold — this was already built at
      ADM-003 (pre-M29); re-verified with a dedicated FLOW 20 test
      matrix rather than assumed.

## Authorization (binding — FLOW 19)

- [x] **Every role boundary in the matrix is tested for both allowed
      and denied access, server-side**, including:
  - Warehouse Operator cannot approve a Purchase Order (Finance/
    Business-Admin-only action).
  - Catalog role cannot issue a refund (Finance-only action).
  - Marketing role cannot adjust inventory unless explicitly granted.
  - Finance actions require correct permission (proven via the
    existing PO/refund/inventory-adjustment RBAC gates).
  - Manual inventory adjustment requires appropriate authorization.
- [x] UI hiding an action is never treated as sufficient — every case
      above is proven directly against the **API** (a direct HTTP call,
      never inferred from what `apps/admin` would or wouldn't render);
      the browser E2E for the inventory-adjustment case additionally
      submits through the real rendered form to prove the rejection
      is genuinely server-side, not merely a hidden nav link.
- [x] Every denied attempt is logged: `requirePermission` (`services/
      commerce-api/src/plugins/auth.ts`) now records an `authz.denied`
      audit row (actor, missing permission, attempted URL) on every 403
      across the entire application — a previously-undiscovered gap
      this milestone's own FLOW 19 test matrix surfaced and closed.

## Auditability (binding — FLOW 20)

- [x] Inventory adjustment (discount override, exceptional refund, and
      role/permission change auditing were already covered by prior
      milestones) is recorded with who/what/when/old value/new
      value/reference — `inventory.adjust` audit rows, pre-existing
      ADM-003 behavior, re-proven end to end including the Finance
      co-approver reference.
- [x] Role/permission changes themselves are audited (pre-existing,
      `AuditLog` on `StaffUserRole` mutations — unchanged by this
      milestone).

## CMS-specific

- [x] A non-technical admin can publish a homepage banner change and
      see it reflected on the live storefront read
      (`GET /storefront/cms/banners`) without any deployment step —
      proven by `test/integration/cms.test.ts`'s first test (create →
      public read → deactivate → public read reflects the change
      immediately).

## Notifications (cross-cutting)

- [x] Order/shipment/return/refund/exchange/loyalty events correctly
      trigger notifications through the REUSED `MarketingProvider`
      abstraction (never a second provider interface), without
      duplicate sends for a duplicated triggering event — the durable
      `NotificationDelivery` unique constraint
      (`@@unique([event, referenceId, channel])`), the same
      claim-before-external-call idiom M25's own Blocker 4 repair
      established, proven under genuine `Promise.all` concurrency.
      Wired from six real call sites: `OrderService.notifyOrderConfirmed`
      (called from both the COD confirm path and the Razorpay webhook
      handler), `markFulfilmentShipped`/`markFulfilmentDelivered`
      (ORDER_SHIPPED / EXCHANGE_COMPLETED), `ReturnService.markReceived`
      (RETURN_RECEIVED), `RefundService`'s claim path
      (REFUND_COMPLETED), and `LoyaltyService.vestEligiblePoints`
      (LOYALTY_POINTS_VESTED). `ORDER_DELIVERED`/`ORDER_CANCELLED` are
      defined in the `NotificationEvent` vocabulary but have no wired
      call site yet — an honest, documented scope boundary, not a
      silent gap: no genuine "this event definitely fires exactly once"
      hook point for a plain delivery/cancellation event was identified
      without risking a duplicate/premature fire, so wiring them is
      left for a future pass rather than guessed.

## Test requirements

- [x] E2E: `acceptance/e2e-commerce-flows.md` FLOW 19 (unauthorized
      admin action blocked) and FLOW 20 (inventory adjustment
      audited) — both automated, `test/e2e-admin/flow19-20.spec.ts`,
      driven against the real `apps/admin` application (real browser
      login, real rendered inventory-adjustment form for the
      UI-driven cases; a genuine authenticated API call, obtained from
      that same real login, for the two role/action combinations with
      no dedicated admin screen — PO approval, refund issuance — an
      honest scope boundary for this minimal admin app). Also covered
      as integration tests
      (`test/integration/flow19-unauthorized-admin-action.test.ts`,
      `test/integration/flow20-inventory-adjustment-audited.test.ts`).

## Scope boundaries (honest, not guessed)

- `apps/admin` is intentionally minimal: CMS (all four content types),
  inventory adjustment, internal Customer 360 lookup, channel-publishing
  management, and analytics. It does NOT have dedicated screens for
  every staff-only action in the system (e.g. PO approval, refund
  issuance) — those remain API-only, exactly as they were before this
  milestone; FLOW 19's two non-UI combinations are proven at the API
  layer through a real authenticated session instead.
- `ORDER_DELIVERED`/`ORDER_CANCELLED` notifications are defined but not
  yet wired to a call site (see Notifications section above).

## Definition of Done

All boxes above checked, plus `acceptance/README.md`. **This agent does
not self-declare M29 certified** — that determination belongs to the
independent reviewer.
