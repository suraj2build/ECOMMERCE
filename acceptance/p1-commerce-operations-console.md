# P1 — Commerce Operations Console: acceptance criteria

Status: **built 2026-09-30, awaiting independent review.** Not
self-certified. This is a functional build pass over existing capabilities,
not a new milestone (no M34 exists).

Protected starting baseline: `b0237d1efb34504b8b6f9ad01b99ca40db9faf15`
(M31 final delta repair). Everything certified or under review at that
baseline stays as it was; P1 changed certified domain code only for the
two defects listed under Security.

## Scope

Turn `apps/admin` into a permission-aware operating console over the
capabilities that already exist: merchandise, procurement, inventory,
orders and fulfilment, post-purchase, commercial, customers, content and
insights. Design references: `docs/admin/P1_PERMISSION_MAP.md` (IA and
permission map), `docs/admin/P1_OPERATOR_WORKFLOWS.md`,
`docs/admin/P1_QUERY_ENDPOINTS.md`, `docs/admin/P1_DECISIONS.md`.

## Criteria

### Architecture

- [x] UI gathers input → existing API route → existing domain service
      validates and transitions → the console renders the returned state.
- [x] No inventory, available-to-sell, eligibility, refund, promotion,
      lifecycle or gift-card calculation in React. Transitions are not
      hidden or computed client-side; the server's refusal is shown.
- [x] New API surface is read-only, under `/api/v1/admin/*`, with no
      business logic (`docs/admin/P1_QUERY_ENDPOINTS.md`).
- [x] No migration or schema change; no change to inventory, accounting,
      payment, refund, loyalty or gift-card semantics.

### Console

- [x] Ten navigation groups (Dashboard, Merchandise, Procurement, Inventory,
      Orders, Post-purchase, Commercial, Customers, Content, Insights),
      each item shown only to holders of its permission.
- [x] Shared components: page header with breadcrumbs, search and
      filters, status badges, data table with pagination, loading/empty/
      error/success states, confirm dialog (with type-to-confirm), drawer,
      form controls, server-searched pickers, money/date/identifier
      display, permission-gated actions.
- [x] Operators pick SKUs, styles, suppliers, locations, approvers and
      orders by business identifier; no UUID entry remains.
- [x] Staff login supports the MFA step; sign-out revokes the session on
      the server.
- [x] Keyboard: skip link, labelled controls, focus-visible outlines,
      native `<dialog>` focus handling, ARIA combobox pickers. Desktop
      first; the layout collapses for tablet widths.

### Workflow coverage (Playwright, `test/e2e-admin/p1-console.spec.ts`)

- [x] P1-01 style create and complete (colours, SKUs, media, QA, publish, price)
- [x] P1-02 supplier → PO → submit → approve (different person) → GRN/QC
- [x] P1-03 stock lookup → adjustment → balance before/after + audit row
- [x] P1-04 transfer out and in
- [x] P1-05 order → pick → fulfilment → pack → ready to ship
- [x] P1-06 shipment with the MOCK test carrier → delivered
- [x] P1-07 return → receive/QC → refund visible
- [x] P1-08 exchange → replacement through the normal fulfilment pipeline,
      completed automatically, no second order
- [x] P1-09 promotion create → deactivate → activate
- [x] P1-10 Customer 360 navigation → loyalty adjustment
- [x] P1-11 gift card issue → last-four lookup → adjust → disable
- [x] P1-12 analytics shows the analytics API's own figures

Flows drive the action under test through the rendered console as the role
that does the job and assert the database outcome. Set-up uses the public
API's state machines; nothing bypasses them.

The existing FLOW 19/20 spec was updated for the new SKU/location pickers
and confirmation step; all of its assertions are kept, and one is added
(the no-justification case must show an outcome).

### Security

- [x] Server RBAC stays authoritative; every new endpoint is tested for
      401, 403 (with `authz.denied` audit row) and authorized access.
- [x] Defect fixed: `GET /grn/:id` returned the receiving staff member's
      whole record, including `passwordHash` and `mfaSecret`. Now id, name
      and email only. Regression test in `admin-queries.test.ts`.
- [x] Defect fixed: gift-card staff views returned `codeHash`, contrary to
      `security/PII_DATA_INVENTORY.md`. Now omitted everywhere; the code is
      shown once at issue and never stored or logged by the console.
- [x] No secret material, credential values or PII added to logs or client
      bundles; no HTML rendered from data; CSP/security headers, MFA,
      session, guest-session and rate-limit behaviour unchanged; MOCK
      provider production guards unchanged.
- [x] No BOLA/IDOR: new reads are staff-only, permission-gated, and return
      only what the gating permission already exposes.

### Performance

- [x] All new list/lookup queries are bounded (lookups ≤ 25, pages ≤ 100)
      and use joins/`_count` rather than per-row queries.
- [x] No picker or dropdown loads a transactional table; selects are used
      only for small reference tables (locations, brands, categories,
      sizes, promotion types).

### Open items

`docs/admin/P1_DECISIONS.md`: DECISION_REQUIRED D-1 to D-4, known
limitations, external dependencies, and one storefront copy item
recorded for P2.

## Not claimed

Not GST_COMPLIANT, DPDP_COMPLIANT, SECURITY_CERTIFIED, PRODUCTION_READY
or PRODUCTION_APPROVED. No production deployment was made. P2 (storefront
redesign), P3 and P4 were not started.
