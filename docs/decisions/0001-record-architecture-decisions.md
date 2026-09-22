# ADR-0001: Record architecture decisions

## Status
Accepted

## Context
The project must avoid architectural knowledge existing only in chat
history, especially since development happens primarily through
Claude Code Web sessions that do not persist memory between sessions.
We need a durable, versioned record of *why* each significant
technical decision was made, not just *what* was decided.

## Decision
We will use lightweight Architecture Decision Records (ADRs) stored in
`docs/decisions/`, numbered sequentially (`NNNN-title.md`), following
this template: Status, Context, Decision, Reasoning, Consequences.

Every ADR has one of these statuses:
- `Proposed` — under discussion, not yet binding
- `Accepted` — approved and binding
- `Superseded` — replaced by a later ADR (link to it)
- `Rejected` — considered and explicitly not adopted

## Reasoning
ADRs are cheap to write, easy to scan, and force explicit reasoning to
be captured at decision time rather than reconstructed later. This
directly supports the remote-first development requirement (see
`DEPLOYMENT.md` §2): a fresh engineering agent must be able to
understand what's approved and why from the repository alone.

## Consequences
- Every ADR referenced in `ARCHITECTURE.md` must exist in this
  directory.
- Changing a previously `Accepted` decision requires a new ADR that
  supersedes the old one, not silent edits to the original.
