# ADR-0017: Medusa v2 ↔ custom-domain ownership boundary

## Status
Superseded by [ADR-0019](0019-custom-platform-sole-commerce-system-of-record.md)
(2026-09-24, independent Phase 2 certification review finding #4) —
the Cart/Checkout/Order/Payment-orchestration/Fulfillment split to
Medusa this ADR planned was never carried out: M09–M15 shipped those
domains entirely on the custom platform, with no `@medusajs/*`
dependency ever installed. This ADR's spike findings (below) remain
accurate and are preserved for reference; its ownership table and
"M09 proceeds under Medusa" conclusion are superseded.

## Context

ADR-0003 established Medusa v2 as the commerce kernel, extended by
custom services "for everything Medusa does not natively cover."
ADR-0012 fixed the inventory ledger's architectural shape and required
that any conflict between Medusa's default behavior and that shape "be
resolved explicitly... and documented, not silently worked around."
ADR-0016 deferred actually bootstrapping Medusa to M09+ (Storefront/
Cart/Checkout), since Phase 1 (M00–M07) never touches commerce-kernel
territory.

M00–M07 has now shipped a real, opinionated domain model that is
*richer* than Medusa's generic defaults in every area it covers:

- **Product**: STYLE → COLOUR → SIZE → SKU (specs/02), not a generic
  Product/Variant pair. Medusa v2's Product module models products as
  a flat product-with-variants tree with option-value combinations —
  it does not natively understand "colour" and "size" as distinct
  first-class dimensions with independent lifecycle (a colourway can
  be discontinued while the style lives on), nor the STYLE-level
  enrichment/QA/publish gate (PROD-003).
- **Inventory**: an append-only ledger with row-locked, concurrency-
  safe reservation (ADR-0012, M06) — structurally incompatible with
  Medusa's default per-variant mutable-quantity Inventory module,
  exactly as ADR-0003 anticipated.
- **Pricing**: keyed to (style, colour) — never SKU/size — so uniform
  pricing across sizes (CAT-001) is structural, not a validation rule.
  Medusa's Pricing module (price lists/rules keyed to variant) does not
  model this constraint natively.
- **Customer identity**: a `Customer`/`OtpCode`/`CustomerRefreshToken`
  model already exists in this schema for mobile-OTP auth (specs/01),
  independent of any Medusa customer record.
- **Supplier/Procurement/GRN**: no Medusa equivalent at all — genuinely
  custom-service territory, uncontested.

If Medusa v2 is bootstrapped at M09 with its default modules enabled,
its own Product, Inventory, Pricing, and Customer modules would each
try to be a second, competing source of truth for exactly the entities
this repository already owns and has tested (concurrency-safe
reservation, QA/publish gating, uniform style-colour pricing). This ADR
fixes that before M09 begins, per the Product Owner's explicit
instruction to define the ownership boundary first.

## Decision

**This repository's custom domain (`services/commerce-api`) remains
the single source of truth for Product, Inventory, Pricing/Catalog,
Supplier/Procurement/GRN, and staff Auth/RBAC/Audit — permanently, not
just through Phase 1.** Medusa v2, when introduced at M09+, is scoped
to the commerce-kernel concerns this repository does not (and should
not) implement itself:

| Domain | Owner | Notes |
|---|---|---|
| Product (Style/Colour/Size/SKU) | **Custom (this repo)** | Medusa's Product module is not used to store or mutate product data. This explicitly includes the **SKU identifier** (specs/02): Medusa never mints, mutates, or holds an authoritative record for a SKU code — it only ever references the SKU id issued by this repository. |
| Inventory (on hand/reserved/available/damaged/in-transit) | **Custom (this repo)** | Medusa's default Inventory module is not enabled. Medusa's cart/checkout inventory checks call this repository's `InventoryService.reserve()`/`getBalance()` at decision time (M06, ADR-0012). This explicitly includes the **Reservation** record itself (specs/06 ledger): no reservation is ever created, extended, or released by Medusa — only by this repository's row-locked ledger, which Medusa calls synchronously and holds no copy of. |
| Pricing (MRP/selling/markdown) | **Custom (this repo)** | Medusa's Pricing module is not the price source of truth. A checkout line item's unit price is supplied explicitly from `CatalogService.getActivePrice()` at cart-build/checkout time, not computed by Medusa's price-list engine. |
| Supplier / Purchase Orders / GRN / QC | **Custom (this repo)** | No Medusa equivalent; not applicable to Medusa's scope. |
| Staff Auth / RBAC / Audit | **Custom (this repo)** | Medusa's Admin User/Auth module is not used for staff identity; this repository's permission-key RBAC (M01) remains the only staff authorization system. |
| Customer identity (mobile-OTP profile/CRM record) | **Custom (this repo)** | The existing `Customer` table (specs/01) is the CRM/profile source of truth. |
| Cart / Checkout session | **Medusa** | No competing system exists in this repository; Medusa's strength. |
| Order (post-purchase lifecycle, historical price snapshot) | **Medusa**, sourced from custom | Medusa owns the Order record and its state machine. Line-item price is snapshotted at order-creation time from this repository's Catalog service (CAT-001's "historical orders must use the actual transaction price paid" requirement) — Medusa never re-derives it from its own Pricing module. |
| Payment provider orchestration | **Medusa** | Per ADR-0011 (payment provider abstraction); Medusa's payment module is the orchestration layer. |
| Fulfillment / shipping provider orchestration | **Medusa** | No competing system in this repository. |
| Promotions / discounts | **Medusa** | Deliberately not built in M07 (Phase 1 instruction explicitly excluded Promotions); Medusa's Promotion module fills this at M09+ without conflict. |
| Region / currency / sales channel | **Medusa**, constrained | Single-region/single-currency (INR, India) at launch per CAT-001; Medusa's region module is configured to that single region, not used to introduce multi-region complexity Phase 1 didn't authorize. |
| Customer-facing account session (storefront login token) | **Medusa**, backed by custom | Medusa's storefront customer/auth session is what the browser holds; it resolves to this repository's `Customer` record by a stable external identifier (mobile number or customer id), not a Medusa-native profile. |

