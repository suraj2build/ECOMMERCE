# ADR-0017: Medusa v2 ↔ custom-domain ownership boundary

## Status
Accepted

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
| Product (Style/Colour/Size/SKU) | **Custom (this repo)** | Medusa's Product module is not used to store or mutate product data. |
| Inventory (on hand/reserved/available/damaged/in-transit) | **Custom (this repo)** | Medusa's default Inventory module is not enabled. Medusa's cart/checkout inventory checks call this repository's `InventoryService.reserve()`/`getBalance()` at decision time (M06, ADR-0012). |
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

## Consequences

- **M09 (Storefront Foundation) must begin with a spike**, not
  straight implementation: validate that Medusa v2's Cart/Checkout
  workflows can (a) accept a cart line item with an externally-supplied
  SKU reference and unit price without a matching Medusa Product/Price
  record, and (b) call an external inventory-availability hook (this
  repository's `InventoryService.reserve()`) instead of its own
  Inventory module at checkout time. If either is not cleanly
  supported by Medusa v2's current module/workflow API, that is a
  **DECISION_REQUIRED** architectural escalation before M09 continues
  — not something to silently work around with a sync/cache layer that
  reintroduces a second source of truth.
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
