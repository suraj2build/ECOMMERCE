# Storefront Customer Journeys

**Status update (2026-09-22):** Every decision ID referenced throughout
this document as an "open decision" is now `DECIDED` — see
`blueprint/DECISION_REGISTER.md`. Where this document says "not yet
decided" or "open decision," that describes the state *before*
2026-09-22. A few genuinely UX-level implementation choices below
(exact mobile navigation pattern, image-gallery interaction style) are
**engineering-default choices**, not business blockers — they're
finalized at M09/M11 implementation time per `CLAUDE.md`'s technical-
decision-authority guidance, not tracked as pending decisions.

**Purpose:** Document customer journeys and flows conceptually —
happy paths, empty states, validation failures, network/payment
failures, out-of-stock situations, and mobile-specific considerations.
**This does not design final UI** — it identifies what the UI must
account for, feeding `specs/08-storefront.md` and downstream specs.

## Visitor types

| Type | Entry characteristics | Key journey differences |
|---|---|---|
| Anonymous visitor | No account, no prior session data | Full discovery journey available; checkout gated by `CHK-001` guest-checkout decision |
| New customer | Just created an account or completing first purchase | Needs clear onboarding (address entry, OTP verification per `AUTH-001`) |
| Returning customer | Has order history, possibly loyalty balance | Benefits from personalization (`SRCH-002`), saved addresses, reorder patterns |
| Search-led visitor | Arrives via search engine to a specific PDP/PLP (SEO, `26-seo.md`) | First impression is a deep page, not the homepage — must stand alone |
| Category-led visitor | Arrives via a category link (e.g., from a marketing channel) | Lands on PLP, not PDP |
| Campaign/social visitor | Arrives via a marketing campaign (`24-marketing.md`) or social channel (`25-social-channel-publishing.md`) link | Often lands on a curated collection page; attribution tracking implications for `ANL-001` |

## Core flow: Discover → Purchase

### 1. Discover (homepage / category entry)
- **Happy path:** Visitor lands, sees curated content (new arrivals,
  collections), navigates to a category.
- **Empty state:** No applicable case at this stage (homepage always
  has content once catalog exists) — but a *newly launched* platform
  with a thin catalog needs a defined minimum-content policy, not
  currently addressed anywhere.
- **Mobile-specific:** Navigation must collapse to a mobile-appropriate
  pattern (hamburger/bottom-nav — engineering-default choice at M09
  implementation time, `SF-001` **DECIDED** at the component-foundation
  level).

### 2. PLP (browse / filter / sort)
- **Happy path:** Visitor applies filters (category, size, color,
  price), sorts results, browses.
- **Empty state:** Filter combination returns zero results — must show
  a clear "no results" state with a way to relax filters (not
  currently specified).
- **Validation failure:** N/A (filters are selections, not free input)
  unless a price-range input is free-text.
- **Mobile-specific:** Filter UI needs a mobile pattern (bottom sheet,
  full-screen overlay) distinct from desktop sidebar filters.
- **Decision status:** `SRCH-001` (ranking), `CAT-003` (taxonomy) — both
  **DECIDED**.

### 3. PDP (product detail, variant selection, size guide)
- **Happy path:** Visitor selects color/size, views images, adds to
  cart or wishlist.
- **Empty state / edge case:** Selected variant (a specific size in a
  specific color) is out of stock — **DECIDED (engineering default)**:
  show size availability inline in the size selector (sizes with no
  stock shown disabled/struck through), consistent with
  `specs/10-pdp.md`'s "out-of-stock sizes are visibly disabled" 
  requirement.
- **Validation failure:** Attempting to add to cart without selecting
  a required variant (e.g., size) — must block with a clear inline
  message, not a silent failure.
- **Mobile-specific:** Image gallery interaction (swipe vs. thumbnail
  strip) and sticky add-to-cart bar — engineering-default choices at
  M11 implementation time, consistent with `specs/10-pdp.md`'s mobile/
  desktop behavior requirements.
- **Decision status:** `PDP-001` (reviews), `PROD-004` (size guide
  content), `PROD-005` (model measurements) — all **DECIDED**.

### 4. Wishlist
- **Happy path:** Visitor saves an item for later.
- **Empty state:** Empty wishlist — needs a clear call-to-action back
  to browsing.
- **Edge case:** Guest wishlist and login — see `CART-001`.
- **Mobile-specific:** Wishlist icon/heart affordance must be
  touch-friendly.

### 5. Cart
- **Happy path:** Visitor reviews items, adjusts quantity, applies a
  coupon (`23-promotions.md`), proceeds to checkout.
- **Empty state:** Empty cart — call-to-action back to browsing.
- **Validation failure:** Invalid/expired coupon code — must show a
  clear inline error, not silently ignore it.
- **Edge case — stock changed since add-to-cart:** An item added
  earlier is now out of stock or price changed — the cart must
  re-validate against current catalog/inventory state before checkout
  and clearly surface any change to the customer (this is a real
  integrity requirement, not just UX polish — ties to `INV-002`).
- **Mobile-specific:** Line-item quantity controls must be usable at
  touch scale.

