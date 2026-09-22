# Multi-Agent Working Model

**Status:** APPROVED (working-model baseline)

This document defines the roles and responsibilities of the different
AI collaborators (and the human project owner) on this project, and
the boundaries between them. It complements `CLAUDE.md`, which is
Claude-specific operating instructions.

## 1. Roles

### Human project owner

- Final authority on all product and business decisions.
- Approves specs (`DRAFT` -> `APPROVED`), ADRs, and milestone
  authorization.
- Sole authority to authorize implementation start (**START BUILD**).
  Product Blueprint V2 (see `blueprint/DECISION_REGISTER.md`) is
  complete as of 2026-09-22 and most `BUILD_PLAN.md` milestones are
  `READY_FOR_IMPLEMENTATION` at the decision level, but that alone
  does not authorize implementation — see `CLAUDE.md` §0 and
  `blueprint/READINESS.md` for the distinction between decision
  readiness and implementation authorization.
- Sole authority for any production/high-risk action (see
  `SECURITY.md`).

### ChatGPT — Product Owner / Product Architect / specification partner

- Produces and iterates the product blueprint and business
  specifications in collaboration with the human project owner.
- Proposes business rules for domains in `/specs` (order lifecycle,
  returns/refunds policy, loyalty rules, promotion rules, etc.).
- Does **not** write application code in this repository and does
  **not** unilaterally mark a spec `APPROVED` — that is the human
  project owner's call, informed by ChatGPT's recommendation.

### Claude Code — Principal Engineering Agent

- Implements `APPROVED` specifications, following `BUILD_PLAN.md`
  milestone order.
- Maintains architecture, ADRs, tests, and the codebase.
- Never invents unresolved business rules (see `CLAUDE.md` §4).
- Never independently reinterprets an unresolved business decision as
  permission to invent the rule.
- Owns keeping GitHub as the accurate, permanent source of truth for
  what has actually been decided and built.

### Lovable — UI exploration / acceleration only

- May be used for rapid UI/visual exploration and prototyping.
- Its output, if used, must be reviewed and integrated deliberately —
  it is a design-acceleration tool, not an architectural authority.
- **Must not** become the owner of architecture or core business
  logic. Any business logic Lovable produces must be re-implemented
  or reviewed against the approved architecture and specs before it
  is trusted in the platform's core services.

## 2. Decision authority matrix

| Decision type | Who decides |
|---|---|
| Business rules / product behavior | Human project owner (via ChatGPT collaboration) |
| Technical architecture within approved baseline | Claude Code, following `ARCHITECTURE.md` and ADR process |
| New architectural direction / deviation from baseline | Human project owner (new ADR required) |
| Spec status `DRAFT` -> `APPROVED` | Human project owner |
| Milestone unblock / implementation authorization | Human project owner only |
| Production / destructive operations | Human project owner only, explicit approval each time |
| UI visual exploration | Lovable, reviewed before adoption |

## 3. Handoff protocol

- Any decision made in a ChatGPT conversation that should bind
  implementation must be written into the relevant `specs/NN-*.md`
  file (status updated accordingly) or a new ADR — **before** Claude
  Code acts on it. Claude Code should not implement based on a
  second-hand paraphrase of an external conversation.
- Any architecturally significant decision made while working with
  Claude Code must be recorded in an ADR, not left only in session
  history.
- If Lovable-produced UI is adopted, note it in the relevant spec or
  ADR so the provenance of that code is traceable.

## 4. Escalation

If any agent (ChatGPT, Claude Code, or Lovable-driven work) encounters
an unresolved question outside its authority, it must surface the
question explicitly (e.g. `DECISION_REQUIRED` in a spec) rather than
proceeding on an assumption.
