# M17 — Shipping / Tracking Acceptance Criteria

**Spec(s):** `specs/16-shipping-tracking.md`
**Status:** IMPLEMENTED (M17 build, 2026-09-24; independent-review
repair, 2026-09-25 — see §"Independent review" below)

## Independent review

An independent reviewer examined the 2026-09-24 M17 build (baseline
commit `495dcfcede60e922ec251a17fd3dcbd2ea362047`) and found **one
BLOCKER**: `POST /webhooks/shipping/:provider` declared a per-provider
URL but never actually used `:provider` — every webhook was
authenticated/parsed by whichever provider `SHIPPING_PROVIDER` happened
to be globally configured, regardless of the URL. This broke provider
isolation the moment more than one provider identity existed (or an
in-flight shipment belonged to an earlier provider): a webhook claiming
to be from provider A would in fact be verified/parsed as the globally
active provider, never provider A specifically.

**Fixed 2026-09-25:** `ShippingService.handleCarrierWebhook` now takes
an explicit `providerName` (the route's own `:provider`, upper-cased),
resolves that SPECIFIC provider via `resolveShippingProvider` for
signature verification, event parsing, shipment lookup
(`provider: <resolved>.name`), and event dedup/recording — never
`this.provider` (the instance's globally-configured default, still used
correctly by `createShipment`/`pollPendingShipments`, which are not
per-request URL-routed). An unknown/unconfigured provider name fails
safely (400, `unknown_provider`), never a crash or a silent fallback. A
second registered test identity, `MOCK_SECONDARY` (still
`MockCarrierProvider` underneath, its own distinct webhook secret,
added specifically to prove the fix per the review's explicit
guidance — deliberately not a real carrier), lets
`test/integration/shipping.test.ts`'s new "Webhook provider dispatch
(independent-review repair)" suite prove genuine per-request provider
isolation: the configured provider's own webhook succeeds; an unknown
provider name is rejected; a signature valid for one provider never
verifies against a different provider's endpoint; a shipment booked
under one provider can never be found (let alone mutated) via a
different provider's endpoint even with a genuinely valid signature for
that endpoint; events are persisted under the provider that actually
authenticated them; and duplicate/resume dedup semantics are unchanged
after routing by provider. See `SHIP-005` in
`blueprint/DECISION_REGISTER.md` for the full repair record.

## Business acceptance

- [x] Carrier integration goes through the provider-abstraction layer
      — no carrier-specific logic exists in core fulfilment/order code.
      `ShippingProvider` (`services/commerce-api/src/modules/shipping/provider.ts`,
      ADR-0020) is the only interface `ShippingService`/routes depend
      on; carrier-specific vocabulary (raw status strings, webhook
      shapes) is normalized at the adapter boundary only. No launch
      carrier is selected (`SHIP-001`) — `MockCarrierProvider` is a
      genuine, deterministic test/reference double, honestly not
      presented as a production integration.
- [x] Customer can view shipment tracking status from their account.
      `GET /api/v1/storefront/orders/:id` (`OrderService.toView`) embeds
      a `shipment` summary (platform-normalized status, tracking ref,
      delivery attempts) per fulfilment; the storefront order-detail
      page (`apps/storefront/src/app/orders/[id]/page.tsx`) renders it.

## Functional acceptance

- [x] Tracking status updates via webhook where supported, with
      polling fallback. `ShippingService.handleCarrierWebhook`
      (durable RECEIVED/PROCESSED/FAILED dedup, mirroring
      `PaymentEvent`) and `ShippingService.pollPendingShipments`
      (`POST /api/v1/shipments/poll`, callable directly or by a future
      scheduler — no cron scheduler exists in this codebase yet, same
      shape as `InventoryService.expireStaleReservations`).
- [x] Failed delivery triggers configurable redelivery attempts before
      RTO. `SHIPPING_MAX_REDELIVERY_ATTEMPTS` (default 2, `SHIP-004`),
      snapshotted per shipment at creation (`Shipment.maxDeliveryAttempts`)
      so a later config change never retroactively alters an in-flight
      shipment's budget. Exhaustion auto-transitions to `RTO_INITIATED`
      and reuses `OrderService.markRTO` (SYSTEM-attributed) — the one
      authoritative RTO-posting point, never duplicated.
- [x] Split shipments are independently tracked and both visible to
      the customer against the same order. One `Shipment` per
      `OrderFulfilment` (1:1, `fulfilmentId` unique); proven by an
      integration test advancing one shipment to DELIVERED while a
      sibling stays IN_TRANSIT and both show correctly via the
      storefront order-detail API.

## Negative scenarios / edge cases

1. Carrier tracking data temporarily unavailable → storefront shows
   last-known platform status, not an error. `MockCarrierProvider.trackShipment`
   returning `null` (its honest "nothing new") is a no-op in
   `pollPendingShipments` — proven by an integration test.
2. Redelivery attempts exhausted → order correctly transitions to RTO
   (`acceptance/m15-order-management.md`). Proven end to end
   (`test/integration/shipping.test.ts`), including the COD
   `refundRequired: false` branch `OrderService.markRTO` already
   defines. **Documented limitation, not guessed:** for a genuinely
   mixed-state multi-shipment order (a sibling fulfilment already
   DELIVERED), `markRTO`'s existing M15/M16 guard correctly refuses
   the order-level transition — the Shipment's own `RTO_INITIATED` fact
   still commits, and an explicit `SYSTEM` audit entry flags the
   order-level rollup for human reconciliation. What order-level RTO
   should mean for that specific mixed state is a genuine open business
   question (`blueprint/DECISION_REGISTER.md`), not resolved here.

## Test requirements

- [x] Integration tests: carrier adapter interface swap (proves
      abstraction works — a mock carrier can be substituted without
      touching fulfilment logic). `test/integration/shipping.test.ts`
      "Carrier adapter substitution (SHIP-002)" registers two
      differently-configured `MockCarrierProvider` instances against
      the same `ShippingService` code, unmodified, for booking; the
      webhook side of substitution/isolation is covered by the
      dedicated "Webhook provider dispatch (independent-review repair)"
      suite (6 tests) added 2026-09-25 — see "Independent review" above.
- [x] E2E: `acceptance/e2e-commerce-flows.md` FLOW 15 (RTO). Covered by
      backend integration tests (repeated failed-delivery-attempt
      webhooks → automatic RTO, COD closure without refund) — honestly
      not a new Playwright browser spec: the storefront order-detail
      page change here is a display-only addition to the already-
      E2E-tested M15 `/orders/[id]` page (`test/e2e-storefront/orders.spec.ts`),
      and FLOW 15's own assertions (state transition, refund branching)
      are server-side business logic, not new browser interaction
      surface — the same "backend integration coverage, not a new
      browser click-path" scoping call M15/M16 already made for their
      own server-triggered transitions (RTO, exceptions).

## Definition of Done

All boxes above checked, plus `acceptance/README.md`.
