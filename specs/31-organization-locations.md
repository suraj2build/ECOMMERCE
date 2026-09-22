# 31. Organization & Locations

**Status:** APPROVED (foundational data model — decided 2026-09-22 by
Product Owner instruction; see `blueprint/DECISION_REGISTER.md`
`ORG-001`, `ORG-002`/`INV-004`)

## Purpose

Own the foundational organization, brand, and location data model that
every other domain (product, inventory, procurement, RBAC, tax) builds
on. This spec did not exist in the original 31-spec index — it was
identified as a missing domain during the Product Blueprint V2 audit
and is created now per explicit Product Owner instruction (§28 of the
2026-09-22 decision session), which required it "at minimum."

## Approved requirements

### Legal entity & brand

- The platform MUST operate as a **single legal entity/platform
  operator**.
- The platform MUST model **Brand as a first-class domain entity** —
  brand MUST NOT be implemented as uncontrolled free text on the
  product record.
- Every style/product MUST reference exactly one Brand.
- The entity model MUST support multiple internally-owned brands
  operating under the same legal entity (e.g., distinct brand
  presentation, brand-specific size charts per `specs/02-product-master.md`
  `PROD-004`), without requiring a schema change to add a new owned
  brand.
- The platform MUST NOT be modeled as a multi-tenant, third-party
  marketplace (i.e., external sellers operating storefronts inside the
  platform) at launch. This is distinct from — and MUST NOT be
  conflated with — outbound channel/marketplace **publishing** (see
  `specs/25-social-channel-publishing.md`), which is approved
  architecture (adapters only, no integrations built yet).

### Locations

- The inventory and operational data model MUST be **location-aware
  from day one**. Every inventory ledger transaction (see
  `specs/06-inventory.md`) MUST be capable of referencing a location,
  even when only one location exists.
- A Location entity MUST exist as a first-class concept (not implicit
  in a single global stock count), with at minimum: an identifier,
  type (warehouse; store and other types reserved for future use — see
  below), and status (active/inactive).
- Initial operation MUST be **warehouse-inventory only** — one or a
  small number of warehouse locations.
- Stock transfers between locations MUST be supported by the domain
  model (a `transfer_out`/`transfer_in` ledger transaction pair per
  `specs/06-inventory.md`), even though multi-location operation is
  not active at launch.

### Explicitly future scope (do not build now)

The following are **FUTURE_CONSIDERATION** — the data model MUST NOT
block them, but none are built in the current milestone plan without
separate, explicit authorization:

- Physical retail stores holding sellable inventory
- Click & collect
- Ship-from-store
- Multiple concurrent warehouse locations in active operation (the
  schema supports it; operating more than one is a later scale-out)
- Third-party marketplace sellers operating inside the platform's own
  storefront

## Blueprint references

See `blueprint/DECISION_REGISTER.md` `ORG-001`, `ORG-002`, `INV-004`.
See `blueprint/DEPENDENCY_MAP.md` for why this domain sits upstream of
Product Master, Inventory, and RBAC scoping.

## Acceptance criteria

See `acceptance/m00-project-foundation.md` — this spec's requirements
are part of the M00 foundational data model, not a standalone
milestone.

## Dependencies

Foundational — `specs/02-product-master.md` (Brand reference),
`specs/06-inventory.md` (location-aware ledger),
`specs/04-purchase-orders.md` (receiving location),
`specs/15-warehouse-fulfilment.md` (fulfilling location),
`specs/32-india-tax-invoicing.md` (GST registration may be
location/state-dependent, see `TAX-001`).
