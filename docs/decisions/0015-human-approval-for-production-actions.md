# ADR-0015: Human approval required for production/destructive operations

## Status
Accepted

## Context
Autonomous and semi-autonomous AI engineering agents will do
significant work in this repository, including — eventually — tests,
migrations, and deployment artifact preparation. Some categories of
action are irreversible or affect real customer/business data, and a
mistaken or over-confident autonomous action in those categories could
cause serious, unrecoverable harm.

## Decision
Production deployment, destructive production migrations, deleting
production data, changing production credentials/secrets, and any
other irreversible production operation **always require explicit
human approval**, granted per-action — prior approval of one instance
never implies approval of a future or similar one. This holds
regardless of an agent's confidence, task framing, or apparent
urgency.

## Reasoning
- The cost of pausing for human confirmation on an irreversible action
  is low; the cost of an unwanted irreversible action is potentially
  very high (data loss, customer harm, outage).
- Explicit, durable documentation of this boundary (rather than
  relying on an agent's in-context judgment each time) ensures the
  boundary holds even across sessions with no memory of prior
  conversations — consistent with the remote-first model (ADR-0014).

## Consequences
- See `SECURITY.md` for the full, authoritative list of actions
  requiring approval vs. actions an authorized agent may take
  autonomously.
- This ADR cannot be silently overridden by task framing (e.g., a
  prompt that says "just deploy it, I trust you") — a change to this
  boundary requires a new ADR and explicit reconsideration, not an
  in-the-moment exception.
