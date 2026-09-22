# ADR-0003: Medusa v2 as commerce kernel

## Status
Accepted

## Context
The platform needs core commerce primitives — product/variant
modeling, cart, checkout, order, pricing, regions/currencies — rather
than reinventing all of them from scratch. Building a fully custom
commerce kernel would be a large undertaking that duplicates
well-solved problems, while a fully hosted SaaS commerce platform
would violate the local-first, cloud-portable, and deep-customization
requirements (fashion-specific product model, inventory ledger,
loyalty ledger, multi-domain lifecycle in `PRODUCT.md`).

## Decision
Use **Medusa v2** (open-source, Node.js/TypeScript, self-hostable) as
the commerce kernel — the foundation for product/variant, cart,
checkout, order, and pricing primitives — extended and integrated with
custom Node.js/TypeScript services for everything Medusa does not
natively cover (procurement/PO/GRN, inventory ledger, loyalty ledger,
fashion-specific attribute model, etc.).

## Reasoning
- Medusa v2 is TypeScript-native, self-hostable, and modular, which
  fits the modular-monolith direction (ADR-0002) and local-first
  requirement (ADR-0009).
- It provides a modern commerce data model and APIs as a starting
  point, reducing the amount of undifferentiated commerce plumbing
  that must be built and tested from scratch.
- Using it as a **kernel** (not the entire platform) keeps the
  fashion-specific and operations-specific domains (inventory ledger,
  procurement, loyalty ledger — see `ARCHITECTURE.md` §§5–6) as
  first-class custom modules rather than forcing them into a generic
  commerce platform's assumptions.

## Consequences
- Custom services must integrate with Medusa v2's module system and
  data model rather than duplicating what it already provides.
- Where Medusa v2's default behavior conflicts with a required
  architectural principle (e.g., inventory-as-ledger vs. Medusa's
  default inventory model), the conflict must be resolved explicitly
  in the relevant spec (`specs/06-inventory.md`) and documented, not
  silently worked around.
- Upgrading Medusa major versions in the future is a deliberate,
  reviewed decision, not an incidental side effect of a dependency
  bump.
