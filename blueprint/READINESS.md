# Development Readiness Scorecard

**Status update (2026-09-22):** This document is fully rewritten to
reflect the state of the repository *after* the Product Owner's
Blueprint V2 decision session and the subsequent documentation
consistency audit. The previous version of this file (written before
that session) claimed several domains — notably Organization/Location
and India Tax/GST — had no owning spec, and classified most domains
`NOT_READY`. **Both of those are now false.** `specs/31-organization-locations.md`
and `specs/32-india-tax-invoicing.md` exist and own those domains, and
105 of 112 registered decisions are `DECIDED`. This rewrite replaces
the old scorecard and terminology entirely rather than patching it, to
avoid leaving a confusing mix of old and new claims.

## The hierarchy of states — read this before the scorecard

Six distinct kinds of "readiness" exist in this repository. They are
**not interchangeable**, and a milestone being ready at one layer does
**not** imply it is ready at another. This is the single hierarchy —
every other document (`BUILD_PLAN.md`, `CLAUDE.md`, individual specs)
uses these same terms consistently as of this update.

```
1. DECISION STATUS        (blueprint/DECISION_REGISTER.md, per decision)
   DECIDED | UNDER_REVIEW | OPEN
        |
        v
2. SPEC STATUS             (each spec's own header, per CLAUDE.md §3)
   DRAFT -> UNDER_REVIEW -> APPROVED -> IMPLEMENTING -> IMPLEMENTED -> VERIFIED
        |
        v
3. MILESTONE READINESS     (BUILD_PLAN.md, per milestone)
   BLOCKED | READY_FOR_IMPLEMENTATION
        |
        v
4. IMPLEMENTATION AUTHORIZATION   (explicit human decision, platform-wide)
   NOT AUTHORIZED | "START BUILD" GIVEN
        |
        v
5. COMPLIANCE VERIFICATION        (external professional sign-off, specific items)
   UNVERIFIED | VERIFIED
        |
        v
6. PRODUCTION READINESS           (final gate before real customers/money)
   NOT READY | READY (requires 1-5 all satisfied, PLUS M31 security review,
                       M32 load certification, M33 E2E certification,
                       business UAT, and explicit deployment approval)
```

**Critical distinctions:**

- **Layers 1–3 are now largely satisfied** (105/112 decisions
  `DECIDED`, most specs `APPROVED`, most milestones
  `READY_FOR_IMPLEMENTATION`). This is what this document tracks.
- **Layer 4 (implementation authorization) is a separate, explicit
  human decision that has NOT been given.** No amount of decision or
  spec readiness substitutes for it. See `CLAUDE.md` §0: "Do not
  interpret 'the docs are done' as authorization to start
  implementation."
- **Layer 5 (compliance verification)** applies to a specific, named
  set of items (`TAX-001`–`005`, and the data-privacy items `CUST-001`/
  `AUD-002`) — it does not apply platform-wide, and it gates
  *production correctness* of those specific items, not development of
  everything else.
- **Layer 6 (production readiness) is far downstream** of everything
  in this document. **A milestone being `READY_FOR_IMPLEMENTATION` at
  Layer 3 must never be read as "the system is ready for production."**
  Production additionally requires: the M31 security review, the M32
  performance/load certification, the M33 full E2E certification,
  business UAT, and a separate, explicit deployment approval per
  `SECURITY.md` and `DEPLOYMENT.md` §4 (which itself remains
  unresolved — production hosting target is not yet decided).

## Scorecard — per milestone (matches `BUILD_PLAN.md`'s 34 milestones)

