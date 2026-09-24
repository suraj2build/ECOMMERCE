import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Carrier provider abstraction (ADR-0020, specs/16-shipping-tracking.md
 * SHIP-002). Shipment/tracking logic depends only on this interface,
 * never a specific carrier's SDK directly - same boundary discipline as
 * `PaymentProvider` (ADR-0011). No launch carrier has been selected
 * (SHIP-001 - "does not block building the abstraction"): the only
 * implementation shipped here is `MockCarrierProvider`, a genuine
 * deterministic test/reference double, never presented as a production
 * carrier integration. A real carrier is added later by implementing
 * this same interface - `OrderService`/`WarehouseService`/`ShippingService`
 * business logic never changes for that.
 *
 * Carrier-specific vocabulary (whatever raw status strings a real
 * carrier's webhook/tracking API uses) is normalized into the
 * platform-owned `NormalizedTrackingStatus` union at the adapter
 * boundary - `parseWebhookEvent`/`trackShipment` are the only places
 * that ever see carrier-specific terminology; everything past them
 * (ShippingService, the DB, the storefront) speaks only the platform's
 * own vocabulary. See `ShipmentTrackingStatus` in schema.prisma for the
 * DB-persisted superset (adds the platform-only pre-carrier `CREATED`
 * status, which no carrier ever emits).
 */

export type CarrierName = 'MOCK';

/**
 * The subset of ShipmentTrackingStatus a CARRIER can report. Deliberately
 * excludes `CREATED` (a platform-only pre-booking state - no carrier
 * event ever produces it) and `BOOKED` is included only as the initial
 * post-booking acknowledgement some carriers send.
 */
export type NormalizedTrackingStatus =
  | 'BOOKED'
  | 'IN_TRANSIT'
  | 'OUT_FOR_DELIVERY'
  | 'DELIVERY_FAILED'
  | 'DELIVERED'
  | 'RTO_INITIATED'
  | 'RTO_DELIVERED';

export interface ShipmentBookingInput {
  /** The platform's own Shipment.id - used as the carrier-call idempotency key (SHIP §7). */
  shipmentId: string;
  orderNumber: string;
  fulfilmentId: string;
  destinationPincode: string;
  weightGrams?: number;
}

export interface ShipmentBookingResult {
  status: 'BOOKED' | 'UNAVAILABLE';
  providerShipmentRef?: string;
  /** AWB / carrier tracking number, where the carrier assigns one at booking time. */
  trackingRef?: string;
  message?: string;
}

export interface CarrierTrackingEvent {
  /** Present for a genuine webhook delivery; absent for a poll-derived snapshot (no event to dedup on). */
  providerEventId?: string;
  providerShipmentRef: string;
  rawStatus: string;
  normalizedStatus: NormalizedTrackingStatus;
  occurredAt: Date;
  description?: string;
}

export interface ShippingProvider {
  readonly name: CarrierName;
  initiateShipment(input: ShipmentBookingInput): Promise<ShipmentBookingResult>;
  /** Verifies a raw webhook body against the provider's signature header. Never throws - returns false on any mismatch/misconfiguration. */
  verifyWebhookSignature(rawBody: string, signatureHeader: string): boolean;
  /** Parses an already-signature-verified raw webhook body into a provider-agnostic event. Throws on a shape it doesn't recognize. */
  parseWebhookEvent(rawBody: string): CarrierTrackingEvent;
  /** Polling fallback (SHIP-003): current known status for a shipment, or null if the carrier has nothing new to report. */
  trackShipment(providerShipmentRef: string): Promise<CarrierTrackingEvent | null>;
}

const MOCK_RAW_STATUS_MAP: Record<string, NormalizedTrackingStatus> = {
  picked_up: 'BOOKED',
  in_transit: 'IN_TRANSIT',
  out_for_delivery: 'OUT_FOR_DELIVERY',
  delivery_attempt_failed: 'DELIVERY_FAILED',
  delivered: 'DELIVERED',
  rto_initiated: 'RTO_INITIATED',
  rto_delivered: 'RTO_DELIVERED',
};

function normalizeMockStatus(rawStatus: string): NormalizedTrackingStatus {
  const normalized = MOCK_RAW_STATUS_MAP[rawStatus];
  if (!normalized) throw new Error(`MockCarrierProvider: unrecognized raw status '${rawStatus}'`);
  return normalized;
}

/**
 * Deterministic mock/reference carrier adapter (ADR-0020). Booking is
 * idempotent-by-shipmentId (derives the same providerShipmentRef/
 * trackingRef every time for the same local shipment id, no randomness)
 * so a retry after a crash between "carrier call succeeded" and "local
 * commit" never double-books - the same discipline
 * RazorpayPaymentProvider relies on Razorpay's own idempotency header
 * for; this mock has no real external system to ask, so it achieves the
 * same property by being a pure function of its input.
 *
 * `webhookSecret` is constructor-injectable (default a fixed test-only
 * value) specifically so integration tests can register two
 * differently-configured instances and prove `ShippingService` behaves
 * identically against either - the substitution proof
 * `acceptance/m17-shipping-tracking.md` requires, without needing a
 * second carrier actually built.
 */
export class MockCarrierProvider implements ShippingProvider {
  readonly name: CarrierName = 'MOCK';

  constructor(private readonly webhookSecret: string = 'mock-carrier-webhook-secret-test-only') {}

  async initiateShipment(input: ShipmentBookingInput): Promise<ShipmentBookingResult> {
    const providerShipmentRef = `MOCK-SHP-${input.shipmentId}`;
    const trackingRef = `MOCKAWB${input.shipmentId.replace(/-/g, '').slice(0, 12).toUpperCase()}`;
    return { status: 'BOOKED', providerShipmentRef, trackingRef };
  }

  verifyWebhookSignature(rawBody: string, signatureHeader: string): boolean {
    if (!signatureHeader) return false;
    const expected = createHmac('sha256', this.webhookSecret).update(rawBody).digest('hex');
    const expectedBuf = Buffer.from(expected, 'hex');
    const actualBuf = Buffer.from(signatureHeader, 'hex');
    if (expectedBuf.length !== actualBuf.length) return false;
    return timingSafeEqual(expectedBuf, actualBuf);
  }

  parseWebhookEvent(rawBody: string): CarrierTrackingEvent {
    const payload = JSON.parse(rawBody) as {
      id?: string;
      shipment_ref: string;
      status: string;
      occurred_at?: string;
      description?: string;
    };
    if (!payload.shipment_ref || !payload.status) {
      throw new Error('MockCarrierProvider: webhook payload missing shipment_ref/status');
    }
    return {
      // No top-level event id in every delivery, same fallback discipline as
      // RazorpayPaymentProvider.parseWebhookEvent - a stable synthetic id
      // derived from the shipment ref + status + occurred_at so a genuine
      // duplicate delivery (identical body) still dedups correctly.
      providerEventId: payload.id ?? `${payload.shipment_ref}:${payload.status}:${payload.occurred_at ?? ''}`,
      providerShipmentRef: payload.shipment_ref,
      rawStatus: payload.status,
      normalizedStatus: normalizeMockStatus(payload.status),
      occurredAt: payload.occurred_at ? new Date(payload.occurred_at) : new Date(),
      description: payload.description,
    };
  }

  async trackShipment(): Promise<CarrierTrackingEvent | null> {
    // The mock has no external system to poll for new state - honest
    // "nothing new" rather than fabricating carrier progress.
    // ShippingService's own poll path already treats null as "leave
    // last-known platform status untouched" (SHIP-003 polling fallback;
    // acceptance negative scenario #1's graceful degradation).
    return null;
  }
}

const providerRegistry: Record<CarrierName, () => ShippingProvider> = {
  MOCK: () => new MockCarrierProvider(),
};

export function resolveShippingProvider(name: string): ShippingProvider {
  const factory = providerRegistry[name as CarrierName];
  if (!factory) {
    throw new Error(
      `Unknown or unconfigured shipping provider '${name}' - no real carrier is selected yet (SHIP-001, ` +
        `blueprint/DECISION_REGISTER.md). Set SHIPPING_PROVIDER to a registered provider name.`,
    );
  }
  return factory();
}
