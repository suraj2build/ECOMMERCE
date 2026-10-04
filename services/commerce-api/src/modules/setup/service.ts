import type { FastifyInstance } from 'fastify';
import { loadEnv, mockProvidersAllowed } from '@fcp/config';
import { BANNER_PLACEMENTS, MENU_PLACEMENTS } from '../cms/placements.js';
import { ProductMediaService } from '../product/media-service.js';

export type SetupStatus = 'configured' | 'incomplete' | 'test_failed' | 'unavailable';
/** business = the owner changes it in admin; deployment = set on the server (environment), never in admin. */
export type SettingKind = 'business' | 'deployment' | 'both';

export interface SetupArea {
  key: string;
  title: string;
  status: SetupStatus;
  kind: SettingKind;
  summary: string;
  missing: string[];
  impact: string;
  next: { label: string; href?: string } | null;
  details: Array<{ label: string; value: string }>;
}

const yes = (b: boolean) => (b ? 'Yes' : 'No');

/**
 * Admin Ops Phase 1: the owner's Setup & health view. Read-only facts from
 * the database and the server's configuration. Secrets are never returned -
 * only whether one is present. A provider is never called "connected"
 * because credentials exist: where no real connection test exists, the
 * status says so. The one live test here (media storage) really writes,
 * reads and deletes a probe object, and only when the owner asks.
 */
export class SetupService {
  constructor(private readonly fastify: FastifyInstance) {}

  private get prisma() {
    return this.fastify.prisma;
  }

