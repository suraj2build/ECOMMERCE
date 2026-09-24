# ADR-0019: Custom commerce-api is the sole system of record for every commerce domain; Medusa v2 is not adopted

## Status
Accepted. Supersedes ADR-0003, ADR-0016, and ADR-0017.

## Context

This ADR is a product of the Phase 2 independent-certification repair
pass (2026-09-24), not a new engineering initiative — it exists to
reconcile architecture documentation with what was actually built,
after the independent reviewer flagged the gap as finding #4.

ADR-0003 committed to Medusa v2 as the platform's "commerce kernel,"
owning cart, checkout, order, and pricing primitives. ADR-0016 deferred
actually bootstrapping Medusa until those primitives were first
exercised (M09+). ADR-0017 then defined a detailed per-domain ownership
table under that plan (custom: Product/Inventory/Pricing/Supplier-
Procurement/Auth/Customer identity; Medusa: Cart/Checkout/Order/
Payment orchestration/Fulfillment/Promotions/Region), and required a
pre-M09 spike proving the split was technically workable. That spike
was genuinely carried out: real `@medusajs/*` v2.21.1 packages were
installed in a scratch directory and their compiled workflow source
was read directly (ADR-0017 §"Medusa v2 integration spike — results").
The spike's technical findings — that Medusa's `addToCartWorkflow`
accepts externally-priced line items, that a custom `completeCartWorkflow`
step would be needed for this repository's own inventory reservation,
and that price/inventory must be re-validated immediately before
payment capture — were correct and remain useful engineering
reference. It concluded Medusa adoption was workable and that M09
would proceed by building custom Medusa workflows around it.

**That plan was never carried out.** M09 through M15 (specs 09, 12,
13, 14, 15 — Storefront Foundation, Cart/Wishlist, Checkout, Payment,
Order Management) were implemented, reviewed, and shipped as CI-green
entirely against this repository's own Prisma schema and
`services/commerce-api` domain services, with **zero** `@medusajs/*`
dependency anywhere in the repository and zero lines of code calling
into Medusa. `Cart`, `CheckoutSession`, `Payment`, `PaymentEvent`,
`Order`, `OrderLine`, and `OrderFulfilment` are custom Prisma models
owned and mutated exclusively by `services/commerce-api`'s own
`checkout`, `payment`, and `order` modules — the same pattern already
used for Product/Inventory/Pricing. None of specs 12–15 or their
acceptance documents (`acceptance/m12-*.md` through `acceptance/m15-*.md`)
reference Medusa at all; they were written and accepted against the
custom implementation directly. `ARCHITECTURE.md`'s "Commerce kernel |
Medusa v2" line and `BUILD_PLAN.md`'s M09 status line are the only
places that still describe the original plan — both now describe an
integration that does not exist in the shipped system.

This is not a case of two systems fighting for authority over the same
data (the dual-write/dual-authority failure ADR-0003 and ADR-0017 both
warned against) — it is simpler than that: **the planned second system
was never introduced, and only the documentation describing the plan
was left unupdated.** Reconciling that documentation to match reality,
and closing the ownership question permanently rather than leaving a
stale ADR pointing at an integration that doesn't exist, is this ADR's
entire purpose.

## Decision

**`services/commerce-api`, backed by this repository's own PostgreSQL
schema, is the single system of record for every commerce domain the
platform currently implements — permanently, not provisionally.**
Medusa v2 is **not installed, not integrated, and not adopted**. No
`@medusajs/*` package may be added to any workspace's dependencies,
and no domain below may be re-platformed onto a second system, without
a new ADR that explicitly reopens this decision (see Consequences).