## Reasoning

- Every domain this repository already built is richer than Medusa's
  generic default for that domain, and two of them (Inventory, Pricing)
  are architecturally incompatible with Medusa's default model per
  ADR-0012/CAT-001. Re-platforming onto Medusa's native modules for
  those domains would mean throwing away tested, working code and
  reintroducing exactly the oversell risk M06's concurrency test exists
  to prevent.
- Domains with no Phase 1 equivalent (Cart, Checkout, Order lifecycle,
  Payment/Fulfillment orchestration, Promotions, Region) are genuinely
  Medusa's strength and were never built here — no conflict, no
  redundant system, clean adoption.
- Medusa v2's module system is explicitly designed to let an adopter
  register only the modules it needs and have cart/order workflows
  accept externally-supplied product/price/inventory data rather than
  requiring its own Product/Inventory/Pricing modules to be the
  fully-populated source. This ADR commits to that integration shape;
  it does **not** yet prove Medusa v2's workflow engine supports it
  end-to-end for every checkout path this platform needs (see
  Consequences below — that is exactly the kind of "interface for a
  later milestone" work the Phase 1 instruction said not to build
  early).

## Read models and adapters vs. sources of truth

The table above names an authoritative *owner* per domain, but several
Medusa-side entities are not themselves stores of record — they are
**read models or point-in-time adapters** over data this repository
owns. Naming the owner is not sufficient on its own; this section
makes the derived/cached side explicit so it is never mistaken for a
second authoritative copy:

