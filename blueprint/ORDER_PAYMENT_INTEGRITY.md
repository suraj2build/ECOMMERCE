# Order / Payment Integrity Blueprint

## The core principle: payment state and order state are NOT the same state machine

This is the single most important structural clarification in this
blueprint. **Payment state** (what has happened with the customer's
money) and **order state** (where the order is in its fulfilment
lifecycle) are two related but distinct state machines. A naive
implementation that uses one field to represent both (e.g., an order
row with a single `status` column doing double duty) is a predictable
source of bugs: it becomes ambiguous whether "cancelled" means "payment
was reversed" or "fulfilment was stopped," and it becomes very hard to
represent legitimate states where the two are out of sync (e.g.,
payment `captured` but order `cancelled` before shipment — a state that
*must* exist, since it's exactly what triggers a refund).

**This document does not invent the final states or transitions** —
those belong to `ORD-001` (order state machine) and `PAY-002` (payment
state machine) in `DECISION_REGISTER.md`. It documents the
*relationship* between the two state machines and the integrity
requirements that follow from keeping them separate.

## 1. Conceptual relationship

```
CART  --------->  CHECKOUT  --------->  PAYMENT ATTEMPT
                                              |
                          +-------------------+-------------------+
                          v                                       v
                   PAYMENT AUTHORIZED                      PAYMENT FAILED
                          |                                       |
                          v                                       v
                   PAYMENT CAPTURED                        (retry or abandon,
                          |                                  cart preserved
                          v                                  per PAY-005)
                   ORDER CREATED / CONFIRMED
                          |
              (order lifecycle proceeds independently
               from this point — allocation, pick, pack,
               ship, deliver — per ORD-001)
                          |
          +---------------+----------------+
          v                                v
   ORDER CANCELLED                  ORDER DELIVERED
   (pre- or post-shipment)                 |
          |                                v
          v                          (may later enter
   TRIGGERS REFUND                   RETURN / EXCHANGE,
   (payment state:                   each of which also
   captured -> refunded)             triggers REFUND)
```

Key point: **"ORDER CREATED" is downstream of payment success (or COD
confirmation), but everything after that point is the order state
machine's own concern.** A cancellation, return, or exchange changes
*order* state first, and that change is what *triggers* a *payment*
state change (a refund) — not the other way around. The payment system
should never be the source of truth for "did this order get
cancelled" — it only knows "did money move."

For COD orders specifically: there is no "capture" step in the
electronic sense — the payment state machine for COD is simpler
(`initiated -> confirmed`, collected at delivery) but conceptually
still distinct from order state. A COD order can be `cancelled` before
payment ever "happens" (no money changed hands) — the refund concept
here degenerates to "nothing to refund," but the order-state
transition is identical in shape to the prepaid case. Keeping the two
state machines separate is *what makes this unification possible*
without special-casing COD throughout the order logic.

## 2. Idempotency requirements

Every operation that changes payment or order state in response to an
external signal (a webhook, a retried API call, a duplicate user
action like double-clicking "place order") must be idempotent:

- **Payment webhook processing** (`PAY-003`, P0): each inbound webhook
  event from Razorpay carries a unique event ID; processing must be
  deduplicated by that ID before any state change or side effect
  (order confirmation, notification) occurs. A replayed or duplicated
  webhook for an already-processed event must be a safe no-op.
- **Order creation from a successful payment**: the payment-to-order
  handoff must use an idempotency key (e.g., derived from the
  checkout/cart session) so that a retried "payment succeeded" signal
  cannot create two orders for the same checkout.
- **Refund issuance**: a refund request (whether from cancellation,
  return, or exchange) must be idempotent per triggering event — a
  retried cancellation request must not issue two refunds.

## 3. Webhook handling requirements

- Webhooks are the primary way payment state changes are learned about
  asynchronously (a payment can move from `authorized` to `captured`,
  or `captured` to `failed` on a later async check, purely via
  webhook).
- The system must not assume synchronous confirmation is the only path
  to a state change — order confirmation logic must be correct whether
  triggered by a synchronous API response or an async webhook,
  including the case where the webhook arrives *before* the synchronous
  response does.
- Webhook signature verification is a security requirement (ties to
  `SECURITY.md`) — a webhook must be authenticated as genuinely from
  the payment provider before being trusted to change state.

## 4. Duplicate-event handling

Beyond simple idempotency, the system must handle:

- **Out-of-order delivery** — a webhook for an earlier state (e.g.,
  `authorized`) arriving after a later one (`captured`) has already
  been processed. State transitions should be validated against the
  current state, not blindly applied.
- **Retried client-side requests** — e.g., a customer's browser retries
  a checkout submission after a slow response; the second attempt must
  not create a duplicate order or duplicate payment attempt.

## 5. Reconciliation needs

- **Payment-to-order reconciliation**: periodic (or event-driven)
  verification that every `captured` payment has a corresponding
  confirmed order, and every confirmed prepaid order has a
  corresponding `captured` payment — discrepancies should be
  detectable, not silently tolerated.
- **COD reconciliation**: cash collected by the delivery partner must
  reconcile against the platform's record of COD orders delivered —
  see `IND-001`. This is an operational process as much as a technical
  one.
- **Refund reconciliation**: every `refunded`/`partially_refunded`
  payment state must trace back to the order-level event (cancellation,
  return, exchange) that triggered it — see `TAX-005` for the
  credit-note angle on this same reconciliation need.

## 6. Retry scenarios to design for (not yet solved — feeds `PAY-005`)

- Payment fails on first attempt; customer retries with the same or a
  different method, from the same cart. Inventory reservation
  (`INV-002`) must survive this retry window without releasing
  prematurely, but must still release if the customer abandons
  entirely.
- Payment is stuck in `pending` (e.g., a UPI collect request the
  customer hasn't acted on yet) — what timeout applies before the
  reservation is released and the payment attempt is considered
  abandoned?

## 7. What this blueprint requires of `ORD-001` and `PAY-002`

When the Product Owner (with ChatGPT) works through `ORD-001` and
`PAY-002`, the output should include, at minimum:

1. A payment state enum, independent of order state.
2. An order state enum, independent of payment state.
3. An explicit mapping table: for each order state, which payment
   states are valid/expected (e.g., an order cannot be `allocated`
   while payment is still `pending` for a prepaid order — but *can* be
   `allocated` immediately for COD, since payment there is inherently
   deferred to delivery).
4. Explicit triggers: which order-state transitions trigger which
   payment-state transitions (cancellation → refund-initiated), never
   the reverse.

This blueprint recommends this shape but does not decide it — see
`ORD-001` and `PAY-002` in `DECISION_REGISTER.md`.
