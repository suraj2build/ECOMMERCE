# 22. Loyalty

**Status:** IMPLEMENTED (built 2026-09-27 under the "START BUILD — M23 +
M24 + M25 OVERNIGHT COMMERCIAL-ENGAGEMENT PHASE" authorization — see
`acceptance/m23-loyalty.md` for the Definition of Done and
`CLAUDE.md` §0 for the build record. Not yet independently reviewed —
`VERIFIED` is set only after that review.)

## Purpose

Define the loyalty program: how customers earn, redeem, and lose
loyalty value, backed by an auditable ledger.

## Scope

- Ledger transaction types: earn, redeem, reverse, expire, adjust
- Earn/redemption/expiry rules
- Interaction with store credit and promotions

## Approved requirements (2026-09-22)

- **Loyalty IS required. Model: POINTS + TIERS.**
- Loyalty is kept **conceptually and structurally separate** from
  store credit/cashback value and from promotions/coupons — these are
  **four distinct concepts** (loyalty points, tier/status, store
  credit/cashback, promotions/coupons), never collapsed into one data
  structure.
- Loyalty **MUST** use an auditable ledger supporting: earn, redeem,
  reverse, expire, and manual adjustment (per ADR-0013).
- **Points are earned based on qualifying purchase value.** Exact
  earning rate is a **configurable business parameter** — no fixed
  commercial percentage is set by this spec.
- **Points may be redeemed on future purchases.** Exact conversion
  rate, minimum redemption, and per-order maximum cap are configurable
  business parameters.
- **Points expire; the expiry period MUST be configurable.** This
  contrasts explicitly with store credit, which does **not** expire
  (`specs/33-store-credit-gift-cards.md`).
- Loyalty redemption MAY combine with store credit and coupon/
  promotions on the same order, **subject to configurable eligibility/
  stacking rules** (`specs/23-promotions.md` `PROMO-002`) — the
  combination is rule-driven, not unconditional.
- Any loyalty points earned on an order MUST be reversed via a ledger
  entry if that order is later cancelled or returned
  (`specs/17-cancellation.md`, `specs/18-returns.md`).

## Remaining open items

Exact earn/redemption/expiry *rates* remain intentionally configurable
business parameters, not open decisions blocking build.

## DECISION_REQUIRED — LOYALTY CLAWBACK AFTER POINTS ALREADY SPENT

**Question:** Requirement §20/§43-45 above states "any loyalty points
earned on an order MUST be reversed via a ledger entry if that order is
later cancelled or returned." What happens when the customer has
already redeemed or lost (expired) some or all of those specific points
on a *different*, unrelated order **before** the cancellation/return of
the original qualifying order occurs?

**Why it matters:** The current implementation
(`LoyaltyService.reverseForOrderLine`/`reverseForReturnLine`) caps the
balance-affecting reversal at whatever remains unconsumed in that
order's own EARN batch (`LoyaltyLedgerEntry.remainingPoints`), because
applying the full required reversal on top of an already-reduced
balance would drive `LoyaltyAccount.balance` negative — a state this
build has never modeled and does not invent semantics for. This means
a genuine shortfall can occur: the ledger's `pointsDelta` on the
REVERSE entry is smaller than what the order's own earning actually
requires to be reversed. The 2026-09-27 independent-review
certification-repair (LOY-001) closed the *visibility* gap this
created — every REVERSE entry now also records `requiredPointsDelta`
(the full, uncapped required amount), and a shortfall posts a distinct
`loyalty.reverse.shortfall` audit event naming the exact gap — so this
is never silently hidden. It does **not** resolve what should actually
happen to that shortfall, because every candidate resolution is itself
an uninvented commercial policy decision:

**Options considered:**
1. **Accept the loss** — the shortfall is recorded for audit/reporting
   only; the customer's balance is never affected further, and no
   attempt is made to recover or offset it. (This is the current
   runtime behavior by omission, not by considered choice — see the
   repair note above.)
2. **Negative balance / customer debt** — let the account balance go
   negative, to be repaid from future EARN activity. Requires deciding
   collection semantics, disclosure to the customer, and interaction
   with account closure — none of which this spec authorizes.
3. **Future-earn clawback** — silently withhold future EARN postings
   until the shortfall is repaid. Same objection as (2): an invented
   commercial mechanism with real customer-facing consequences.
4. **Cash/store-credit offset** — settle the shortfall's INR-equivalent
   value via a store-credit debit or a deduction from the
   cancellation/return's own cash refund. This crosses loyalty's own
   structural separation from store credit and from the refund amount
   itself (both already-decided, protected boundaries — see this
   spec's own "kept conceptually and structurally separate" clause and
   `REF-005`) and would require its own explicit approval.

**This spec does not select an option.** Engineering has implemented
only the visibility repair (option 1's behavior, now made honest and
fully audited rather than accidentally correct-looking) and has not
implemented options 2-4, pending an explicit Product Owner decision.
See `LOY-001`'s repair addendum in `blueprint/DECISION_REGISTER.md` for
the full technical record and `acceptance/m23-loyalty.md`'s financial-
integrity section for how this is reflected in the Definition of Done.

## Acceptance criteria

See `acceptance/m23-loyalty.md`. See `acceptance/e2e-commerce-flows.md`
FLOW 17 (earn/redeem/reverse/expire).

## Dependencies

Depends on: `specs/14-order-management.md`, `specs/17-cancellation.md`,
`specs/18-returns.md`. Feeds: `specs/21-customer-profile.md`,
`specs/27-analytics-reporting.md`.
