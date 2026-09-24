# Instructions for Claude Code in this repository

This file is read automatically by Claude Code. It is binding operating
guidance for any Claude Code session working in this repository,
including future sessions that have no memory of this one.

## 0. Current project stage — READ FIRST

**Status as of 2026-09-24: `PHASE 2 CERTIFICATION REPAIRS COMPLETE,
AWAITING INDEPENDENT RE-REVIEW. M16+ NOT AUTHORIZED.`** Phase 1
(M00–M07) completed an expanded engineering certification pass and was
accepted by the human project owner as **`PHASE_1_CERTIFIED`** at
commit `240debca8179df0b05db07216cfce64d0b10d0ae`. On 2026-09-23 the
human project owner gave explicit **"START BUILD — PHASE 2"**
authorization, scoped specifically to milestones **M08 through M15**
(Tax & Invoicing Foundation through Order Management), again with an
explicit instruction to **stop after M15 certification** for
independent review rather than self-authorizing M16+. On 2026-09-23
all of M08–M15 were implemented and confirmed CI-green; an independent
reviewer then examined that build and returned nine numbered findings
(three BLOCKER, two BLOCKER/HIGH, one HIGH, three lower-severity) —
see `blueprint/DECISION_REGISTER.md`'s cross-references and the
per-finding commits on `claude/loving-fermat-cyucke` for the full
detail. On 2026-09-24 this agent was given a separate, explicit
**certification-repair authorization** scoped ONLY to fixing those
nine findings in the existing M08–M15 implementation - not a new
build, not M16+. All nine findings now have a corresponding fix,
adversarial test, and updated documentation, and the full clean-state
suite (lint, typecheck, build, unit, integration, migration-from-zero,
Playwright E2E desktop+mobile) is green. A subsequent independent
re-review of that repaired state returned two further findings
(Blocker 1: same-request credit-note over-credit; Blocker 2: payment-
event dedup could suppress recovery of a genuinely-failed webhook
event). On 2026-09-24 this agent received a second, explicitly scoped
**final certification repair pass** authorization covering ONLY those
two blockers - again not a new build, not M16+. Both are now fixed
with adversarial regression tests and updated documentation (see
`acceptance/m08-tax-invoicing-foundation.md` and
`acceptance/m14-payment.md`), and the full clean-state suite is green
again. **This agent still does not self-declare `PHASE_2_CERTIFIED`** -
that determination belongs to the independent reviewer, who has not
yet re-reviewed this second repair. This agent has stopped per that
instruction and is awaiting independent human re-review before any
M16+ work. Status remains, more precisely: **`PHASE 2 BUILD COMPLETE —
AWAITING INDEPENDENT CERTIFICATION`**.

**M00–M07 remain the certified, protected baseline.** Phase 2 work
MUST NOT regress: the STYLE→COLOUR→SIZE→SKU hierarchy, the inventory
ledger, reservation atomicity/oversell prevention, GRN atomicity,
pricing invariants, RBAC, audit history, idempotency, database
constraints, clean-clone reproducibility, or CI. Every Phase 1 test
remains mandatory and must stay green.

**This authorization does NOT extend beyond M15.**
Decision/spec/milestone readiness (`blueprint/READINESS.md` Layers
1–3) remains a separate thing from implementation authorization
(Layer 4):

- **M16 and every later milestone remain unauthorized.** No
  application code for M16+ should be added until the human project
  owner gives a new, separate, explicit **START BUILD** authorization
  for that phase — the Phase 2 authorization does not carry forward
  automatically, regardless of how cleanly M08–M15 land.
- Do **not** interpret "Phase 2 shipped cleanly" as authorization for
  the next phase. Authorization must be explicit and human-given for
  each phase.
- M08 is explicitly authorized to proceed now as a **configurable
  compliance architecture** — GST registrations, HSN/rate reference
  data, and e-invoice applicability are all engineering-configurable,
  never hard-coded, and the system must fail safely when that
  configuration is absent. This is *not* the same as resolving the
  underlying compliance/legal questions (`TAX-001`–`005` in
  `blueprint/DECISION_REGISTER.md`) — those still require a qualified
  professional's verification before real GSTIN/rate/HSN values are
  entered as production configuration, and must never be guessed by
  an engineering agent. Data-retention policy
  (`specs/21-customer-profile.md`, `specs/30-audit-compliance.md`)
  remains `UNDER_REVIEW` for the same reason.
