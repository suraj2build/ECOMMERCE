# Security & Safety Boundaries

**Status:** APPROVED (governance baseline)

This document defines what an autonomous or semi-autonomous
engineering agent (Claude Code or otherwise) may do in this repository
and its associated environments without asking first, and what always
requires explicit human approval. This is a safety document, not a
business security-features spec (RBAC business rules live in
`specs/01-auth-rbac.md`; the general security-hardening milestone is
M29 in `BUILD_PLAN.md`).

## 1. Actions an authorized engineering agent may take autonomously

Once implementation is authorized (see `BUILD_PLAN.md`):

- Edit source code
- Create branches
- Create and run tests (unit, integration, E2E)
- Create and run **non-production** database migrations
- Run **development/local** databases and services
- Build the application
- Perform local/sandbox E2E testing
- Prepare deployment artifacts (without deploying them)

## 2. Actions that always require explicit human approval

Regardless of confidence level, task phrasing, or apparent urgency,
the following require **explicit, per-action human approval** — a
prior approval for one instance does not imply approval for future or
similar actions:

- Production deployment
- Destructive production migrations (schema drops, irreversible data
  transformations)
- Deleting production data
- Changing production credentials or secrets
- Any other irreversible production operation

These actions are out of scope for autonomous execution even after
`BUILD_PLAN.md` is unblocked, unless a future revision of this
document explicitly changes that (which itself would require human
sign-off).

## 3. Secrets

- Secrets must **never** be committed to Git, in any form (including
  in commit history, comments, or test fixtures).
- Environment requirements are represented through documented
  environment-variable **templates** (e.g. `.env.example`) with
  placeholder values only.
- If a secret is ever accidentally committed, treat it as compromised:
  rotate it and remove it from history following standard practice —
  this itself is a sensitive operation and should be flagged to the
  human project owner rather than handled silently.

## 4. Data protection principles (forward-looking)

Once customer and order data exist, the platform must (details to be
specified per-domain in `/specs`, particularly `21-customer-profile.md`
and `30-audit-compliance.md`):

- Isolate customer PII appropriately and minimize its exposure in logs.
- Enforce authorization checks on every endpoint that touches customer,
  order, payment, or inventory data — not just at the UI layer.
- Treat payment data according to the constraints of the payment
  provider abstraction (`specs/13-payment.md`) — the platform should
  avoid handling raw card data directly where a provider-hosted flow
  is available.

## 5. Dependency and supply-chain hygiene (forward-looking)

Once dependencies are introduced (M00+), they should be tracked and
kept patchable; GitHub Actions-based dependency and vulnerability
scanning should be part of M29 (Security Hardening).

## 6. Reporting

Any engineering agent that discovers a security issue (in this
project's own code, or a vulnerability class it is about to introduce)
must surface it explicitly rather than quietly working around it, and
must not disable or weaken a security control to make a task easier.