### 6. Login/Signup (if not already authenticated)
- **Happy path:** OTP-based login (pending `AUTH-001`), fast and
  low-friction.
- **Validation failure:** Invalid OTP, expired OTP — clear retry path
  with a resend option and rate limiting (ties to `SECURITY.md` and
  `NFR-006`).
- **Edge case:** Guest checkout may skip this step entirely, depending
  on `CHK-001`.
- **Mobile-specific:** OTP auto-read from SMS (common Android pattern)
  — nice-to-have, not yet scoped.

### 7. Address
- **Happy path:** Visitor selects a saved address or enters a new one.
- **Validation failure:** Invalid PIN code, incomplete required fields
  — inline validation needed (ties to `IND-003`).
- **Edge case — non-serviceable PIN code:** Must clearly communicate
  non-serviceability *before* the customer completes the rest of
  checkout, not after payment (ties to `IND-002`, `CHK-004`).
- **Mobile-specific:** Address form length is a common mobile
  conversion drop-off point — auto-complete (`IND-003`) materially
  helps here.

### 8. Shipping (method selection, if applicable)
- **Happy path:** Visitor sees shipping cost/timeline and confirms.
- **Edge case:** Free-shipping threshold not met — common pattern is
  to show "add ₹X more for free shipping" (ties to `IND-005`); not
  currently specified as a requirement.

### 9. Payment
- **Happy path:** Visitor selects a payment method (card/UPI/net
  banking/COD per `IND-004`, `IND-001`) and completes payment.
- **Validation failure:** Payment form validation errors (invalid
  card, etc.) — largely handled by the provider's hosted flow, per
  `PAY-006`'s PCI-posture assumption.
- **Network/payment failure:** Payment fails or times out — see
  `END_TO_END_FLOWS.md` flow 16. The customer must be able to retry
  without losing their cart or re-entering address/shipping info.
- **Edge case — duplicate submission:** Customer double-taps "Pay Now"
  on a slow connection — must not create two payment attempts (ties to
  `PAY-003` idempotency requirement).
- **Mobile-specific:** UPI intent-based flow (switching to a UPI app
  and back) is an India-specific mobile pattern that needs explicit
  handling — app-switch-and-return must correctly resume the checkout
  state.

### 10. Order confirmation
- **Happy path:** Order confirmation screen + notification
  (`29-notifications.md`).
- **Edge case:** Payment succeeded but order confirmation page fails
  to load (e.g., connection drop right after payment) — the
  notification (email/SMS) must be a reliable fallback confirmation
  channel, not solely the on-screen confirmation.

### 11. Tracking
- **Happy path:** Visitor views shipment status via account or a
  tracking link (`16-shipping-tracking.md`).
- **Empty state:** Order confirmed but not yet shipped — show a clear
  "preparing your order" state rather than a blank/broken tracking
  view.
- **Edge case:** Carrier tracking data temporarily unavailable — must
  degrade gracefully (show the platform's own last-known status)
  rather than showing an error.

### 12. Cancellation / Return / Exchange / Refund (post-purchase)
- **Happy path:** Visitor initiates from order history, following the
  eligibility rules in `CAN-001`/`RET-001`/`EXC-001`.
- **Edge case — not eligible:** Must clearly explain *why* (window
  expired, category excluded) rather than just hiding the option.
- **Validation failure:** Required fields for return reason/photos (if
  required) not provided.
- **Mobile-specific:** Photo upload for return/damage reporting (see
  `END_TO_END_FLOWS.md` flow 14) needs a mobile-camera-friendly upload
  flow.

### 13. Loyalty
- **Happy path:** Visitor views balance and redeems at checkout
  (contingent on `LOY-001` existing at all).
- **Empty state:** No loyalty program, or customer has zero balance —
  must not show a broken/confusing UI if `LOY-001` decides against a
  program, or before the customer's first qualifying order.

---

## Cross-cutting concerns for every step above

- **Mobile-first is the default assumption**, not an enhancement layer
  — per `ARCHITECTURE.md` §2, every flow above must be designed
  mobile-first and then adapted for desktop, not the reverse.
- **Network reliability** in the target market can be inconsistent —
  every state-changing action (add to cart, apply coupon, place order)
  needs a defined behavior for a slow/dropped connection, not just a
  happy-path implementation.
- **Empty states are not optional polish** — several above (empty
  PLP results, empty cart, empty wishlist, no orders yet) are
  first-run experiences for real users and should be designed
  deliberately.

## Decisions referenced across journeys — all DECIDED (2026-09-22)

`AUTH-001`, `CHK-001`, `CHK-004`, `IND-001` through `IND-005`,
`INV-002`, `PAY-003`, `PAY-006`, `SF-001`, `SRCH-001`, `PDP-001`,
`PROD-004`, `PROD-005`, `CAN-001`, `RET-001`, `EXC-001`, `LOY-001`.

Every ID above is `DECIDED` in `blueprint/DECISION_REGISTER.md` as of
2026-09-22. This document's journey-level detail remains a useful UX
reference; it is no longer tracking open business decisions.
