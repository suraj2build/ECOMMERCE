# M29 — Admin (+ CMS) Acceptance Criteria

**Spec(s):** `specs/28-admin.md`, plus cross-cutting
`specs/29-notifications.md`, `specs/30-audit-compliance.md`
**Status:** READY_FOR_IMPLEMENTATION

## Business acceptance

- [ ] All 11 approved roles (Super Admin, Business Admin, Buying,
      Merchandising, Catalog, Warehouse Manager, Warehouse Operator,
      Customer Service, Marketing, Finance, Analytics) exist with a
      working, enforced permission matrix.
- [ ] Sensitive operations (large/exceptional discounts, manual
      inventory adjustments, exceptional refunds, high-risk financial
      actions, role/permission changes) require elevated authorization
      beyond mere screen access.
- [ ] Admin-controlled content (homepage banners, collections, campaign
      landing pages, navigation/menus, content blocks) can be changed
      by an authorized admin **without a code deployment**.

## Functional acceptance

- [ ] A distinct, data-minimized internal Customer 360 view exists,
      separate from the customer's own self-service profile API.
- [ ] Manual inventory adjustment requires justification field and
      Warehouse-Manager-or-above role, with Finance co-approval above
      the configured value threshold.

## Authorization (binding — FLOW 19)

- [ ] **Every role boundary in the matrix is tested for both allowed
      and denied access, server-side**, including:
  - Warehouse role cannot perform unauthorized finance actions.
  - Catalog role cannot perform unauthorized refunds.
  - Marketing role cannot adjust inventory unless explicitly granted.
  - Finance actions require correct permission.
  - Manual inventory adjustment requires appropriate authorization.
- [ ] UI hiding an action is never treated as sufficient — every test
      above verifies the **API** rejects the unauthorized action, not
      just that the UI doesn't show the button.

## Auditability (binding — FLOW 20)

- [ ] Every sensitive action (discount override, inventory adjustment,
      exceptional refund, role/permission change, product publishing)
      is recorded with who/what/when/old value/new value/reference.
- [ ] Role/permission changes themselves are audited.

## CMS-specific

- [ ] A non-technical admin can publish a homepage banner change and
      see it reflected on the live storefront without any deployment
      step.

## Notifications (cross-cutting)

- [ ] Order/shipment/return/refund/exchange/loyalty events correctly
      trigger notifications through the provider-abstracted channel
      system, without duplicate sends for a duplicated triggering
      event.

## Test requirements

- [ ] E2E: `acceptance/e2e-commerce-flows.md` FLOW 19 (unauthorized
      admin action blocked) and FLOW 20 (inventory adjustment
      audited) — both mandatory, automated.

## Definition of Done

All boxes above checked, plus `acceptance/README.md`.
