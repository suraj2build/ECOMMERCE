# 21. Customer Profile (Customer 360)

**Status:** IMPLEMENTED (build complete 2026-09-26, "START BUILD — M22
CUSTOMER 360" authorization; most features DECIDED 2026-09-22; data
retention/deletion policy `CUST-001` remains `UNDER_REVIEW` pending
legal input and does not block this build — see
`blueprint/DECISION_REGISTER.md`). Loyalty and coupon *visibility* are
listed below as originally scoped, but M23 (Loyalty) and M24
(Promotions/Coupons) are themselves unauthorized and unbuilt — this
build represents those sections honestly as
`DEPENDENCY_DEFERRED — M23/M24`, never fabricated. See
`acceptance/m22-customer-360.md` for the full Definition of Done. This
agent does not self-declare this build certified — that determination
belongs to the independent reviewer.

## Purpose

Define the customer's account experience: profile data, address book,
order history, and self-service features.

## Scope

- Customer profile data, address book
- Order history and status visibility
- Wishlist, recently viewed, saved sizes
- Ratings/reviews, loyalty, store credit, coupons
- Communication preferences
- Data privacy/PII handling posture

## Approved requirements (2026-09-22)

The following are **required** customer-facing features (explicit,
§12): customer profile, addresses, order history, shipment tracking,
wishlist, recently viewed, saved/preferred sizes ("My Sizes"), ratings,
reviews, loyalty (balance/history), store credit (balance/history),
coupons, communication preferences.

- Address fields follow the Indian address structure
  (`specs/12-checkout.md` `IND-003`).
- Communication preferences MUST be **granular per channel** (SMS/
  WhatsApp/Email/Push) and per message type — not a single global
  toggle.
- The internal Customer-Service-facing "Customer 360" view is a
  **distinct, data-minimized view** in `specs/28-admin.md`, separate
  from this self-service profile.

## Remaining open items — UNDER_REVIEW

- **`CUST-001` — Data retention & deletion policy.** Not resolved by
  Product Owner business instruction: this is a data-protection
  **compliance/legal question requiring verification**, explicitly not
  to be settled by invented legal conclusions (§28). Tracked jointly
  with `specs/30-audit-compliance.md` `AUD-002`. **Does not block M22
  build** of the profile features above — it governs retention/deletion
  *policy*, which can be layered onto an already-built profile once
  confirmed.

## Acceptance criteria

See `acceptance/m22-customer-360.md`. Data-retention-specific
acceptance criteria are deferred pending `CUST-001`/`AUD-002`
resolution.

## Dependencies

Depends on: `specs/01-auth-rbac.md`, `specs/14-order-management.md`,
`specs/22-loyalty.md`, `specs/33-store-credit-gift-cards.md`. Feeds:
`specs/24-marketing.md`, `specs/28-admin.md`.
