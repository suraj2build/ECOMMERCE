# ADR-0020: Carrier provider abstraction for shipping/tracking

## Status
Accepted

## Context
`specs/16-shipping-tracking.md` (SHIP-002) requires carrier
integration to go through the same kind of provider-abstraction layer
already established for payments (ADR-0011): carriers change over
time for operational reasons (cost, service area, SLA), and no launch
carrier has been selected (`SHIP-001` — DECIDED-architecture: build
the abstraction now, defer the specific carrier(s) to operations
configuration). Core order/fulfilment logic that referenced a specific
carrier's API shape directly would make that future carrier decision
expensive to change and would risk carrier-specific assumptions
leaking into the certified M15/M16 order/warehouse domain model.

## Decision
All carrier integrations go through an internal **`ShippingProvider`**
abstraction (`services/commerce-api/src/modules/shipping/provider.ts`),
mirroring `PaymentProvider`'s shape and boundary discipline. Order/
fulfilment/shipping-service logic depends only on this interface,
never a specific carrier's SDK or API shape. A single deterministic
**`MockCarrierProvider`** is the only implementation shipped in this
milestone — a genuine test/reference double, not a production carrier
integration — proving the interface is real and substitutable rather
than a redundant hard-coded provider name. A future real carrier
(Delhivery, Shiprocket, Bluedart, etc. — the specific choice is
deliberately not made here, per `SHIP-001`) must be addable by
implementing this same interface, without modifying `OrderService`,
`WarehouseService`, or `ShippingService`'s own business logic.

## Reasoning
- Decouples the (frequently changing, still-undecided) carrier
  landscape from the (comparatively stable, already-certified) order/
  fulfilment lifecycle — same rationale as ADR-0011 §Reasoning,
  applied to the carrier boundary instead of the payment-gateway one.
- `SHIP-001` explicitly permits building the abstraction ahead of the
  carrier decision: "specific carrier(s) selected via configuration,
  confirmed operationally before go-live, does not block building the
  abstraction." Shipping a mock-only implementation, honestly labelled
  as such, satisfies that without inventing credentials or pretending
  a carrier has been selected.
- Keeps carrier-specific terminology (whatever status strings,
  webhook payload shapes, or event types a real carrier eventually
  uses) normalized at the adapter boundary — the platform's own
  `ShipmentTrackingStatus` enum, not carrier vocabulary, is the only
  status core services and the storefront ever see.

## Interface shape (as implemented)
`initiateShipment` / `verifyWebhookSignature` / `parseWebhookEvent` /
`trackShipment` — same split-signature-verification-from-parsing shape
`PaymentProvider` uses for the same reason (a webhook payload isn't
trustworthy enough to even record under its claimed event id before
its signature is checked). No `refund`/`cancel`-equivalent method:
`specs/16-shipping-tracking.md`'s approved scope does not require
carrier-side shipment cancellation, and `SHIP-002`/the M17 build
instruction both direct against overbuilding a universal logistics SDK
beyond what this milestone's acceptance criteria actually need.

## Consequences
- No order/fulfilment/webhook-route code may import or reference a
  specific carrier's SDK directly — only the `ShippingProvider`
  interface and `resolveShippingProvider()`.
- `ShippingService.createShipment`/`handleCarrierWebhook` depend only
  on the interface; the acceptance test for M17
  (`test/integration/shipping.test.ts`) proves adapter substitution by
  registering a second, differently-configured mock adapter and
  showing the same `ShippingService` code path works unchanged against
  it — the same proof shape ADR-0011 established for `PaymentProvider`.
- Real-carrier integration work (actual REST calls, real webhook
  signature schemes, real AWB formats) is deferred to whichever future
  milestone/operational decision selects a launch carrier; this ADR's
  interface is the contract that integration must implement.