| Domain | System of record | Notes |
|---|---|---|
| Product (Style/Colour/Size/SKU) | **Custom (commerce-api)** | Unchanged from ADR-0017. |
| Catalog / Pricing (MRP/selling/markdown) | **Custom (commerce-api)** | Unchanged from ADR-0017. `CatalogService.getActivePrice()` remains the only price source. |
| Inventory (ledger, balances, reservations) | **Custom (commerce-api)** | Unchanged from ADR-0017/ADR-0012. |
| Supplier / Purchase Orders / GRN / QC | **Custom (commerce-api)** | Unchanged; no competing system was ever relevant here. |
| Staff Auth / RBAC / Audit | **Custom (commerce-api)** | Unchanged from ADR-0017. |
| Customer identity (mobile-OTP profile/CRM) | **Custom (commerce-api)** | Unchanged from ADR-0017. |
| **Cart** (`Cart`, `CartLine`) | **Custom (commerce-api)** | **Changed from ADR-0017.** Built and shipped (M12) entirely as a custom Prisma model/service; Medusa's Cart module was never bootstrapped. |
| **Checkout** (`CheckoutSession`, `CheckoutSessionLine`) | **Custom (commerce-api)** | **Changed from ADR-0017.** Built and shipped (M13) as a custom service owning reservation-at-checkout, idempotent submission, and shipping-rule application; no Medusa workflow exists. |
| **Payment orchestration** (`Payment`, `PaymentEvent`) | **Custom (commerce-api)** | **Changed from ADR-0017.** Built and shipped (M14) as a custom service directly integrating the Razorpay provider abstraction (ADR-0011); Medusa's Payment module was never bootstrapped. |
| **Order** (`Order`, `OrderLine`, `OrderFulfilment`) | **Custom (commerce-api)** | **Changed from ADR-0017.** Built and shipped (M15) as a custom service owning the order state machine, split fulfilment, partial cancellation, and RTO; Medusa's Order module was never bootstrapped. |
| Promotions / discounts | **Not yet built** | Still out of scope (unchanged from Phase 1's exclusion); when built, it is commerce-api's own domain like every other row above, not Medusa's, absent a fresh ADR. |
| Region / currency / sales channel | **Custom (commerce-api), single-region** | Single-region/single-currency (INR, India) is enforced directly in the custom schema/services (CAT-001), same as ADR-0017 anticipated, just without a Medusa region module underneath it. |

No domain in this table has two competing writers. This ADR does not
introduce any change to running code — it corrects the documented
ownership model to match the system that has been reviewed, tested,
and CI-green since M15.

## Reasoning

- **One system of record per domain is the principle ADR-0003 and
  ADR-0017 already established; this ADR keeps that principle and
  corrects only which system fills each domain's role.** The risk both
  earlier ADRs were guarding against — two systems each believing they
  own the same cart/order/payment data — is avoided here the same way:
  by naming exactly one owner per domain. It happens to be the same
  owner (commerce-api) across every row, which is a stronger, simpler
  guarantee than the split ADR-0017 planned, not a weaker one.
- **Migrating the now-shipped, tested, CI-green Cart/Checkout/Payment/
  Order implementation onto Medusa's modules would mean re-platforming
  working code for no functional gain, and is explicitly out of scope
  for a certification repair pass** (the Phase 2 repair authorization
  is to fix defects in the existing M08–M15 implementation, not to
  perform an architecture migration). Building a second, parallel
  Medusa-backed implementation alongside the existing one would
  immediately recreate the dual-authority risk ADR-0003/ADR-0017 exist
  to prevent, for domains that already have exactly one working owner.
  Neither option is justified by anything this repair pass found.
- **The original cost/benefit calculation behind ADR-0003 no longer
  holds.** ADR-0003 chose Medusa specifically to avoid "reinventing"
  well-solved cart/checkout/order/payment primitives from scratch. That
  reinvention has, in practice, already happened (M12–M15, CI-green,
  independently reviewed) — adopting Medusa now would not avoid that
  work, it would duplicate and then have to reconcile it. A future
  decision to adopt Medusa (or any other commerce kernel) is a
  materially different decision at this point than the green-field
  choice ADR-0003 made, and deserves fresh evaluation against the
  system that now exists, not a resumption of the old plan.
- ADR-0017's spike findings are preserved below as historical record,
  not deleted — they were real, correctly-conducted research and may
  be directly useful if a future ADR ever revisits this decision for a
  domain not yet built (e.g., Promotions, or a M20+ refund/reconciliation
  workflow).

## Consequences

- `ARCHITECTURE.md`'s "Commerce kernel | Medusa v2" row must be
  corrected to name `services/commerce-api` as the commerce kernel and
  reference this ADR.
- `BUILD_PLAN.md`'s M09 status line, and any other cross-reference to
  ADR-0017 as the live ownership decision, must point to this ADR
  instead (ADR-0017 remains in place, marked superseded, for its
  historical spike evidence).
- `CLAUDE.md`'s reading-order/decision-register references to
  ADR-0017 as the operative Medusa/custom boundary should be read as
  referring to this ADR going forward.
- No `@medusajs/*` package may be added to any workspace's
  `package.json` without a new ADR that explicitly revisits this
  decision — an incidental dependency addition (e.g. pulled in
  transitively for an unrelated integration) is not sufficient
  authorization to begin writing to a Medusa module as a second source
  of truth for any domain in the table above.
- If a future milestone (Promotions, a M20 refund workflow, or
  anything else) considers adopting Medusa or another third-party
  commerce framework, that proposal must be evaluated as an addition
  to - or partial replacement of - the now-existing custom platform,
  with its own explicit dual-write/migration analysis, not treated as
  "finishing" ADR-0003/ADR-0016/ADR-0017's original plan.
- This ADR makes no change to any running code, schema, or test. It is
  a documentation correction only, produced under the Phase 2
  certification-repair authorization's explicit instruction that this
  finding be resolved as "architecture reconciliation/documentation,
  not a new commerce-engine rewrite."

## Preserved for reference: ADR-0017's spike findings

The technical findings from ADR-0017's 2026-09-23 spike (real
`@medusajs/*` v2.21.1 package inspection) are reproduced here verbatim
from that ADR, since they remain accurate statements about Medusa v2's
actual behavior and may inform a future decision:

- Medusa's `addToCartWorkflow` accepts a line item with no `variant_id`
  (only `variant_sku`/`unit_price`), skipping its own Pricing/Inventory
  module resolution entirely for such items.
- Medusa's `completeCartWorkflow`'s `reserveInventoryStep` unconditionally
  resolves Medusa's own Inventory module with no substitution flag — an
  external inventory source requires composing a custom workflow step
  in its place (supported, documented extensibility via
  `createWorkflow`/`createStep`), not a configuration toggle.
- Medusa's own maintainers document that `completeCartWorkflow` snapshots
  the cart once at the start and does not re-fetch it, explicitly
  warning integrators to revalidate price/inventory in a separate step
  beforehand — independent corroboration of the re-validation
  requirement this platform's own specs already state.

None of this evidence is invalidated by this ADR — it simply never
became load-bearing, because Medusa was never bootstrapped.
