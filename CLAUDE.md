# Instructions for Claude Code in this repository

This file is read automatically by Claude Code. It is binding operating
guidance for any Claude Code session working in this repository,
including future sessions that have no memory of this one.

## 0. Current project stage — READ FIRST

**Status as of 2026-09-22:** The Product Owner's Blueprint V2 decision
session is complete. 105 of 112 registered business decisions are
`DECIDED`, 7 remain `UNDER_REVIEW` (routed to external tax/legal
compliance verification, not further Product Owner questions), and 0
remain genuinely `OPEN`. Most specs in `/specs` are now `APPROVED`, and
most milestones in `BUILD_PLAN.md` are classified
`READY_FOR_IMPLEMENTATION` at the decision level — see
`blueprint/READINESS.md` for the authoritative, current scorecard.

**This does NOT mean implementation is authorized.** Decision/spec/
milestone readiness (`blueprint/READINESS.md` Layers 1–3) is a
separate thing from implementation authorization (Layer 4):

- **No application code, frameworks, or database migrations exist,**
  and none should be added until the human project owner gives
  explicit **START BUILD** authorization — this has **not** been
  given as of this update, regardless of how many milestones show
  `READY_FOR_IMPLEMENTATION`.
- Do **not** interpret "the decisions are resolved" or "the docs are
  done" as authorization to start implementation. Authorization must
  be explicit and human-given (the literal phrase **START BUILD**),
  not inferred from documentation completeness.
- A small number of items remain `UNDER_REVIEW` for genuine
  compliance/legal reasons (India GST/tax specifics in
  `specs/32-india-tax-invoicing.md`; data-retention policy in
  `specs/21-customer-profile.md` and `specs/30-audit-compliance.md`).
  These require a qualified professional's verification, not an
  engineering agent's judgment — never resolve them yourself.

If you are unsure whether implementation is authorized, **stop and
ask** rather than proceeding.

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
