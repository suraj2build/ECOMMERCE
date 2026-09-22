# Architecture deep-dives

This directory is for detailed architecture material that is too
granular for the top-level `ARCHITECTURE.md` — diagrams, data-model
deep-dives, sequence flows, and service-boundary documentation.

**Status:** empty — no application architecture has been implemented
yet (see `BUILD_PLAN.md`). Files will be added here as each milestone
is designed and built, alongside the corresponding `/specs` document.

Suggested content once implementation begins:
- Domain module map (which module owns which data/behavior)
- Data flow diagrams for cross-domain processes (e.g., order placement
  touching inventory, payment, and loyalty)
- Deployment topology diagrams (local Docker Compose vs. production)
