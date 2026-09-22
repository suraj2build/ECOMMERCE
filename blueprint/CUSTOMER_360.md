# Customer 360 Blueprint

**Status update (2026-09-22):** Most of this document's originally
open items were explicitly resolved by the Product Owner's instruction
§12, which lists "recently viewed" and "saved/preferred sizes ('My
Sizes')" as **required** customer features. See
`specs/21-customer-profile.md` "Approved requirements" for the
resulting normative text.

**Purpose:** Conceptual requirements for the unified customer view,
expanding `specs/21-customer-profile.md`. Identifies privacy/security
implications without inventing legal conclusions — see
`INDIA_COMMERCE_GAPS.md` for the compliance verification items this
depends on.

## 1. Data domains that compose "Customer 360"

| Domain | Source | Notes |
|---|---|---|
| Identity | `specs/01-auth-rbac.md` | Mobile/email, verified status |
| Addresses | `specs/21-customer-profile.md` | Address book, India-specific structure (`IND-003` — **DECIDED**) |
| Orders | `specs/14-order-management.md` | Full order history and current status |
| Returns | `specs/18-returns.md` | Return history and status |
| Exchanges | `specs/20-exchanges.md` | Exchange history and status |
| Refunds | `specs/19-refunds.md` | Refund history, method, status |
| Wishlist | `specs/11-wishlist-cart.md` | Saved items |
| Recently viewed | **DECIDED — required** | Explicit customer feature per Product Owner §12; now in `specs/21-customer-profile.md`. |
| Saved/preferred sizes ("My Sizes") | **DECIDED — required** | Explicit customer feature per Product Owner §12; now in `specs/21-customer-profile.md`. |
| Style preferences (personalized) | **DECIDED — deferred** | `SRCH-002`: personalization is `FUTURE_CONSIDERATION`, not launch scope. |
| Loyalty | `specs/22-loyalty.md` | Balance and transaction history — `LOY-001` **DECIDED** (points + tiers, program exists) |
| Coupons | `specs/23-promotions.md` | Available/used coupons for this customer |
| Communication preferences | `specs/21-customer-profile.md`, `specs/24-marketing.md` | Marketing opt-in/out — `CUST-002` **DECIDED** (granular per-channel/per-message-type) |
| Marketing consent | `specs/24-marketing.md` | Legal consent record, not just a UI toggle — see privacy note below |
| Customer service history | *(still not modeled anywhere — genuine remaining gap)* | Not named in the Product Owner's §12 required-features list; no spec currently owns a CS interaction log. Non-blocking — recommend the Product Owner confirm scope if/when Customer Service tooling (`specs/28-admin.md`) is built out further. |

**One gap remains** ("customer service history") — everything else
this section originally flagged is now `DECIDED`.

## 2. Privacy/security implications (flagged, not resolved)

- **PII concentration risk**: a "360 view" is, by design, a single
  place where a large amount of a customer's personal data is visible
  at once. This makes RBAC scoping (`ADM-001`) for whoever can access
  this view especially important — see `SECURITY.md` §4.
- **Marketing consent is a legal record, not just a preference
  toggle**: the granular per-channel opt-in model is now `DECIDED`
  (`CUST-002`); the *history* of consent changes (when did the
  customer opt in/out, and how) likely still needs to be retained
  distinctly from the current-state toggle, for accountability
  purposes. This remains a **COMPLIANCE/LEGAL QUESTION REQUIRING
  VERIFICATION** — see `AUD-002`, still `UNDER_REVIEW`.
- **Data minimization in the CS-facing view**: **DECIDED** (`CUST-003`)
  — a distinct, data-minimized internal Customer 360 view exists in
  `specs/28-admin.md`, separate from the customer's own self-service
  profile.
- **Retention and deletion**: `CUST-001` remains `UNDER_REVIEW` —
  a genuine data-protection compliance question, not resolved by this
  session's business decisions. "Customer 360" makes this question more
  consequential (the screen must correctly reflect a deletion once the
  policy is confirmed), but does not itself block building the profile
  features above.

## 3. Decision status (updated 2026-09-22)

**Resolved (`DECIDED`):** `CUST-002`, `CUST-003`, `LOY-001`, `SRCH-002`.

**Still `UNDER_REVIEW`** (compliance verification, not a Product Owner
business question): `CUST-001`, `AUD-002`.

See `blueprint/DECISION_REGISTER.md` for full detail on each.