| Medusa-side entity | Nature | Authoritative source it must always defer to |
|---|---|---|
| Cart line item (SKU reference, display price, product title/image) | **Read model / display cache**, captured at add-to-cart time | This repository's `CatalogService.getActivePrice()` and `InventoryService.getBalance()`. A cart's cached price/availability is for display only and goes stale the moment either changes; it is **never** read as authoritative at payment time. |
| Order line-item price | **One-time historical snapshot**, not a read model | Copied once from `CatalogService.getActivePrice()` at order-creation and frozen forever after (CAT-001). Unlike the cart cache, it is intentionally never re-synced — that immutability *is* the requirement. |
| Storefront customer session/login token | **Adapter**, resolves to an external identity | This repository's `Customer` record (specs/01), keyed by mobile number/customer id. Medusa holds no profile fields of its own that compete with the `Customer` table. |

The distinction matters operationally: a stale **read model** (the
cart) is a correctness bug to guard against with re-validation, while
a stale **snapshot** (the order price) is not a bug at all — recomputing
it would be the bug. Treating the two the same, or letting either one
silently become writable/authoritative, is exactly the "second source
of truth" failure mode this ADR exists to prevent.

## Consequences

- **Checkout must re-validate the cart's cached price and inventory
  availability against this repository's live `CatalogService`/
  `InventoryService` immediately before payment capture** — not only
  at add-to-cart time. A cart held open across a markdown change or a
  stock-out is a stale read model, not a price/availability guarantee;
  Medusa's checkout workflow must re-fetch, not trust its own cache.
- **M09's mandatory pre-implementation spike is COMPLETE (2026-09-23)
  — see "Medusa v2 integration spike — results" below.** All three
  questions this bullet originally posed are answered from direct
  inspection of the real, currently-published `@medusajs/*` v2.21.1
  packages, not assumed from memory. The ownership model is
  **technically workable**; no `DECISION_REQUIRED` escalation is
  needed. M09 proceeds, but per the spike's finding (b), it builds
  **custom** cart-add/checkout-complete workflows composed from
  Medusa's own step primitives — it does not use `addToCartWorkflow`/
  `completeCartWorkflow` unmodified.
- Medusa's Product, Inventory, Pricing, and Admin-Auth modules are
  **not installed/enabled** when Medusa v2 is bootstrapped at M09,
  unless a future ADR explicitly revises this boundary.
- A stable integration contract must exist between this repository's
  commerce-api and Medusa by M09: SKU identifiers (M02), the inventory
  reservation API (M06), and the active-price lookup (M07) must be
  callable from Medusa's workflow engine (in-process module call,
  internal HTTP, or Medusa's external data-provider pattern — the
  specific mechanism is an M09 engineering decision, not fixed here).
- Order-time price snapshotting (CAT-001) must be implemented as part
  of the Medusa Order module's checkout-completion workflow, sourced
  from this repository's Catalog service at that moment — never
  recomputed later from either system's current price.
- This ownership boundary applies **permanently**, not just at M09
  launch: a future change that would let Medusa's native Product,
  Inventory, or Pricing modules become writable/authoritative for data
  this table assigns to the custom domain requires a new ADR, not an
  incidental refactor.

## Medusa v2 integration spike — results (2026-09-23)

**Method:** `@medusajs/framework@2.21.1`, `@medusajs/types@2.21.1`,
`@medusajs/core-flows@2.21.1`, `@medusajs/cart@2.21.1`, and
`@medusajs/inventory@2.21.1` — the current published Medusa v2 line —
were installed in an isolated scratch directory and their actual
compiled workflow source and TypeScript type definitions were read
directly. This is real evidence from the current package, not a
recollection of Medusa's documentation.