  async overview(): Promise<{ areas: SetupArea[]; environment: { stage: string; mocksAllowed: boolean } }> {
    const env = loadEnv();
    const production = !mockProvidersAllowed(env);
    const areas: SetupArea[] = [];

    // 1. Business details
    const entities = await this.prisma.legalEntity.findMany({ where: { isActive: true }, include: { gstRegistrations: true } });
    const activeGst = entities.flatMap((e) => e.gstRegistrations).filter((g) => g.status === 'ACTIVE');
    {
      const missing: string[] = [];
      if (entities.length === 0) missing.push('Legal business name and registered address');
      const entity = entities[0];
      if (entity && !(entity.registeredAddressLine1 && entity.registeredCity && entity.registeredState && entity.registeredPinCode)) missing.push('Complete registered address');
      if (entity && !entity.pan) missing.push('PAN');
      if (activeGst.length === 0) missing.push('An active GST registration (GSTIN)');
      areas.push({
        key: 'business',
        title: 'Business details',
        status: missing.length === 0 ? 'configured' : 'incomplete',
        kind: 'business',
        summary: entity ? entity.legalName : 'Not set up',
        missing,
        impact: 'Tax invoices need the legal name, address and an active GSTIN; orders cannot be invoiced without them.',
        next: missing.length ? { label: 'Enter business and GST details (Tax settings - no admin screen yet; done through the tax API with tax:manage)' } : null,
        details: [
          { label: 'Legal entities', value: String(entities.length) },
          { label: 'Active GST registrations', value: String(activeGst.length) },
        ],
      });
    }

    // 2. Warehouse / pickup location
    const locations = await this.prisma.location.findMany({ where: { isActive: true } });
    const warehouses = locations.filter((l) => l.type === 'WAREHOUSE');
    {
      const complete = warehouses.filter((l) => l.addressLine1 && l.city && l.state && l.pinCode);
      const missing: string[] = [];
      if (warehouses.length === 0) missing.push('An active warehouse');
      else if (complete.length === 0) missing.push('A full warehouse address (couriers collect from it)');
      if (warehouses.length > 0 && !warehouses.some((l) => l.gstRegistrationId)) missing.push('The GST registration the warehouse ships under');
      areas.push({
        key: 'warehouse',
        title: 'Warehouse and pickup address',
        status: missing.length === 0 ? 'configured' : 'incomplete',
        kind: 'business',
        summary: warehouses.length ? warehouses.map((l) => l.name).join(', ') : 'No warehouse',
        missing,
        impact: 'Stock is held, picked and handed to couriers here; invoices take their place of supply from its GST registration.',
        next: missing.length ? { label: 'Complete the warehouse (Organization locations - no admin screen yet; done through the organization API with org:manage)' } : null,
        details: [{ label: 'Active locations', value: String(locations.length) }],
      });
    }

    // 3. Product reference data
    const [brands, categories, sizes, sizeCharts] = await Promise.all([
      this.prisma.brand.count({ where: { isActive: true } }),
      this.prisma.category.findMany({ where: { isActive: true }, select: { productType: true } }),
      this.prisma.size.count(),
      this.prisma.sizeChart.count({ where: { isActive: true } }),
    ]);
    {
      const missing: string[] = [];
      if (brands === 0) missing.push('A brand');
      if (categories.length === 0) missing.push('Categories');
      if (sizes === 0) missing.push('Sizes');
      const types = new Set(categories.map((c) => c.productType));
      areas.push({
        key: 'reference',
        title: 'Product reference data',
        status: missing.length === 0 ? 'configured' : 'incomplete',
        kind: 'business',
        summary: `${brands} brand${brands === 1 ? '' : 's'}, ${categories.length} categories, ${sizes} sizes`,
        missing,
        impact: 'Products need a brand, a category and sizes before they can be created or imported.',
        next: missing.length ? { label: 'Add products', href: '/dashboard/products/new' } : null,
        details: [
          { label: 'Product types in use', value: [...types].map((t) => t.toLowerCase()).join(', ') || 'None' },
          { label: 'Size charts (measurements)', value: String(sizeCharts) },
        ],
      });
    }

    // 4. Stock
    const [balances, receipts] = await Promise.all([
      this.prisma.inventoryBalance.aggregate({ _sum: { onHand: true }, _count: true }),
      this.prisma.goodsReceipt.count(),
    ]);
    {
      const onHand = balances._sum.onHand ?? 0;
      areas.push({
        key: 'stock',
        title: 'Stock',
        status: onHand > 0 ? 'configured' : 'incomplete',
        kind: 'business',
        summary: `${onHand} unit${onHand === 1 ? '' : 's'} on hand`,
        missing: onHand > 0 ? [] : ['No stock has been received'],
        impact: 'Shoppers can only buy sizes with stock. Stock comes from receiving goods against a purchase order, never from product import.',
        next: onHand > 0 ? { label: 'View stock', href: '/dashboard/inventory' } : { label: 'Receive goods', href: '/dashboard/receiving' },
        details: [
          { label: 'Goods receipts', value: String(receipts) },
          { label: 'Stock records', value: String(balances._count) },
        ],
      });
    }

    // 5. Media storage
    {
      const kind = env.PRODUCT_MEDIA_STORAGE;
      const refused = kind === 'local' && production;
      areas.push({
        key: 'media',
        title: 'Photo storage',
        status: refused ? 'unavailable' : kind === 's3' ? 'incomplete' : 'configured',
        kind: 'deployment',
        summary: kind === 's3' ? `S3 bucket ${env.PRODUCT_MEDIA_S3_BUCKET}` : 'This server\'s disk',
        missing: refused ? ['PRODUCT_MEDIA_STORAGE=s3 with a bucket (production does not keep photos on one server\'s disk)'] : [],
        impact: refused
          ? 'Photo uploads are refused until shared storage is set on the server.'
          : kind === 's3'
            ? 'Not tested yet in this view: run the storage test to confirm uploads will work.'
            : 'Fine for the local demo; photos stay on this machine.',
        next: { label: 'Run storage test' },
        details: [
          { label: 'Return evidence storage (private, separate)', value: env.RETURN_EVIDENCE_STORAGE === 's3' ? `S3 bucket ${env.RETURN_EVIDENCE_S3_BUCKET}` : 'This server\'s disk' },
          { label: 'Largest photo', value: `${Math.round(env.PRODUCT_MEDIA_MAX_FILE_SIZE_BYTES / 1048576)} MB` },
        ],
      });
    }

    // 6. Payments
    {
      const hasKeys = Boolean(env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET);
      const hasWebhook = Boolean(env.RAZORPAY_WEBHOOK_SECRET);
      const mode = env.RAZORPAY_KEY_ID?.startsWith('rzp_live_') ? 'live' : env.RAZORPAY_KEY_ID?.startsWith('rzp_test_') ? 'test' : env.RAZORPAY_KEY_ID ? 'unknown' : 'none';
      const missing: string[] = [];
      if (!hasKeys) missing.push('Razorpay key id and secret');
      if (!hasWebhook) missing.push('Razorpay webhook secret (payment confirmations)');
      areas.push({
        key: 'payments',
        title: 'Online payments (Razorpay)',
        status: 'incomplete',
        kind: 'deployment',
        summary: missing.length ? 'Not configured' : `Keys present (${mode} mode) - connection not verified`,
        missing: missing.length ? missing : ['A real test payment: no automated connection test exists, so keys being present is not proof they work'],
        impact: `Without working keys only Cash on Delivery is offered (up to ₹${env.COD_MAX_ORDER_VALUE_INR.toLocaleString('en-IN')} an order).`,
        next: { label: missing.length ? 'Set the Razorpay keys on the server (DEPLOYMENT.md)' : 'Place a test-mode order and confirm it is marked paid' },
        details: [
          { label: 'Key id present', value: yes(Boolean(env.RAZORPAY_KEY_ID)) },
          { label: 'Secret present', value: yes(Boolean(env.RAZORPAY_KEY_SECRET)) },
          { label: 'Webhook secret present', value: yes(hasWebhook) },
          { label: 'Mode', value: mode },
        ],
      });
    }

    // 7. Courier
    {
      const provider = env.SHIPPING_PROVIDER;
      const mock = provider.startsWith('MOCK');
      areas.push({
        key: 'courier',
        title: 'Courier',
        status: mock ? (production ? 'unavailable' : 'incomplete') : 'incomplete',
        kind: 'deployment',
        summary: mock ? 'Test courier only' : `${provider} - connection not verified`,
        missing: mock ? ['A real courier account. The courier choice is an open Product Owner decision (LR-008); no real courier is built yet'] : ['A verified booking with the courier'],
        impact: mock
          ? 'Shipments are simulated: no real pickup, label or tracking. Production refuses the test courier.'
          : 'Bookings go to the courier; no automated connection test exists.',
        next: { label: 'Decide the courier (LR-008)' },
        details: [{ label: 'Provider', value: provider }],
      });
    }

    // 8. Customer messages (OTP)
    areas.push({
      key: 'messages',
      title: 'Customer sign-in codes (SMS)',
      status: production ? 'unavailable' : 'incomplete',
      kind: 'deployment',
      summary: 'Codes are written to the server log (test mode)',
      missing: ['An SMS provider. The choice is an open Product Owner decision (LR-008)'],
      impact: 'Shoppers cannot receive sign-in codes on their phones; guest checkout still works.',
      next: { label: 'Decide the SMS provider (LR-008)' },
      details: [],
    });

    // 9. Shipping and returns policies
    {
      const returnPolicies = await this.prisma.returnPolicy.count();
      const missing: string[] = [];
      if (!env.SHIPPING_RATES_CONFIRMED) missing.push('Confirmed delivery charges (current values are engineering defaults)');
      areas.push({
        key: 'policies',
        title: 'Shipping and returns policies',
        status: missing.length ? 'incomplete' : 'configured',
        kind: 'both',
        summary: `Delivery ₹${env.SHIPPING_DEFAULT_FLAT_AMOUNT}, free above ₹${env.SHIPPING_DEFAULT_FREE_ABOVE_THRESHOLD}; returns ${env.RETURN_WINDOW_DEFAULT_DAYS} days`,
        missing,
        impact: env.SHIPPING_RATES_CONFIRMED ? 'The storefront states these delivery charges.' : 'Until confirmed, the storefront avoids promising specific delivery charges.',
        next: missing.length ? { label: 'Confirm delivery charges and set SHIPPING_RATES_CONFIRMED on the server' } : null,
        details: [
          { label: 'Rates confirmed', value: yes(env.SHIPPING_RATES_CONFIRMED) },
          { label: 'Default return window', value: `${env.RETURN_WINDOW_DEFAULT_DAYS} days (server setting)` },
          { label: 'Category/product return rules', value: String(returnPolicies) },
        ],
      });
    }

    // 10. Storefront content
    {
      const legal = await this.prisma.cmsLandingPage.findMany({ where: { slug: { in: ['legal-privacy', 'legal-terms'] } } });
      const publishedLegal = legal.filter((p) => p.isPublished).map((p) => p.slug);
      const menus = await this.prisma.cmsNavigationMenu.findMany({ where: { key: { in: MENU_PLACEMENTS.map((m) => m.key) } } });
      const filledMenus = menus.filter((m) => Array.isArray(m.items) && (m.items as unknown[]).length > 0).length;
      const banners = await this.prisma.cmsBanner.groupBy({ by: ['placement'], where: { isActive: true, placement: { in: BANNER_PLACEMENTS.map((b) => b.key) } } });
      const missing: string[] = [];
      if (!publishedLegal.includes('legal-privacy')) missing.push('Approved privacy policy');
      if (!publishedLegal.includes('legal-terms')) missing.push('Approved terms of use');
      if (!env.STOREFRONT_PUBLIC_URL) missing.push('The storefront\'s public address (STOREFRONT_PUBLIC_URL, on the server)');
      areas.push({
        key: 'content',
        title: 'Storefront content',
        status: missing.length ? 'incomplete' : 'configured',
        kind: 'both',
        summary: `${banners.length} of ${BANNER_PLACEMENTS.length} photo placements filled; ${filledMenus} of ${MENU_PLACEMENTS.length} footer menus set`,
        missing,
        impact: 'Legal pages show a "pending" notice until approved text is published; empty photo placements show their section without a photo.',
        next: { label: 'Edit storefront content', href: '/dashboard/cms/navigation-menus' },
        details: [
          { label: 'Published legal pages', value: publishedLegal.join(', ') || 'None' },
          { label: 'Public address set', value: yes(Boolean(env.STOREFRONT_PUBLIC_URL)) },
        ],
      });
    }

    // 11. Publishing channels
    {
      const channels = await this.prisma.channel.findMany({ orderBy: { name: 'asc' } });
      const credentials: Record<string, boolean> = {
        GOOGLE_MERCHANT: Boolean(env.GOOGLE_MERCHANT_ACCOUNT_ID && env.GOOGLE_SERVICE_ACCOUNT_EMAIL && env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY),
        META_CATALOG: Boolean(env.META_CATALOG_ID && env.META_CATALOG_ACCESS_TOKEN),
      };
      const details: Array<{ label: string; value: string }> = [];
      const missing: string[] = [];
      let anyFailed = false;
      for (const channel of channels) {
        const last = await this.prisma.channelPublicationAttempt.findFirst({ where: { channelListing: { channelId: channel.id } }, orderBy: { attemptedAt: 'desc' } });
        const scope = (channel.config as { publishAll?: unknown } | null)?.publishAll === true ? 'all products that can be bought' : 'products sent by hand';
        const isMock = channel.providerName.startsWith('MOCK');
        const creds = isMock ? 'test provider' : credentials[channel.providerName] ? 'credentials present (not verified)' : 'credentials missing';
        if (!isMock && !credentials[channel.providerName]) missing.push(`${channel.name}: account credentials on the server`);
        if (isMock && production) missing.push(`${channel.name} uses a test provider, which production refuses`);
        if (last?.status === 'FAILURE') anyFailed = true;
        details.push({
          label: channel.name,
          value: `${channel.isActive ? 'active' : 'paused'}; sends ${scope}; ${creds}; last attempt: ${last ? `${last.status.toLowerCase()} ${last.attemptedAt.toISOString().slice(0, 10)}` : 'none'}`,
        });
      }
      areas.push({
        key: 'channels',
        title: 'Publishing channels',
        status: channels.length === 0 ? 'incomplete' : anyFailed ? 'test_failed' : missing.length ? 'incomplete' : 'configured',
        kind: 'both',
        summary: channels.length ? `${channels.length} channel${channels.length === 1 ? '' : 's'}` : 'No channels',
        missing: channels.length ? missing : ['No sales channel (Google, Meta) is set up'],
        impact: anyFailed ? 'The last attempt to send a product failed; see the channel for the reason.' : 'Products are only listed on channels that are active, set up and allowed to send them.',
        next: { label: 'Open channels', href: '/dashboard/channels' },
        details,
      });
    }

    return { areas, environment: { stage: env.NODE_ENV === 'production' ? env.DEPLOYMENT_STAGE : 'development', mocksAllowed: !production } };
  }

  /** Real write/read/delete against the configured photo store. */
  async testMediaStorage(): Promise<{ ok: boolean; kind?: string; message: string }> {
    try {
      const { kind } = await new ProductMediaService(this.fastify).probeStore();
      return { ok: true, kind, message: 'Saved, read back and removed a test file.' };
    } catch (err) {
      this.fastify.log.warn({ err }, 'media storage test failed');
      return { ok: false, message: `The storage test failed: ${(err as Error).message.slice(0, 200)}` };
    }
  }
}
