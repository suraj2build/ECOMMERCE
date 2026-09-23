# Build Plan

## STATUS: PHASE 2 BUILD IN PROGRESS (M08–M15) — SEE §3

> Phase 1 (M00–M07) is `PHASE_1_CERTIFIED` as of 2026-09-22 at commit
> `240debca8179df0b05db07216cfce64d0b10d0ae`. On **2026-09-23** the
> Product Owner gave explicit **"START BUILD — PHASE 2"** authorization
> for milestones **M08–M15** only, with a mandatory stop for
> independent review after M15 certification. **M16 and beyond remain
> unauthorized** — see `CLAUDE.md` §0.

## 1. What changed from the original plan

The original 32-milestone sequence (M00–M31) is revised to:

1. **Fold Organization & Location Foundation into M00** — `ORG-001`/
   `ORG-002` are foundational data-model decisions that must exist
   before Product Master and Inventory are built, not a separate
   milestone (see `blueprint/DEPENDENCY_MAP.md` recommendation).
2. **Insert a new milestone: Tax & Invoicing Foundation**, between
   Catalog (pricing) and Storefront — GST/HSN/MRP/invoicing is
   cross-cutting, legally significant, and deserves its own spec
   (`specs/32-india-tax-invoicing.md`) and milestone rather than being
   an implicit side-detail of Checkout.
3. **Fold the Store Credit ledger foundation into Refunds** (it's a
   hard dependency of the COD refund requirement) and **add a
   dedicated, later Gift Cards milestone** (purchasable stored-value
   instruments are required eventually but explicitly must not block
   early commerce milestones, per Product Owner instruction §21).
4. **Fold CMS into Admin** (admin-controlled content) rather than a
   separate spec/milestone.
5. **Fold AI Product Enrichment into Product Master as an optional,
   deferred sub-scope** (`specs/34-ai-product-enrichment.md`) — not a
   separate milestone, per explicit instruction not to build all AI
   capability in early milestones.
6. **Channel Publishing keeps its original position** — it now
   explicitly covers only the adapter/contract architecture; concrete
   marketplace integrations remain unbuilt pending separate
   authorization.

This adds exactly **two** new milestones (Tax & Invoicing, Gift Cards)
to the original 32, for a revised total of **34 milestones (M00–M33)**
— deliberately minimal, per the Product Owner's instruction not to add
"dozens of unnecessary milestones."

## 2. Milestone sequence

