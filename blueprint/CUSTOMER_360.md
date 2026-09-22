# Customer 360 Blueprint

**Purpose:** Conceptual requirements for the unified customer view,
expanding `specs/21-customer-profile.md`. Identifies privacy/security
implications without inventing legal conclusions — see
`INDIA_COMMERCE_GAPS.md` for the compliance verification items this
depends on.

## 1. Data domains that compose "Customer 360"

| Domain | Source | Notes |
|---|---|---|
| Identity | `specs/01-auth-rbac.md` | Mobile/email, verified status |
| Addresses | `specs/21-customer-profile.md` | Address book, India-specific structure (`IND-003`) |
| Orders | `specs/14-order-management.md` | Full order history and current status |
| Returns | `specs/18-returns.md` | Return history and status |
| Exchanges | `specs/20-exchanges.md` | Exchange history and status |
| Refunds | `specs/19-refunds.md` | Refund history, method, status |
| Wishlist | `specs/11-wishlist-cart.md` | Saved items |
| Recently viewed | *(not currently modeled anywhere — gap)* | Common ecommerce feature; not in any spec today |
| Size preferences | *(not currently modeled anywhere — gap)* | Could derive from order history or be explicitly captured; relates to `PROD-004` size chart work |
| Style preferences | *(not currently modeled anywhere — gap)* | Relates to `SRCH-002` personalization scope |
| Loyalty | `specs/22-loyalty.md` | Balance and transaction history, contingent on `LOY-001` |
| Coupons | `specs/23-promotions.md` | Available/used coupons for this customer |
| Communication preferences | `specs/21-customer-profile.md`, `specs/24-marketing.md` | Marketing opt-in/out (`CUST-002`) |
| Marketing consent | `specs/24-marketing.md` | Legal consent record, not just a UI toggle — see privacy note below |
| Customer service history | *(not currently modeled anywhere — gap)* | No spec currently owns a CS interaction log; relevant to `ADM-001` Customer Service role |

**Two gaps surfaced by this exercise** ("recently viewed," "customer
service history," "size/style preferences") are not present in any
current spec. They are not assigned decision IDs yet — recommend the
Product Owner confirm launch scope before adding them to the register,
since some (recently viewed) are low-cost UX additions while others
(CS history) imply a support-tooling scope decision tied to `ADM-001`.

## 2. Privacy/security implications (flagged, not resolved)

- **PII concentration risk**: a "360 view" is, by design, a single
  place where a large amount of a customer's personal data is visible
  at once. This makes RBAC scoping (`ADM-001`) for whoever can access
  this view especially important — see `SECURITY.md` §4.
- **Marketing consent is a legal record, not just a preference
  toggle**: however `CUST-002` is decided, the *history* of consent
  changes (when did the customer opt in/out, and how) likely needs to
  be retained distinctly from the current-state toggle, for
  accountability purposes. This is a **COMPLIANCE/LEGAL QUESTION
  REQUIRING VERIFICATION** — see `AUD-002`.
- **Data minimization in the CS-facing view**: an internal Customer
  360 view (`CUST-003`) used by support staff may not need to expose
  every field a customer sees in their own self-service profile (e.g.,
  full payment details) — the two views should be scoped separately,
  not treated as the same screen with different permissions bolted on.
- **Retention and deletion**: see `CUST-001` — this document doesn't
  add new information beyond flagging that "Customer 360" makes the
  retention/deletion question more consequential, since it's the
  screen that would need to reflect a deletion having happened
  correctly (no orphaned references left visible).

## 3. Open decisions

`CUST-001`, `CUST-002`, `CUST-003`, `AUD-002`, `LOY-001` (gates
loyalty section), `SRCH-002` (gates style-preference personalization).

See `DECISION_REGISTER.md` for full detail on each.
