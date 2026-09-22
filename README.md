# Fashion Commerce Platform

> **Project stage: BLUEPRINT V2 COMPLETE — AWAITING START BUILD.**
> Documentation, specification, and business-decision infrastructure
> is complete: 105 of 112 registered decisions are `DECIDED`, 7 remain
> `UNDER_REVIEW` pending external compliance/legal verification, and 0
> remain genuinely `OPEN`. **No application code, frameworks, or
> database migrations have been implemented yet.** Implementation
> requires a separate, explicit human **START BUILD** authorization
> that has not yet been given — see [`CLAUDE.md`](CLAUDE.md) §0 and
> [`blueprint/READINESS.md`](blueprint/READINESS.md) for the full
> readiness hierarchy.

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
4. [`blueprint/DECISION_REGISTER.md`](blueprint/DECISION_REGISTER.md) —
   **the authoritative record of every business decision** (105
   `DECIDED`, 7 `UNDER_REVIEW`, 0 `OPEN`)
5. [`blueprint/READINESS.md`](blueprint/READINESS.md) — the current
   per-milestone readiness scorecard and the six-layer readiness
   hierarchy (decision status is not the same thing as implementation
   authorization)
6. [`BUILD_PLAN.md`](BUILD_PLAN.md) — the 34-milestone sequence
   (M00–M33) and current status
7. [`specs/`](specs/) — per-domain specifications (35 files, `00`–`34`;
   most are now `APPROVED` — see each file's header and
   `specs/00-platform-overview.md`'s index table)
8. [`acceptance/`](acceptance/) — testable Definition of Done per
   milestone, plus [`acceptance/e2e-commerce-flows.md`](acceptance/e2e-commerce-flows.md)'s
   20 cross-domain scenarios
9. [`CLAUDE.md`](CLAUDE.md) / [`AGENTS.md`](AGENTS.md) — how an AI
   engineering agent should operate in this repository
10. [`TESTING.md`](TESTING.md) — what "done" means at the test-strategy
    level
11. [`SECURITY.md`](SECURITY.md) and [`DEPLOYMENT.md`](DEPLOYMENT.md) —
    safety boundaries and how the system will eventually be deployed
12. [`CONTRIBUTING.md`](CONTRIBUTING.md) — workflow for humans and agents

**No critical architectural or business-decision knowledge should ever
exist only in chat history.** If a decision was made in conversation,
it belongs in `blueprint/DECISION_REGISTER.md` and the affected spec(s)
before it is considered real.

## Repository structure

```
/
  README.md               You are here
  PRODUCT.md               Product vision (what we're building)
  ARCHITECTURE.md           Approved technical architecture baseline
  CLAUDE.md                 Instructions for Claude Code / AI engineering agents
  AGENTS.md                 Multi-agent working model (ChatGPT / Claude / Lovable)
  BUILD_PLAN.md              34-milestone sequence (M00-M33) and current status
  TESTING.md                 Testing strategy and requirements
  SECURITY.md                Security posture and safety boundaries
  DEPLOYMENT.md               Deployment model (local + future production)
  CONTRIBUTING.md             Contribution workflow

/docs
  /decisions               Architecture Decision Records (ADRs)
  /architecture             Architecture diagrams and deep-dives
  /workflows                 Business/process workflow documentation

/blueprint                 Product Blueprint V2 decision system
  DECISION_REGISTER.md      Authoritative record of all 112 decisions
  READINESS.md               Current per-milestone readiness scorecard
  (+ 12 supporting analysis documents — see blueprint/README.md)

/specs                     One specification per business domain (00-34)
                             Status: mostly APPROVED — see each file's header
                             and specs/00-platform-overview.md's index

/acceptance
  README.md                 Definition of Done and acceptance-testing approach
  mNN-*.md                    Per-milestone testable acceptance criteria (M00-M33)
  e2e-commerce-flows.md        20 cross-domain automated E2E scenarios
```

## Current status

| Item | Status |
|---|---|
| Documentation foundation | **COMPLETE** |
| Product Blueprint V2 decision session | **COMPLETE** (2026-09-22) — 105 DECIDED / 7 UNDER_REVIEW / 0 OPEN |
| Documentation consistency audit | **COMPLETE** (2026-09-22) |
| Application implementation | **NOT STARTED** — awaiting explicit **START BUILD** authorization |
| M00 Project Foundation | `READY_FOR_IMPLEMENTATION` (decision-level) — see `blueprint/READINESS.md` |
| M01 Authentication / RBAC | `READY_FOR_IMPLEMENTATION` (decision-level) — see `blueprint/READINESS.md` |
| M08 Tax & Invoicing Foundation | `BLOCKED` — pending external GST/tax compliance verification |

**Decision-level readiness is not implementation authorization.** See
`CLAUDE.md` §0 and `blueprint/READINESS.md`'s six-layer hierarchy
before treating any milestone as cleared to build.

## License / ownership

Proprietary. All rights reserved by the project owner. No license is
granted for external use, reproduction, or distribution unless stated
otherwise in writing.