| Milestone | Owning spec(s) | Spec status | Milestone readiness (Layer 3) | Notes |
|---|---|---|---|---|
| M00 Project Foundation | `00`, `31` | APPROVED, APPROVED | **READY_FOR_IMPLEMENTATION** | Organization/Brand/Location model resolved — `specs/31-organization-locations.md` is its owning spec. |
| M01 Auth / RBAC | `01` | APPROVED | **READY_FOR_IMPLEMENTATION** | Full RBAC matrix adopted (`ADM-001`). |
| M02 Product Master | `02`, `34` | APPROVED, DRAFT | **READY_FOR_IMPLEMENTATION** | AI enrichment (`34`) is optional/deferred sub-scope, does not block core M02. |
| M03 Suppliers | `03` | APPROVED | **READY_FOR_IMPLEMENTATION** | |
| M04 Purchase Orders | `04` | APPROVED | **READY_FOR_IMPLEMENTATION** | |
| M05 GRN / QC | `05` | APPROVED | **READY_FOR_IMPLEMENTATION** | |
| M06 Inventory | `06` | APPROVED | **READY_FOR_IMPLEMENTATION** | The platform's most critical domain — fully resolved. |
| M07 Catalog / Merchandising | `07` | APPROVED | **READY_FOR_IMPLEMENTATION** | |
| M08 Tax & Invoicing Foundation | `32` | DRAFT (compliance content `UNDER_REVIEW`) | **BLOCKED** | Blocked specifically on `TAX-001`–`005` external legal/tax verification — see Layer 5. Engineering scaffolding may still be built and used by other milestones (`acceptance/m08-tax-invoicing-foundation.md`). |
| M09 Storefront Foundation | `08` | APPROVED | **READY_FOR_IMPLEMENTATION** | |
| M10 Search / Discovery | `09` | APPROVED | **READY_FOR_IMPLEMENTATION** | |
| M11 PDP | `10` | APPROVED | **READY_FOR_IMPLEMENTATION** | |
| M12 Wishlist / Cart | `11` | APPROVED | **READY_FOR_IMPLEMENTATION** | |
| M13 Checkout | `12` | APPROVED | **READY_FOR_IMPLEMENTATION** | Tax-engine architecture decided; legal rate correctness depends on M08 (production gate, not a development blocker). |
| M14 Payment | `13` | APPROVED | **READY_FOR_IMPLEMENTATION** | |
| M15 Order Management | `14` | APPROVED | **READY_FOR_IMPLEMENTATION** | Invoice legal format depends on M08 (production gate only). |
| M16 Warehouse / Fulfilment | `15` | APPROVED | **READY_FOR_IMPLEMENTATION** | |
| M17 Shipping / Tracking | `16` | APPROVED | **READY_FOR_IMPLEMENTATION** | Carrier selection is deferred operational configuration. |
| M18 Cancellation | `17` | APPROVED | **READY_FOR_IMPLEMENTATION** | Credit-note legal format depends on M08 (production gate only). |
| M19 Returns | `18` | APPROVED | **READY_FOR_IMPLEMENTATION** | |
| M20 Refunds (+ Store Credit) | `19`, `33` | APPROVED, DRAFT | **READY_FOR_IMPLEMENTATION** | Store-credit ledger direction fully decided (`REF-002`). |
| M21 Exchanges | `20` | APPROVED | **READY_FOR_IMPLEMENTATION** | |
| M22 Customer 360 | `21` | UNDER_REVIEW | **READY_FOR_IMPLEMENTATION** (for all required features) | `CUST-001` (data retention/deletion policy) is the one item still `UNDER_REVIEW`; it does not block building the profile features themselves. |
| M23 Loyalty | `22` | APPROVED | **READY_FOR_IMPLEMENTATION** | Points + tiers model, fully resolved. |
| M24 Promotions | `23` | APPROVED | **READY_FOR_IMPLEMENTATION** | |
| M25 Marketing | `24` | APPROVED | **READY_FOR_IMPLEMENTATION** | |
| M26 Social / Channel Publishing | `25` | APPROVED (adapters only) | **READY_FOR_IMPLEMENTATION** | Scope is the adapter/contract architecture only — concrete marketplace integrations require separate authorization regardless of this readiness. |
| M27 SEO | `26` | APPROVED | **READY_FOR_IMPLEMENTATION** | |
| M28 Analytics / Reporting | `27` | APPROVED | **READY_FOR_IMPLEMENTATION** | |
| M29 Admin (+ CMS) | `28`, `29`, `30` | APPROVED, APPROVED, UNDER_REVIEW | **READY_FOR_IMPLEMENTATION** | `AUD-002` (regulatory scope) is the one item `UNDER_REVIEW`; the audit-logging mechanism itself is fully decided. |
| M30 Gift Cards | `33` | DRAFT | **READY_FOR_IMPLEMENTATION** | No blocking decision — scheduled late by deliberate choice, not because it's blocked. |
| M31 Security Hardening | `SECURITY.md` + cross-cutting | APPROVED (governance) | **READY_FOR_IMPLEMENTATION** | Applies continuously alongside every other milestone. |
| M32 Performance / Load | cross-cutting | n/a | **BLOCKED** | Sequence-blocked — needs M00–M31 substantially built to have a real system to load-test. Not a decision blocker. |
| M33 Full E2E Certification | all of the above | n/a | **BLOCKED** | Sequence-blocked — needs M00–M32 complete. Not a decision blocker. |