| Milestone | Name | Owning spec(s) | Readiness |
|---|---|---|---|
| M00 | Project Foundation (+ Organization & Location Foundation) | `00`, `31` | **IMPLEMENTED** (Phase 1 build, 2026-09-22) |
| M01 | Authentication / RBAC | `01` | **IMPLEMENTED** (Phase 1 build, 2026-09-22) |
| M02 | Product Master (+ optional AI enrichment sub-scope) | `02`, `34` | IMPLEMENTED (Phase 1 build, 2026-09-22; AI enrichment sub-scope not built — deferred, not requested) |
| M03 | Suppliers | `03` | IMPLEMENTED (Phase 1 build, 2026-09-22) |
| M04 | Procurement / Purchase Orders | `04` | IMPLEMENTED (Phase 1 build, 2026-09-22) |
| M05 | GRN / QC | `05` | IMPLEMENTED (Phase 1 build, 2026-09-22) |
| M06 | Inventory | `06` | IMPLEMENTED (Phase 1 build, 2026-09-22) |
| M07 | Catalog / Merchandising / Pricing | `07` | IMPLEMENTED (Phase 1 build, 2026-09-22) |
| M08 | **Tax & Invoicing Foundation** (NEW) | `32` | Engineering-configurable architecture **IMPLEMENTED** (Phase 2 build, 2026-09-23: GST registration model, effective-dated HSN/rate reference data, tax computation engine, immutable invoice/credit-note snapshots with concurrency-safe FY numbering, e-invoice adapter boundary — 19 passing tests). Milestone as a whole remains **BLOCKED** for the compliance-dependent portion — `TAX-001`–`005` remain `UNDER_REVIEW` and gate production configuration (real GSTIN/rate/HSN values), not the engineering build. See `acceptance/m08-tax-invoicing-foundation.md`. |
| M09 | Storefront Foundation (+ Watch & Shop) | `08`, `35` | Foundation layer **IMPLEMENTED** (Phase 2 build, 2026-09-23): Medusa v2 spike complete (ADR-0017), Watch & Shop content model/moderation backend (17 tests), Next.js storefront app with token-based multi-brand design system, Home page, error boundaries, public read-model routes, Playwright E2E (mobile/desktop/a11y) — all CI-green. PLP/PDP/Cart pages and the full immersive `/watch-and-shop` route are M10–M12's own scope; LCP measurement deferred to Phase 2 certification. See `acceptance/m09-storefront-foundation.md`, `acceptance/m09-watch-and-shop.md`. |
| M10 | Search / Discovery | `09` | IMPLEMENTING (Phase 2 build) |
| M11 | PDP | `10` | IMPLEMENTING (Phase 2 build) |
| M12 | Wishlist / Cart | `11` | IMPLEMENTING (Phase 2 build) |
| M13 | Checkout | `12` | IMPLEMENTING (Phase 2 build)* |
| M14 | Payment | `13` | IMPLEMENTING (Phase 2 build) |
| M15 | Order Management | `14` | IMPLEMENTING (Phase 2 build) |
| M16 | Warehouse / Fulfilment | `15` | READY_FOR_IMPLEMENTATION |
| M17 | Shipping / Tracking | `16` | READY_FOR_IMPLEMENTATION |
| M18 | Cancellation | `17` | READY_FOR_IMPLEMENTATION |
| M19 | Returns | `18` | READY_FOR_IMPLEMENTATION |
| M20 | Refunds (+ Store Credit ledger foundation) | `19`, `33` | READY_FOR_IMPLEMENTATION |
| M21 | Exchanges | `20` | READY_FOR_IMPLEMENTATION |
| M22 | Customer 360 | `21` | READY_FOR_IMPLEMENTATION** |
| M23 | Loyalty | `22` | READY_FOR_IMPLEMENTATION |
| M24 | Promotions | `23` | READY_FOR_IMPLEMENTATION |
| M25 | Marketing | `24` | READY_FOR_IMPLEMENTATION |
| M26 | Social / Channel Publishing (adapters only) | `25` | READY_FOR_IMPLEMENTATION*** |
| M27 | SEO | `26` | READY_FOR_IMPLEMENTATION |
| M28 | Analytics / Reporting | `27` | READY_FOR_IMPLEMENTATION |
| M29 | Admin (+ CMS) | `28` | READY_FOR_IMPLEMENTATION |
| M30 | **Gift Cards** (NEW) | `33` | READY_FOR_IMPLEMENTATION (low build priority — scheduled late) |
| M31 | Security Hardening | `SECURITY.md` + cross-cutting | READY_FOR_IMPLEMENTATION (continuous) |
| M32 | Performance / Load | cross-cutting | BLOCKED — sequence-blocked, needs sufficient built functionality first |
| M33 | Full End-to-End Certification | all of the above | BLOCKED — sequence-blocked, needs M00–M32 substantially complete |

\* M13 Checkout is ready for engineering build; final GST computation
*correctness* depends on M08's compliance verification before
production go-live (not before development starts).

\** M22 Customer 360 is ready for engineering build of all required
features; the data-retention/deletion *policy* (`CUST-001`) is
`UNDER_REVIEW` and layers on afterward without blocking the build.

\*** M26 covers the adapter/contract architecture only. Any concrete
marketplace integration (Amazon, Flipkart, Myntra, Ajio, Meta, Google
Merchant) requires separate, explicit milestone authorization before
implementation — building one without that authorization is out of
scope even after M26 itself is "ready."

Notifications (spec `29`) and Audit (spec `30`) remain cross-cutting,
feeding into multiple milestones above (primarily M15–M23 and M29)
rather than being standalone milestones, as in the original plan.