**(a) External SKU reference + price without a matching Medusa
Product/Price record — CONFIRMED.**
`CreateCartCreateLineItemDTO` (`@medusajs/types`) makes `variant_id`
**optional**, alongside free-text `variant_sku`, `product_title`,
`unit_price`, etc. Reading `addToCartWorkflow`'s compiled source
(`@medusajs/core-flows/dist/cart/workflows/add-to-cart.js`) shows the
workflow computes `variantIds` from only the items that *do* carry a
`variant_id`, then gates its entire pricing/variant-resolution branch
on `when("should-calculate-prices", ...) => !!variantIds.length`. A
line item with no `variant_id` skips Medusa's Pricing module
resolution entirely and uses the caller-supplied `unit_price` as-is
(`isCustomPrice: isDefined(item.unit_price)`). A cart line referencing
our own SKU (via `variant_sku`, display-only) and our own
`CatalogService.getActivePrice()` value (via `unit_price`) requires
zero matching Medusa Product/Variant/Price record.

**(b) An external inventory-availability hook instead of Medusa's own
Inventory module — PARTIALLY CONFIRMED, WITH A CORRECTION.** Medusa
has no single named "external inventory hook" to flip on. Two things
are true simultaneously:
  - Inventory confirmation is *already skipped* for the same
    variant_id-less items pricing skips: `add-to-cart.js` computes
    `itemsToConfirmInventory` by filtering to only items with a
    resolved `variant_id`, before calling `confirmVariantInventoryWorkflow`.
    So Medusa's own inventory module is never consulted for our
    externally-priced items in the first place — nothing to disable.
  - But the stock `reserveInventoryStep` used by `completeCartWorkflow`
    (`@medusajs/core-flows/dist/cart/steps/reserve-inventory.js`)
    unconditionally does `container.resolve(Modules.INVENTORY)` —
    Medusa's own Inventory module — with no configuration flag to
    substitute a different service.
  - **Correction to this ADR's original framing:** the right pattern
    is not "configure a hook" but "compose a custom workflow." Medusa's
    Workflow SDK (`createWorkflow`/`createStep`, used throughout
    `@medusajs/core-flows`) is explicitly built for this — the same
    library's own doc-comments point integrators at custom workflows
    for comparable customization (e.g. the Subscriptions recipe
    referenced in `complete-cart.js`). M09 will build a custom
    checkout-complete workflow that calls this repository's
    `InventoryService.reserve()` as its own step in place of
    `reserveInventoryStep` for externally-priced items — supported,
    documented extensibility, not a workaround.

**(c) Re-validating price/inventory at payment-capture time rather
than trusting the cart's cached values — CONFIRMED, AND MEDUSA'S OWN
DOCS INDEPENDENTLY REQUIRE THE SAME THING.** `completeCartWorkflow`'s
doc-comment (`@medusajs/core-flows/dist/cart/workflows/complete-cart.js`)
states plainly: the workflow "retrieves the cart once at the
beginning, before any hook runs, and builds the order from that
snapshot. It doesn't re-retrieve the cart or refresh the payment
collection afterwards," and explicitly warns "Don't Mutate the Cart in
Hooks" for this reason, instructing integrators to revalidate/refresh
"in a separate step or workflow that runs before `completeCartWorkflow`."
This is exactly this ADR's Consequences requirement above, arrived at
independently by Medusa's own maintainers — strong corroboration, not
just this repository's own caution.

**Module Links (read models/adapters, for completeness):**
`defineLink` (`@medusajs/utils`) is Medusa v2's real, supported
mechanism for linking two *Medusa module* entities (with a `readOnly`
option for one-directional links). It links module-to-module, not
directly to an arbitrary external table — using it to expose this
repository's Product/Inventory/Price data inside Medusa would require
building a thin custom Medusa module around our commerce-api first,
then `defineLink`-ing it to Order/Cart as a read-only reference. This
is real, non-zero integration work for M09 to scope, not a blocker.

**Conclusion:** ADR-0017's ownership model is confirmed technically
workable by direct source inspection. M09 proceeds under the boundary
this ADR already defines, building custom cart-add and
checkout-complete workflows (composed from Medusa's own primitives)
rather than the stock ones, with an explicit price/inventory
revalidation step before `completeCartWorkflow` per (c).