**Reading the table:** "Spec status" is Layer 2. "Milestone readiness"
is Layer 3. Neither implies Layer 4 (implementation authorization) —
see the hierarchy above.

## M00 / M01 — explicit determination

**M00 Project Foundation: READY_FOR_IMPLEMENTATION** (Layer 3). Its
owning specs (`00`, `31`) are both `APPROVED`. No decision blocks it —
`ORG-001` and `ORG-002` are `DECIDED`. It is **not** authorized to
begin (Layer 4) absent explicit **START BUILD**.

**M01 Authentication / RBAC: READY_FOR_IMPLEMENTATION** (Layer 3). Its
owning spec (`01`) is `APPROVED`. No decision blocks it — `AUTH-001`
through `003` and `ADM-001` are all `DECIDED`. It is **not** authorized
to begin (Layer 4) absent explicit **START BUILD**.

Neither M00 nor M01 is blocked by the `TAX-*` items still
`UNDER_REVIEW` — those affect M08, and downstream production-
correctness of M13/M15/M18/M20, not foundational or auth work.

## Cross-cutting readiness notes (updated 2026-09-22)

- **No domain lacks an owning spec anymore.** Every domain identified
  as a gap in the original audit now has one: Organization/Location
  (`specs/31`), India Tax/GST/Invoicing (`specs/32`), Store Credit &
  Gift Cards (`specs/33`), AI Product Enrichment (`specs/34`).
- **The three highest-leverage blockers from the original audit — Order
  Management (`ORD-001`), Payment (`PAY-002`), and Inventory
  (`INV-001`/`002`/`003`) — are all `DECIDED`.** This was the single
  largest concentration of P0 risk on the platform; it no longer
  exists.
- **Only one milestone is `BLOCKED` on a decision/compliance basis:
  M08 Tax & Invoicing Foundation**, pending `TAX-001`–`005` external
  verification. M32 and M33 are `BLOCKED` only in the sequence sense
  (they need prior milestones built), not on any open decision.
- **Two items remain `UNDER_REVIEW` outside the tax domain:** `CUST-001`
  (data retention/deletion, affects M22) and `AUD-002` (regulatory
  scope, affects M29) — both routed to legal verification, neither
  blocking their milestone's core build.

## What would move this scorecard forward

1. **Layer 4 (implementation authorization):** the human Product Owner
   gives explicit **START BUILD** authorization. This is the only
   remaining step for M00/M01 to begin.
2. **Layer 5 (compliance verification):** a qualified tax/GST
   professional verifies `TAX-001`–`005`; a qualified legal/privacy
   professional addresses `CUST-001`/`AUD-002`. This unblocks M08 fully
   and removes the production-correctness caveat on M13/M15/M18/M20/M22/M29.
3. **Layer 6 (production readiness):** far downstream — requires M31,
   M32, M33 all complete, plus business UAT and a separate deployment
   approval (production hosting target is itself still undecided, see
   `DEPLOYMENT.md` §4).

This document supersedes its own prior version. For milestone sequence
and full per-milestone acceptance criteria, see `BUILD_PLAN.md` and
`acceptance/`.
