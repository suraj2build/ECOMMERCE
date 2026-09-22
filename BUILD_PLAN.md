# Build Plan

## STATUS: READINESS GATE — SEE §3

> As of **2026-09-22**, the Product Owner has completed a Blueprint V2
> decision session resolving 105 of 112 open decisions (see
> `blueprint/DECISION_REGISTER.md`). This unblocks the milestone
> sequence below for engineering purposes. **This does not by itself
> authorize implementation.** Per `CLAUDE.md` §0, starting
> implementation still requires an explicit, separate **START BUILD**
> authorization from the human Product Owner. Until that authorization
> is given, no application code, frameworks, or database migrations
> may be created, regardless of how many milestones show
> `READY_FOR_IMPLEMENTATION` below.

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
| M08 | **Tax & Invoicing Foundation** (NEW) | `32` | **BLOCKED** — compliance verification pending (`TAX-001`–`005`) |
| M09 | Storefront Foundation | `08` | READY_FOR_IMPLEMENTATION — must begin with the Medusa v2 integration spike required by `docs/decisions/0017-medusa-custom-domain-ownership-boundary.md` before other M09 work |
| M10 | Search / Discovery | `09` | READY_FOR_IMPLEMENTATION |
| M11 | PDP | `10` | READY_FOR_IMPLEMENTATION |
| M12 | Wishlist / Cart | `11` | READY_FOR_IMPLEMENTATION |
| M13 | Checkout | `12` | READY_FOR_IMPLEMENTATION* |
| M14 | Payment | `13` | READY_FOR_IMPLEMENTATION |
| M15 | Order Management | `14` | READY_FOR_IMPLEMENTATION |
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
2. **Explicit human authorization** ("**START BUILD**") — given
   2026-09-22 for **Phase 1 (M00–M07) only**, via an explicit
   "START BUILD — PHASE 1" instruction scoped to those milestones and
   requiring a stop at a Phase 1 review gate before any further
   milestone. M00–M07 are now `IMPLEMENTED` (real code, real migrations
   against a live PostgreSQL instance, a real Redis-backed session
   store, and a passing automated test suite — unit, integration, the
   mandatory inventory-oversell concurrency test, and a full end-to-end
   proof — not scaffolding). **M08 and beyond remain unauthorized** and
   were not implemented. Continuing past M07 requires a new, separate,
   explicit authorization from the human project owner — this document
   being updated is not that authorization.

**`BLOCKED` milestones (M08, M32, M33)** have a stated, specific
reason — either genuine external compliance verification (M08) or
sequence dependency on prior milestones (M32, M33) — not vague
uncertainty.

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
| 2026-09-22 | Product Owner Blueprint V2 decision session completed. 105/112 decisions `DECIDED`, 7 `UNDER_REVIEW` (compliance verification). Build plan revised: 2 new milestones inserted (Tax & Invoicing, Gift Cards), 4 new specs added (`31`–`34`), all specs updated with normative requirements, per-milestone acceptance criteria created. Per-milestone readiness classified above. **Implementation remains NOT authorized** pending explicit **START BUILD** from the Product Owner.
