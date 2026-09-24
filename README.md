# Fashion Commerce Platform

> **Project stage (2026-09-24): PHASE 2 CERTIFICATION REPAIRS COMPLETE,
> AWAITING INDEPENDENT RE-REVIEW. M16+ NOT AUTHORIZED.** Phase 1
> (M00–M07) is `PHASE_1_CERTIFIED`. Phase 2 (M08–M15: Tax & Invoicing
> through Order Management) shipped CI-green, was independently
> reviewed, and had all nine findings from that review fixed with
> adversarial tests in a certification-repair pass — this agent does
> not self-declare `PHASE_2_CERTIFIED`; that determination is the
> independent reviewer's. M08's compliance-dependent scope
> (`TAX-001`–`005`) remains genuinely `UNDER_REVIEW`, pending external
> tax/legal verification. **No milestone beyond M15 is authorized** —
> see [`CLAUDE.md`](CLAUDE.md) §0 and [`BUILD_PLAN.md`](BUILD_PLAN.md)
> §5 (change log) for the full history and
> [`blueprint/READINESS.md`](blueprint/READINESS.md) for the readiness
> hierarchy.

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
| Application implementation | Phase 1 (M00–M07) `PHASE_1_CERTIFIED`; Phase 2 (M08–M15) implemented, CI-green, certification-repair pass complete — see `BUILD_PLAN.md` |
| M00–M07 | `IMPLEMENTED, PHASE_1_CERTIFIED` — see `BUILD_PLAN.md` |
| M08–M15 | `IMPLEMENTED`, certification-repair pass complete (2026-09-24), **AWAITING INDEPENDENT RE-REVIEW** — see `BUILD_PLAN.md` |
| M08 Tax & Invoicing Foundation (compliance-dependent scope) | `BLOCKED_COMPLIANCE` — engineering scaffolding done; `TAX-001`–`005` pending external GST/tax compliance verification |
| M16 and beyond | **NOT AUTHORIZED** |

**Decision-level readiness is not implementation authorization.** See
`CLAUDE.md` §0 and `blueprint/READINESS.md`'s six-layer hierarchy
before treating any milestone as cleared to build.

## License / ownership

Proprietary. All rights reserved by the project owner. No license is
granted for external use, reproduction, or distribution unless stated
otherwise in writing.
