import { randomUUID } from 'node:crypto';
import type { CommunicationChannel } from '@fcp/db';

/**
 * Marketing message provider abstraction (M25, specs/24-marketing.md
 * MKT-001). Campaign-sending logic depends only on this interface,
 * never a specific SMS/WhatsApp/Email/Push vendor's SDK directly - same
 * boundary discipline as `ShippingProvider` (ADR-0020) and
 * `PaymentProvider` (ADR-0011). No launch provider has been selected
 * (MKT-001: "deferred to operational decision"): the only
 * implementation shipped here is `MockMarketingProvider`, a genuine
 * deterministic test/reference double, never presented as a production
 * integration. A real provider is added later by implementing this same
 * interface - `MarketingService` business logic never changes for that.
 */
export type MarketingProviderName = 'MOCK' | 'MOCK_UNRELIABLE' | 'MOCK_ALWAYS_FAILS';

export interface MarketingMessageInput {
  /** Channel-appropriate destination: an email address (EMAIL) or mobile number (SMS/WHATSAPP). */
  to: string;
  channel: CommunicationChannel;
  subject?: string;
  content: string;
  /** Used as the provider-call idempotency key - `campaignId:customerId`. */
  idempotencyKey: string;
}

export interface MarketingMessageResult {
  status: 'SENT' | 'FAILED';
  providerMessageId?: string;
  errorMessage?: string;
}

export interface MarketingProvider {
  send(input: MarketingMessageInput): Promise<MarketingMessageResult>;
}

/**
 * A genuine deterministic double - it does NOT unconditionally fabricate
 * success (the phase's own "no fake campaign delivery success" rule):
 * an empty/malformed destination address genuinely fails, exactly as a
 * real provider would reject an invalid recipient, rather than being
 * silently accepted.
 */
export class MockMarketingProvider implements MarketingProvider {
  async send(input: MarketingMessageInput): Promise<MarketingMessageResult> {
    if (!input.to || input.to.trim().length === 0) {
      return { status: 'FAILED', errorMessage: 'No valid destination address for this channel' };
    }
    return { status: 'SENT', providerMessageId: `mock-${randomUUID()}` };
  }
}

/**
 * A genuine test double that THROWS rather than returning a result -
 * exactly the "provider call itself failed/timed out, outcome unknown"
 * case `MarketingService`'s Blocker 4 repair must handle honestly
 * (AMBIGUOUS_RECONCILIATION_REQUIRED, never a blind resend). Deliberately
 * not a real carrier - the same "second registered test identity" idiom
 * `MOCK_SECONDARY` already established for shipping-provider dispatch
 * tests (SHIP-005), never selectable as a production MARKETING_PROVIDER value.
 */
export class UnreliableMarketingProvider implements MarketingProvider {
  async send(): Promise<MarketingMessageResult> {
    throw new Error('Simulated provider outage - outcome unknown');
  }
}

/**
 * A genuine test double that returns a DEFINITE failure (never throws)
 * for every valid-looking destination - the "provider explicitly
 * rejected the message" case, distinct from `UnreliableMarketingProvider`'s
 * "outcome unknown" case. `MockMarketingProvider` alone cannot exercise
 * this path: it only ever returns FAILED for an empty/malformed `to`,
 * which `MarketingService` already intercepts earlier as
 * SKIPPED_NO_ADDRESS before any provider call is made. Deliberately not
 * a real carrier, never selectable as a production MARKETING_PROVIDER value.
 */
export class AlwaysFailsMarketingProvider implements MarketingProvider {
  async send(): Promise<MarketingMessageResult> {
    return { status: 'FAILED', errorMessage: 'Simulated definite provider rejection' };
  }
}

const MARKETING_PROVIDERS: Record<MarketingProviderName, MarketingProvider> = {
  MOCK: new MockMarketingProvider(),
  MOCK_UNRELIABLE: new UnreliableMarketingProvider(),
  MOCK_ALWAYS_FAILS: new AlwaysFailsMarketingProvider(),
};

export function getMarketingProvider(name: string): MarketingProvider {
  const provider = MARKETING_PROVIDERS[name as MarketingProviderName];
  if (!provider) {
    throw new Error(`Unknown marketing provider "${name}" - no such provider is registered`);
  }
  return provider;
}
