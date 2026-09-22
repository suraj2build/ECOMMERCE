# Fashion Commerce Platform

> **Project stage: FOUNDATION.** This repository currently contains
> documentation and specification infrastructure only. **No application
> code, frameworks, or database migrations have been implemented yet.**
> See [`BUILD_PLAN.md`](BUILD_PLAN.md) for why the build plan is
> currently **BLOCKED**.

## What this is

An independent, production-grade, end-to-end men's and women's fashion
commerce platform — eventually a full **Fashion Commerce Operating
System** spanning procurement, inventory, catalog, storefront, checkout,
fulfilment, returns, loyalty, marketing, and analytics.

See [`PRODUCT.md`](PRODUCT.md) for the full product vision and
[`ARCHITECTURE.md`](ARCHITECTURE.md) for the approved technical baseline.

## Start here (for a fresh engineering agent or a new contributor)

Read in this order:

1. [`PRODUCT.md`](PRODUCT.md) — what we're building and why
2. [`ARCHITECTURE.md`](ARCHITECTURE.md) — the approved technical baseline
3. [`docs/decisions/`](docs/decisions/) — Architecture Decision Records (ADRs)
4. [`BUILD_PLAN.md`](BUILD_PLAN.md) — milestone sequence and current status
5. [`specs/`](specs/) — per-domain specifications (mostly `DRAFT` today)
6. [`CLAUDE.md`](CLAUDE.md) / [`AGENTS.md`](AGENTS.md) — how an AI
   engineering agent should operate in this repository
7. [`TESTING.md`](TESTING.md) and [`acceptance/README.md`](acceptance/README.md) —
   what "done" means
8. [`SECURITY.md`](SECURITY.md) and [`DEPLOYMENT.md`](DEPLOYMENT.md) —
   safety boundaries and how the system will eventually be deployed
9. [`CONTRIBUTING.md`](CONTRIBUTING.md) — workflow for humans and agents

**No critical architectural knowledge should ever exist only in chat
history.** If a decision was made in conversation, it belongs in an ADR
or a spec before it is considered real.

## Repository structure

```
/
  README.md            You are here
  PRODUCT.md            Product vision (what we're building)
  ARCHITECTURE.md        Approved technical architecture baseline
  CLAUDE.md              Instructions for Claude Code / AI engineering agents
  AGENTS.md              Multi-agent working model (ChatGPT / Claude / Lovable)
  BUILD_PLAN.md           Milestone sequence and current status (BLOCKED)
  TESTING.md              Testing strategy and requirements
  SECURITY.md             Security posture and safety boundaries
  DEPLOYMENT.md           Deployment model (local + future production)
  CONTRIBUTING.md         Contribution workflow

/docs
  /decisions            Architecture Decision Records (ADRs)
  /architecture          Architecture diagrams and deep-dives
  /workflows             Business/process workflow documentation

/specs                  One specification per business domain (00-30)
                         Status: mostly DRAFT — see each file's header

/acceptance
  README.md              Definition of Done and acceptance-testing approach
```

## Current status

| Item | Status |
|---|---|
| Documentation foundation | IN PROGRESS (this commit) |
| Product Blueprint V2 | **NOT YET PROVIDED — required before implementation** |
| Application implementation | **NOT STARTED — BLOCKED** |
| M00 Project Foundation (code) | **BLOCKED**, see `BUILD_PLAN.md` |

## License / ownership

Proprietary. All rights reserved by the project owner. No license is
granted for external use, reproduction, or distribution unless stated
otherwise in writing.