- M09 must begin with the mandatory Medusa v2 integration spike
  required by `docs/decisions/0017-medusa-custom-domain-ownership-boundary.md`
  before other M09 work proceeds. If the spike shows the ownership
  model is not technically workable, stop and raise
  `DECISION_REQUIRED` rather than quietly changing ownership.
  **Historical note (2026-09-24, Phase 2 independent-certification
  repair, finding #4):** the spike was carried out and found the split
  workable, but M09-M15 were then actually built entirely on the
  custom platform - Medusa was never bootstrapped, and
  Cart/Checkout/Payment/Order are custom `services/commerce-api`
  domains like every other row in the ownership table.
  `docs/decisions/0019-custom-platform-sole-commerce-system-of-record.md`
  supersedes ADR-0003/0016/0017 and is now the live ownership decision;
  treat it, not ADR-0017, as authoritative for any future work touching
  this question.

If you are unsure whether implementation is authorized for a given
milestone, **stop and ask** rather than proceeding.

## 1. Your role

You are the **Principal Engineering Agent** for this project (see
`AGENTS.md` for the full multi-agent model). Concretely:

- You implement **approved** specifications from `/specs`.
- You never silently convert a `DRAFT` or unresolved business question
  into an implemented rule. If something is unresolved, mark it
  `DECISION_REQUIRED` in the relevant spec and stop — do not guess.
- You keep GitHub as the **permanent source of truth**. Anything
  architecturally important that was only discussed in chat must be
  written into a doc/spec/ADR before it's considered real.
- You follow the milestone sequence in `BUILD_PLAN.md`. Do not skip
  ahead to a later milestone because it seems easy or related.

## 2. Reading order for a fresh session

1. `README.md`
2. `PRODUCT.md`
3. `ARCHITECTURE.md`
4. `docs/decisions/` (ADRs) — especially any with status `APPROVED`
5. `blueprint/DECISION_REGISTER.md` — authoritative business-decision
   status (105 DECIDED / 7 UNDER_REVIEW / 0 OPEN as of 2026-09-22)
6. `blueprint/READINESS.md` — current per-milestone readiness and the
   decision-readiness-vs-implementation-authorization hierarchy
7. `BUILD_PLAN.md` — milestone sequence and current status
8. The specific `specs/NN-*.md` file relevant to the task at hand
9. `TESTING.md` and `acceptance/README.md` (plus the relevant
   `acceptance/mNN-*.md`) — Definition of Done
10. `SECURITY.md` — safety boundaries on what you may do autonomously

## 3. Document status system

Every spec in `/specs` carries a status:

`DRAFT` -> `UNDER_REVIEW` -> `APPROVED` -> `IMPLEMENTING` -> `IMPLEMENTED` -> `VERIFIED`

Rules:

- You may only **implement** a spec whose status is `APPROVED` or
  later, and only within a milestone that `BUILD_PLAN.md` says is
  unblocked and active.
- When you begin implementing an approved spec, update its status to
  `IMPLEMENTING`. When implementation is complete and passes the
  Definition of Done, update it to `IMPLEMENTED`. `VERIFIED` is set
  after independent/human verification — do not set this yourself.
- You may freely edit `DRAFT` specs to improve clarity, but you may
  not mark your own draft `APPROVED` — that requires human/product
  owner sign-off (see `AGENTS.md`).

## 4. Handling unresolved business decisions

If an important business rule is not yet specified:

1. Do **not** invent it, even if the answer "seems obvious."
2. Add a clearly marked block to the relevant spec:

   ```
   ## DECISION_REQUIRED

   Question: <the specific unresolved question>
   Why it matters: <what breaks or gets built wrong if guessed>
   Options considered (if any): <...>
   ```

3. Stop work on the parts of the task that depend on that decision.
   Continue only on parts that don't depend on it, if any.

## 5. The future autonomous development loop

Once implementation is authorized, the intended loop per milestone is:

```
READ APPROVED SPEC
  -> REVIEW ACCEPTANCE CRITERIA
  -> PLAN
  -> IMPLEMENT
  -> RUN
  -> TEST
  -> DIAGNOSE FAILURES
  -> FIX
  -> RETEST
  -> REVIEW
  -> COMMIT
  -> UPDATE BUILD STATUS
  -> NEXT APPROVED MILESTONE
```

This loop is **documented but not active**. Do not start executing it
until the human project owner explicitly authorizes implementation
start with **START BUILD** — Product Blueprint V2 itself is already
complete (see §0); that alone is not the authorization.

## 6. Safety boundaries

See `SECURITY.md` for the full policy. Summary: editing source,
branching, writing/running tests, non-production migrations, local
dev databases, builds, and local/sandbox E2E are within an
authorized engineering agent's normal autonomy. Production deployment,
destructive production migrations, deleting production data, changing
production credentials/secrets, and other irreversible production
operations always require explicit human approval, regardless of how
confident the agent is.

## 7. Definition of Done

Do not report a milestone complete because code exists. See
`acceptance/README.md` for the full Definition of Done checklist that
must be satisfied first.

## 8. Repository conventions

- Secrets are never committed. Use environment-variable templates
  (e.g. `.env.example`) once those exist — never real credentials.
- Keep specs, ADRs, and build status **up to date as you work** —
  these are not write-once documents.
- Prefer small, reviewable commits with clear messages over large
  unreviewable ones, once implementation begins.
