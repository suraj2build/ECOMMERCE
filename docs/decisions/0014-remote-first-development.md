# ADR-0014: Remote-first development via Claude Code Web

## Status
Accepted

## Context
The project will initially be developed primarily through Claude Code
Web sessions, which are stateless between sessions (no persistent
memory of prior conversations). The repository will later also be
cloned to a desktop machine for local development. Both modes must be
fully supported without loss of fidelity.

## Decision
The project is **remote-first**: all project knowledge, decisions, and
status must live in the GitHub repository (see ADR-0010), the local
development environment must be fully reproducible via Docker Compose
(see ADR-0009), and no workflow may assume persistent memory across
Claude Code sessions.

## Reasoning
- Directly follows from how the project is actually being built —
  designing for it explicitly avoids accumulating undocumented
  "tribal knowledge" that only lived in one session.
- Ensures continuity: any future session (or human) can pick up the
  project cold and understand current state, active milestone, and
  unresolved questions purely from the repository.

## Consequences
- Every Claude Code session must treat "leave the repository in a
  state a fresh session could continue from" as part of finishing any
  task — see `CLAUDE.md` §2.
- Features or workflows that would only work if a specific machine or
  session's local state persisted are not acceptable designs.
