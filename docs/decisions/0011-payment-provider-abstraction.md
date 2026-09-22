# ADR-0011: Payment provider abstraction, Razorpay first, COD supported

## Status
Accepted

## Context
Payment providers change over time for business reasons (cost,
geographic coverage, feature support). Order and checkout logic that
is written directly against a specific provider's API becomes
expensive to change later and risks provider-specific assumptions
leaking into core commerce logic. The platform must support at least
one online gateway and Cash on Delivery (COD) as a non-gateway
payment method from the start.

## Decision
All payment integrations go through an internal **provider-abstraction
layer**. Order/checkout logic depends only on this abstraction, never
on a specific provider's SDK or API shape. **Razorpay** is the first
online payment provider implemented; **COD** is supported as a
non-gateway payment method. Future providers must be addable by
implementing the abstraction, without modifying order/checkout logic.

## Reasoning
- Decouples the (frequently changing) payment-provider landscape from
  the (comparatively stable) order lifecycle logic — see
  `PRODUCT.md` §2.D and `specs/14-order-management.md`.
- Razorpay is a well-supported gateway relevant to the platform's
  initial target market; COD is a common requirement in the same
  market and must be modeled as a first-class payment method, not a
  special case bolted onto the gateway flow.
- An abstraction layer also makes payment logic easier to test in
  isolation (mocked provider) — see `TESTING.md`.

## Consequences
- No order/checkout/refund code may import or reference a specific
  payment provider's SDK directly — only the abstraction interface.
- Exact abstraction interface design and Razorpay-specific
  integration details are specified in `specs/13-payment.md` (status:
  DRAFT until approved).
- Refunds and exchanges (`specs/19-refunds.md`, `specs/20-exchanges.md`)
  must also go through the same abstraction, including for COD orders
  (e.g., refund-to-bank/UPI flows).