## 3. Readiness gate — what "ready" means and does not mean

`READY_FOR_IMPLEMENTATION` above means: the business decisions this
milestone's spec depends on are `DECIDED` (see
`blueprint/DECISION_REGISTER.md`), and no genuinely open,
non-configurable blocker remains. It does **not** mean implementation
is authorized to start. Two separate gates must both be satisfied:

1. **Decision readiness** (this document, per-milestone, now largely
   satisfied).
2. **Explicit human authorization** ("**START BUILD**") — Phase 1
   (M00–M07) was authorized 2026-09-22, implemented, and independently
   certified `PHASE_1_CERTIFIED` at commit
   `240debca8179df0b05db07216cfce64d0b10d0ae`. Phase 2 (M08–M15) was
   authorized 2026-09-23 via an explicit "START BUILD — PHASE 2"
   instruction scoped to those milestones and requiring a stop for
   independent review after M15 certification. **M16 and beyond remain
   unauthorized.** Continuing past M15 requires a new, separate,
   explicit authorization from the human project owner — this document
   being updated is not that authorization.

**`BLOCKED` milestones (M32, M33)** have a stated, specific reason —
sequence dependency on prior milestones — not vague uncertainty.

**No milestone is classified `FUTURE_SCOPE`** at the milestone level;
instead, specific **features within several milestones** are marked
`FUTURE_CONSIDERATION` in their owning spec and must not be built as
part of that milestone's completion:

- Native mobile applications (`specs/08-storefront.md`)
- Physical stores, click & collect, ship-from-store, multi-location
  *operation* (`specs/31-organization-locations.md` — the *data model*
  is required now, only the operational rollout is future)
- Concrete marketplace integrations (`specs/25-social-channel-publishing.md`)
- Raw-material inventory / BOM / production execution
  (`specs/03-suppliers-procurement.md`)
- Full AI generation capability beyond the optional M02 sub-scope
  (`specs/34-ai-product-enrichment.md`)
- Personalized search/recommendation (`specs/09-search-discovery.md`)
- Wishlist sharing, partial/split payment, pre-order/backorder, and
  the other smaller items listed `FUTURE_CONSIDERATION` throughout
  `/specs`

## 4. Definition of Done per milestone

See `acceptance/` — every milestone listed above has a corresponding
`acceptance/mNN-*.md` document with testable, structured acceptance
criteria. No milestone may be marked complete without satisfying it in
full — see `acceptance/README.md` for the Definition of Done process
that governs all of them.

## 5. Change log

| Date | Change |
|---|---|
| 2026-09-22 | Documentation/specification foundation established. Build plan created and marked BLOCKED pending Product Blueprint V2. |
| 2026-09-22 | Product Blueprint V2 decision framework created in `/blueprint` (112 decisions registered, all `OPEN`). |
| 2026-09-22 | Product Owner Blueprint V2 decision session completed. 105/112 decisions `DECIDED`, 7 `UNDER_REVIEW` (compliance verification). Build plan revised: 2 new milestones inserted (Tax & Invoicing, Gift Cards), 4 new specs added (`31`–`34`), all specs updated with normative requirements, per-milestone acceptance criteria created. Per-milestone readiness classified above. **Implementation remains NOT authorized** pending explicit **START BUILD** from the Product Owner. |
| 2026-09-22 | **START BUILD — PHASE 1** authorized (M00–M07). Implemented and independently certified `PHASE_1_CERTIFIED` at commit `240debca8179df0b05db07216cfce64d0b10d0ae` after an expanded engineering certification pass (database integrity, adversarial inventory/GRN/product/pricing/auth/input/audit testing, migration safety, CI/infrastructure/dependency review, ADR-0017 critical review, performance sanity). |
| 2026-09-23 | **START BUILD — PHASE 2** authorized (M08–M15), with a mandatory stop for independent review after M15 certification. M08–M15 moved from `READY_FOR_IMPLEMENTATION` to `IMPLEMENTING`. **M16 and beyond remain unauthorized.**
