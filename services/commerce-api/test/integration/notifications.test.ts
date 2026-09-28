import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createTestApp } from '../helpers/app.js';
import { resetDatabase, seedRbac, seedBrandAndLocation, testPrisma } from '../helpers/db.js';
import { NotificationService } from '../../src/modules/notifications/service.js';
import { OrderService } from '../../src/modules/order/service.js';
import { __resetEnvCacheForTests } from '@fcp/config';

process.env.MARKETING_PROVIDER = 'MOCK';

/**
 * Transactional Notifications (M29, specs/29-notifications.md,
 * cross-cutting, NOTIF-001) adversarial certification. Proves: the
 * durable per-event idempotency claim (a retried/duplicated trigger
 * never double-sends), the reused CUST-002 opt-out matrix is honored
 * even for transactional messages, a genuine provider exception is
 * recorded honestly (never silently swallowed as SENT), and a real
 * domain event (order confirmation) produces a real, correctly-
 * targeted `NotificationDelivery` row via `OrderService`'s own
 * `notifyOrderConfirmed` hook - proving the wiring itself, not just the
 * `NotificationService` primitives in isolation.
 */
describe('Transactional Notifications (M29)', () => {
  let app: FastifyInstance;
  let seq = 0;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDatabase();
    await seedRbac();
    seq += 1;
  });

  async function customer(overrides: { mobile?: string } = {}) {
    return testPrisma.customer.create({
      data: { mobile: overrides.mobile ?? `9${String(1000000000 + seq).slice(0, 9)}`, fullName: 'Test Customer' },
    });
  }

  it('is idempotent: two concurrent notify() calls for the exact same event/reference converge to exactly one delivery row', async () => {
    const service = new NotificationService(app);
    const cust = await customer();
    const results = await Promise.all([
      service.notify('ORDER_CONFIRMED', cust.id, 'ref-concurrent-1', 'Your order is confirmed.'),
      service.notify('ORDER_CONFIRMED', cust.id, 'ref-concurrent-1', 'Your order is confirmed.'),
    ]);
    expect(results).toEqual([undefined, undefined]);
    const rows = await testPrisma.notificationDelivery.findMany({
      where: { event: 'ORDER_CONFIRMED', referenceId: 'ref-concurrent-1' },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe('SENT');
  });

  it('a retried trigger for the same event/reference never sends a second message', async () => {
    const service = new NotificationService(app);
    const cust = await customer();
    await service.notify('ORDER_CONFIRMED', cust.id, 'ref-retry-1', 'Your order is confirmed.');
    await service.notify('ORDER_CONFIRMED', cust.id, 'ref-retry-1', 'Your order is confirmed.');
    const rows = await testPrisma.notificationDelivery.findMany({ where: { referenceId: 'ref-retry-1' } });
    expect(rows).toHaveLength(1);
  });

  it('respects the EXISTING CUST-002 opt-out matrix - an opted-out customer is never sent, even a transactional notification', async () => {
    const service = new NotificationService(app);
    const cust = await customer();
    await testPrisma.communicationPreference.create({
      data: { customerId: cust.id, channel: 'SMS', messageType: 'ORDER_UPDATES', optedIn: false },
    });
    await service.notify('ORDER_SHIPPED', cust.id, 'ref-optout-1', 'Your order has shipped.');
    const row = await testPrisma.notificationDelivery.findUniqueOrThrow({
      where: { event_referenceId_channel: { event: 'ORDER_SHIPPED', referenceId: 'ref-optout-1', channel: 'SMS' } },
    });
    expect(row.status).toBe('SKIPPED_OPTOUT');
    expect(row.providerMessageId).toBeNull();
  });

  it('defaults to opted-in when no explicit preference row exists (ORDER_UPDATES default, CUST-002)', async () => {
    const service = new NotificationService(app);
    const cust = await customer();
    await service.notify('ORDER_SHIPPED', cust.id, 'ref-default-optin', 'Your order has shipped.');
    const row = await testPrisma.notificationDelivery.findUniqueOrThrow({
      where: { event_referenceId_channel: { event: 'ORDER_SHIPPED', referenceId: 'ref-default-optin', channel: 'SMS' } },
    });
    expect(row.status).toBe('SENT');
  });

  it('a genuine provider exception is recorded honestly as AMBIGUOUS_RECONCILIATION_REQUIRED, never silently swallowed or assumed SENT', async () => {
    process.env.MARKETING_PROVIDER = 'MOCK_UNRELIABLE';
    __resetEnvCacheForTests();
    try {
      const service = new NotificationService(app);
      const cust = await customer();
      await service.notify('REFUND_COMPLETED', cust.id, 'ref-provider-outage', 'Your refund has been processed.');
      const row = await testPrisma.notificationDelivery.findUniqueOrThrow({
        where: { event_referenceId_channel: { event: 'REFUND_COMPLETED', referenceId: 'ref-provider-outage', channel: 'SMS' } },
      });
      expect(row.status).toBe('AMBIGUOUS_RECONCILIATION_REQUIRED');
    } finally {
      process.env.MARKETING_PROVIDER = 'MOCK';
      __resetEnvCacheForTests();
    }
  });

  it('never throws even for an unknown customerId - a notification-delivery bug must never fail the authoritative operation that triggered it', async () => {
    const service = new NotificationService(app);
    await expect(service.notify('ORDER_CONFIRMED', 'not-a-real-customer-id', 'ref-unknown-customer', 'x')).resolves.toBeUndefined();
  });

  it('a real order confirmation (OrderService.createOrderFromCheckoutSession) fires a genuine ORDER_CONFIRMED notification', async () => {
    const { brand, category, location, size } = await seedBrandAndLocation();
    const cust = await customer();
    const style = await testPrisma.style.create({
      data: {
        styleCode: `NOTIF-${Date.now()}`,
        name: 'Notif Test Tee',
        brandId: brand.id,
        categoryId: category.id,
        season: 'SS26',
        collection: 'Core',
        lifecycleState: 'PUBLISHED',
      },
    });
    const colour = await testPrisma.colour.create({ data: { styleId: style.id, name: 'Black', colourCode: 'BLK' } });
    const sku = await testPrisma.sku.create({
      data: { skuCode: `${style.styleCode}-BLK-M`, styleId: style.id, colourId: colour.id, sizeId: size.id },
    });

    const checkoutSession = await testPrisma.checkoutSession.create({
      data: {
        customerId: cust.id,
        contactName: 'Test Customer',
        contactMobile: cust.mobile,
        billingAddress: {},
        shippingAddress: {},
        shippingStateCode: 'DL',
        shippingCost: 0,
        subtotal: 999,
        taxAmount: 0,
        grandTotal: 999,
        paymentMethod: 'COD',
        status: 'CONFIRMED',
        idempotencyKey: `notif-checkout-${Date.now()}`,
        lines: {
          create: [
            {
              skuId: sku.id,
              locationId: location.id,
              quantity: 1,
              unitPriceInclusive: 999,
              taxableValueSnapshot: 999,
              gstRatePercent: 0,
              taxAmountSnapshot: 0,
              lineTotalInclusive: 999,
            },
          ],
        },
      },
    });

    const orderService = new OrderService(app);
    const order = await orderService.createOrderFromCheckoutSession(checkoutSession.id);

    const rows = await testPrisma.notificationDelivery.findMany({ where: { event: 'ORDER_CONFIRMED', referenceId: order.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe('SENT');
    expect(rows[0]!.customerId).toBe(cust.id);
  });
});
