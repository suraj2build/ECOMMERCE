# ADR-0010: GitHub as the permanent source of truth

## Status
Accepted

## Context
This project is developed with heavy AI agent involvement across
sessions that do not share memory (particularly Claude Code Web
sessions). If architectural knowledge, decisions, or specifications
exist only in chat transcripts, that knowledge is effectively lost
between sessions and inaccessible to a fresh engineering agent or a
new human contributor.

## Decision
**GitHub is the permanent source of truth** for this project: product
vision, architecture, decisions (ADRs), specifications, build status,
and code. Anything architecturally or product-significant discussed in
a chat session (with ChatGPT, Claude Code, or otherwise) must be
written into the repository — as a spec update, an ADR, or a
`BUILD_PLAN.md`/status update — before it is considered a real,
binding decision.

## Reasoning
- Directly required by the remote-first development model (see
  `DEPLOYMENT.md` §2): a fresh Claude session must be able to
  determine everything it needs from the repository alone.
- Prevents decision drift where different sessions/agents operate on
  different, undocumented understandings of what was decided.
- Makes the project auditable — every decision has a traceable record
  with reasoning and status.

## Consequences
- Engineering agents must treat "write it into the repo" as part of
  completing a task, not an optional follow-up.
- A decision that exists only as a chat message is not yet a decision
  for implementation purposes — see `CLAUDE.md` §4 and `AGENTS.md` §3.
- Documentation maintenance (specs, ADRs, `BUILD_PLAN.md` status) is
  ongoing work, not a one-time setup task.
