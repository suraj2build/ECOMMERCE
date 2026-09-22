# ADR-0002: Modular monolith architecture

## Status
Accepted

## Context
The platform must eventually cover a very large domain surface
(procurement through analytics — see `PRODUCT.md`). A common
temptation at this scope is to start with microservices. The project
is also local-first and must run reproducibly on a single developer
machine, and is being built by a small, AI-augmented engineering
effort rather than a large distributed team.

## Decision
Build as a **modular monolith**: one deployable application (or a
small number of clearly-scoped services) internally organized into
explicit domain modules with clear boundaries, rather than a
microservices architecture from day one.

## Reasoning
- Microservices add operational complexity (network boundaries,
  distributed transactions, service discovery, deployment
  orchestration) that is not justified before the domain model and
  team/agent workflow have stabilized.
- A modular monolith with disciplined domain boundaries preserves the
  *option* to extract services later, without paying distributed-
  systems tax now.
- It is easier to run reproducibly in local Docker Compose (see
  ADR-0009), which is a hard requirement for remote-first development.
- Domain boundaries (product, inventory, procurement, order,
  fulfilment, loyalty, etc.) must still be explicit in code
  organization even though deployment is unified — see
  `ARCHITECTURE.md` §3.

## Consequences
- Module boundaries must be enforced by convention/code organization
  (and later, lint rules) even without network boundaries forcing it.
- Cross-domain coupling (e.g., inventory code directly manipulating
  order tables) must be treated as a defect, not a convenience.
- Extracting a module into a separate service later remains possible
  but is out of scope until there's a concrete driver for it.
