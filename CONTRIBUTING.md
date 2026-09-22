# Contributing

**Status:** APPROVED (workflow baseline)

This document applies to both human contributors and AI engineering
agents (Claude Code, etc.) working in this repository.

## 1. Current stage

The project is in the **documentation/specification foundation**
stage. See `README.md` and `BUILD_PLAN.md`. Until the build plan is
explicitly unblocked by the human project owner, contributions should
be limited to:

- Documentation and specification improvements
- ADRs recording genuinely new architectural decisions
- Corrections to this control structure itself

Application code, framework installation, and database migrations are
out of scope until authorized.

## 2. Branching

- Work happens on feature/task branches, never directly on the
  default branch.
- Branch names should be descriptive of the work being done.
- Claude Code sessions typically work on an assigned branch per task —
  see the session's own instructions for the exact branch name in use.

## 3. Commits

- Commit messages should be clear and describe *why*, not just *what*.
- Do not bundle unrelated changes (e.g., a spec status change and an
  unrelated ADR) into a single commit when they can reasonably be
  split — but don't over-fragment either; use judgment.
- Never commit secrets (see `SECURITY.md`).

## 4. Changing a spec's status

- `DRAFT` -> `UNDER_REVIEW`: any contributor may propose this when a
  spec is believed ready for review.
- `UNDER_REVIEW` -> `APPROVED`: **human project owner only.**
- `APPROVED` -> `IMPLEMENTING`: set by the engineering agent when work
  starts.
- `IMPLEMENTING` -> `IMPLEMENTED`: set by the engineering agent when
  the Definition of Done (`acceptance/README.md`) is satisfied.
- `IMPLEMENTED` -> `VERIFIED`: set after independent/human
  verification — not by the implementing agent itself.

## 5. ADRs

- New architectural decisions get a new file in `docs/decisions/`
  following the existing numbering and template (see
  `docs/decisions/0001-record-architecture-decisions.md`).
- Don't edit the substance of an already-`Accepted` ADR to reflect a
  new decision — write a new ADR that supersedes it, and mark the old
  one `Superseded`.

## 6. Pull requests

- PRs should reference the milestone or spec they relate to.
- Do not open a PR that mixes documentation/spec changes with
  application code changes once implementation begins, unless the
  code change is what makes the spec update necessary (e.g.
  implementation revealed a spec ambiguity).

## 7. Definition of Done

No work — documentation or code — is considered complete until it
satisfies the relevant checklist in `acceptance/README.md`.

## 8. Questions and unresolved decisions

If you are unsure whether something is authorized, decided, or in
scope: check `BUILD_PLAN.md`, the relevant spec's status, and
`SECURITY.md`. If still unclear, don't guess — raise it as
`DECISION_REQUIRED` (see `CLAUDE.md` §4) or ask the human project
owner directly.
