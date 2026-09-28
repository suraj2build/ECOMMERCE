import { randomUUID } from 'node:crypto';

/**
 * Channel adapter/publishing provider abstraction (M26,
 * specs/25-social-channel-publishing.md, CHAN-001). `ChannelService`
 * business logic depends only on this interface, never a specific
 * marketplace/social platform SDK directly - the same boundary
 * discipline as `ShippingProvider` (ADR-0020), `PaymentProvider`
 * (ADR-0011), and `MarketingProvider` (M25). No concrete integration has
 * been authorized (CHAN-001: "each actual integration requires separate,
 * explicit milestone authorization"): the only implementation shipped
 * here is `MockChannelProvider`, a genuine deterministic reference
 * double, never presented as a production integration. A real Meta/
 * Google Merchant/Amazon/Flipkart/Myntra/Ajio adapter is added later by
 * implementing this same interface - `ChannelService` never changes for
 * that.
 */
export type ChannelProviderName = 'MOCK' | 'MOCK_UNRELIABLE' | 'MOCK_ALWAYS_FAILS';

export interface ChannelFeedItem {
  /** Channel-mapped external identifier for this SKU - stable across resyncs. */
  externalId: string;
  title: string;
  description: string;
  price: number;
  currency: string;
  availability: 'in_stock' | 'out_of_stock';
  /** From the existing ProductMedia model (M02/M11) - null when the style/colour has no image yet. */
  imageUrl: string | null;
}

export interface ChannelPublishInput {
  channelKey: string;
  /** Channel-specific configuration (Channel.config) - never core schema. */
  config: Record<string, unknown>;
  item: ChannelFeedItem;
  idempotencyKey: string;
}

export interface ChannelPublishResult {
  status: 'SUCCESS' | 'FAILURE';
  externalId?: string;
  errorMessage?: string;
}

export interface ChannelUnpublishInput {
  channelKey: string;
  config: Record<string, unknown>;
  externalId: string;
  idempotencyKey: string;
}

export interface ChannelProvider {
  publish(input: ChannelPublishInput): Promise<ChannelPublishResult>;
  unpublish(input: ChannelUnpublishInput): Promise<ChannelPublishResult>;
}

/**
 * A genuine deterministic double - it does NOT unconditionally fabricate
 * success: a feed item missing a required field (title, or a
 * non-positive price - a channel can never legally list a priceless
 * item) genuinely fails, exactly as a real channel would reject an
 * invalid listing, rather than being silently accepted.
 */
export class MockChannelProvider implements ChannelProvider {
  async publish(input: ChannelPublishInput): Promise<ChannelPublishResult> {
    if (!input.item.title || input.item.title.trim().length === 0) {
      return { status: 'FAILURE', errorMessage: 'Missing required field: title' };
    }
    if (!(input.item.price > 0)) {
      return { status: 'FAILURE', errorMessage: 'Invalid field: price must be positive' };
    }
    return { status: 'SUCCESS', externalId: `mock-${randomUUID()}` };
  }

  async unpublish(input: ChannelUnpublishInput): Promise<ChannelPublishResult> {
    if (!input.externalId) {
      return { status: 'FAILURE', errorMessage: 'No externalId to unpublish' };
    }
    return { status: 'SUCCESS' };
  }
}

/**
 * A genuine test double that THROWS rather than returning a result - the
 * "provider call itself failed/timed out, outcome unknown" case, the
 * same idiom `UnreliableMarketingProvider` established. Deliberately not
 * a real channel, never selectable as a production value.
 */
export class UnreliableChannelProvider implements ChannelProvider {
  async publish(): Promise<ChannelPublishResult> {
    throw new Error('Simulated channel provider outage - outcome unknown');
  }
  async unpublish(): Promise<ChannelPublishResult> {
    throw new Error('Simulated channel provider outage - outcome unknown');
  }
}

/**
 * A genuine test double that returns a DEFINITE failure (never throws)
 * for every valid-looking payload - the "channel explicitly rejected the
 * listing" case, distinct from `UnreliableChannelProvider`'s "outcome
 * unknown" case. Deliberately not a real channel, never selectable as a
 * production value.
 */
export class AlwaysFailsChannelProvider implements ChannelProvider {
  async publish(): Promise<ChannelPublishResult> {
    return { status: 'FAILURE', errorMessage: 'Simulated definite channel rejection' };
  }
  async unpublish(): Promise<ChannelPublishResult> {
    return { status: 'FAILURE', errorMessage: 'Simulated definite channel rejection' };
  }
}

const CHANNEL_PROVIDERS: Record<ChannelProviderName, ChannelProvider> = {
  MOCK: new MockChannelProvider(),
  MOCK_UNRELIABLE: new UnreliableChannelProvider(),
  MOCK_ALWAYS_FAILS: new AlwaysFailsChannelProvider(),
};

export function getChannelProvider(name: string): ChannelProvider {
  const provider = CHANNEL_PROVIDERS[name as ChannelProviderName];
  if (!provider) {
    throw new Error(`Unknown channel provider "${name}" - no such provider is registered`);
  }
  return provider;
}
