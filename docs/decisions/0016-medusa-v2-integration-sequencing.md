# ADR-0016: Medusa v2 integration deferred to storefront/commerce milestones

## Status
Superseded by [ADR-0019](0019-custom-platform-sole-commerce-system-of-record.md)
(2026-09-24) — the deferred integration described here never happened;
M09+ shipped entirely on the custom platform. Kept for historical
context (its Phase 1 "no Medusa dependency during M00–M07" decision
remains accurate history).

## Context
ADR-0003 established Medusa v2 as the commerce kernel, extended by
custom Node.js/TypeScript services "for everything Medusa does not
natively cover (procurement/PO/GRN, inventory ledger, loyalty ledger,
fashion-specific attribute model, etc.)." ADR-0003's own consequences
section anticipated that Medusa's default inventory model conflicts
with the ledger requirement (ADR-0012) and that such conflicts "must
be resolved explicitly... and documented, not silently worked around."

Phase 1 (START BUILD authorization, 2026-09-22) covers milestones
M00–M07: project foundation, auth/RBAC, product master, suppliers,
purchase orders, GRN/QC, inventory, and catalog/pricing. None of these
domains are commerce-kernel territory as Medusa v2 defines it (cart,
checkout, order, region/currency, storefront commerce APIs) — they are
exactly the "custom service" domains ADR-0003 anticipated. Medusa v2
becomes directly relevant starting at Storefront Foundation (M09) and
Wishlist/Cart (M12) onward, where cart/order/checkout primitives are
actually exercised.

## Decision
Phase 1 (M00–M07) is implemented as custom Node.js/TypeScript domain
services against PostgreSQL directly (via Prisma), **without**
bootstrapping the Medusa v2 framework. Medusa v2 is integrated starting
at the milestone where its commerce-kernel primitives are first
exercised (Storefront Foundation / Cart / Checkout, M09+), at which
point this repository's inventory ledger (M06) is wired as Medusa's
inventory provider rather than replaced by Medusa's default model —
consistent with ADR-0003's and ADR-0012's binding requirements.

## Reasoning
- Avoids pulling in and configuring a large framework dependency
  (Medusa v2's plugin system, its own migration set, its own admin/
  storefront API surface) before any Phase 1 milestone's acceptance
  criteria exercises it — directly follows the Product Owner's Phase 1
  instruction not to implement later-domain interfaces "merely because
  interfaces may eventually exist."
- Keeps the Phase 1 codebase's module boundaries clean: product
  master, suppliers, procurement, GRN, inventory, and catalog are
  genuinely custom-service domains per the original architecture
  decision, not commerce-kernel domains.
- Preserves the option (required by ADR-0003/ADR-0012) to make
  Medusa's cart/order layer consume this repository's own inventory
  ledger as its inventory source of truth, rather than Medusa's
  default per-variant quantity model, when Medusa is introduced.

## Consequences
- No `@medusajs/*` dependency is installed during Phase 1.
- The Phase 1 Prisma schema and domain services must be designed so
  that a Medusa v2 integration layer (introduced at M09+) can consume
  them without a Phase 1 rewrite — in particular, the inventory ledger
  (M06) and product/SKU identifiers (M02) must be stable, addressable
  contracts a later Medusa inventory-provider adapter can call into.
- This ADR itself is the documentation-synchronization record required
  by `CLAUDE.md` §8/§18 for this sequencing decision — it is a
  technical/engineering decision under the Phase 1 instruction's
  "sensible engineering decisions within constraints" authorization,
  not a business decision requiring Product Owner sign-off.
