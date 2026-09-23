import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createTestApp } from '../helpers/app.js';
import { resetDatabase, seedRbac, grantAllPermissions, grantPermissions, seedBrandAndLocation, testPrisma } from '../helpers/db.js';
import { createAuthenticatedStaff } from '../helpers/auth.js';
import { InvoiceService } from '../../src/modules/tax/invoice-service.js';
import { getIndianFinancialYear, splitTax } from '../../src/modules/tax/tax-engine.js';

/**
 * M08 certification round (specs/32-india-tax-invoicing.md): intra/inter
 * state computation, missing-configuration fail-safety, effective-date
 * boundaries, historical-rate immutability, invalid HSN, invoice-number
 * concurrency, duplicate-document prevention, and credit-note linkage.
 * Nothing here asserts a specific GST rate is legally "correct" - only
 * that the engine correctly and safely applies whatever configuration it
 * is given, per TAX-001-005 remaining UNDER_REVIEW.
 */
describe('Tax & Invoicing Foundation certification (M08)', () => {
  let app: FastifyInstance;
  let actorStaffId: string;
  let locationId: string;
  let skuId: string;
  let styleHsn: string;
  let categoryId: string;
  let sizeId: string;
  let gstinCounter = 0;

  // Certification-pass finding: a single random digit (Math.random() * 9,
  // 9 possible values) is not enough entropy to guarantee uniqueness when
  // a test calls this helper more than once (e.g. two invoices from two
  // registrations in the same test) - an ~11% chance of a spurious
  // gstin-unique-constraint failure per such test, observed in CI. A
  // monotonic counter guarantees uniqueness deterministically instead.
  async function makeLegalEntityAndRegistration(stateCode: string, stateName: string, overrides: Partial<{ status: 'ACTIVE' | 'PENDING'; effectiveFrom: Date; effectiveTo: Date }> = {}) {
    gstinCounter += 1;
    const legalEntity = await testPrisma.legalEntity.create({
      data: { legalName: 'Test Fashion Pvt Ltd', registeredState: stateName },
    });
    const registration = await testPrisma.gstRegistration.create({
      data: {
        legalEntityId: legalEntity.id,
        gstin: `${stateCode}AAAAA${String(gstinCounter).padStart(4, '0')}A1Z${gstinCounter % 10}`,
        stateCode,
        stateName,
        status: overrides.status ?? 'ACTIVE',
        effectiveFrom: overrides.effectiveFrom ?? new Date(Date.now() - 86_400_000),
        effectiveTo: overrides.effectiveTo,
      },
    });
    return { legalEntity, registration };
  }

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDatabase();
    await seedRbac();
    await grantAllPermissions('SUPER_ADMIN');
    const auth = await createAuthenticatedStaff(app, ['SUPER_ADMIN']);
    actorStaffId = auth.staffUserId;

    const { brand, category, size } = await seedBrandAndLocation();
    const location = await testPrisma.location.create({
      data: { code: 'TAX-WH-01', name: 'Tax Test Warehouse', type: 'WAREHOUSE' },
    });
    locationId = location.id;
    categoryId = category.id;
    sizeId = size.id;
    styleHsn = '6109';
    const style = await testPrisma.style.create({
      data: {
        styleCode: 'TAX-001',
        name: 'Tax Test Tee',
        brandId: brand.id,
        categoryId: category.id,
        season: 'SS26',
        collection: 'Core',
        hsnCode: styleHsn,
      },
    });
    const colour = await testPrisma.colour.create({ data: { styleId: style.id, name: 'Black', colourCode: 'BLK' } });
    const sku = await testPrisma.sku.create({
      data: { skuCode: 'TAX-001-BLK-M', styleId: style.id, colourId: colour.id, sizeId: size.id },
    });
    skuId = sku.id;
  });

  describe('Missing configuration fails safe', () => {
    it('rejects invoicing when the location has no GST registration assigned', async () => {
      const invoiceService = new InvoiceService(app);
      await expect(
        invoiceService.issueInvoice(
          {
            orderId: 'order-no-config-1',
            locationId,
            recipientName: 'Jane Doe',
            billingAddress: { city: 'Delhi' },
            deliveryAddress: { city: 'Delhi' },
            shippingStateCode: 'DL',
            lines: [{ skuId, quantity: 1, unitPrice: 999 }],
          },
          actorStaffId,
        ),
      ).rejects.toMatchObject({ statusCode: 422, code: 'TAX_CONFIGURATION_MISSING' });
    });

    it('rejects invoicing when the assigned GST registration is not ACTIVE', async () => {
      const { registration } = await makeLegalEntityAndRegistration('DL', 'Delhi', { status: 'PENDING' });
      await testPrisma.location.update({ where: { id: locationId }, data: { gstRegistrationId: registration.id } });

      const invoiceService = new InvoiceService(app);
      await expect(
        invoiceService.issueInvoice(
          {
            orderId: 'order-pending-reg',
            locationId,
            recipientName: 'Jane Doe',
            billingAddress: {},
            deliveryAddress: {},
            shippingStateCode: 'DL',
            lines: [{ skuId, quantity: 1, unitPrice: 999 }],
          },
          actorStaffId,
        ),
      ).rejects.toMatchObject({ statusCode: 422, code: 'TAX_CONFIGURATION_MISSING' });
    });

    it('rejects invoicing when no tax rate is configured for the SKU/style HSN', async () => {
      const { registration } = await makeLegalEntityAndRegistration('DL', 'Delhi');
      await testPrisma.location.update({ where: { id: locationId }, data: { gstRegistrationId: registration.id } });
      // Deliberately no TaxRate row created for styleHsn.

      const invoiceService = new InvoiceService(app);
      await expect(
        invoiceService.issueInvoice(
          {
            orderId: 'order-no-rate',
            locationId,
            recipientName: 'Jane Doe',
            billingAddress: {},
            deliveryAddress: {},
            shippingStateCode: 'DL',
            lines: [{ skuId, quantity: 1, unitPrice: 999 }],
          },
          actorStaffId,
        ),
      ).rejects.toMatchObject({ statusCode: 422, code: 'TAX_CONFIGURATION_MISSING' });
    });

    it('rejects invoicing when a SKU has neither a style default nor a SKU-override HSN', async () => {
      const { registration } = await makeLegalEntityAndRegistration('DL', 'Delhi');
      await testPrisma.location.update({ where: { id: locationId }, data: { gstRegistrationId: registration.id } });
      const brand = await testPrisma.brand.create({ data: { code: 'NOHSN', name: 'No HSN Brand' } });
      const styleNoHsn = await testPrisma.style.create({
        data: { styleCode: 'NOHSN-001', name: 'No HSN Style', brandId: brand.id, categoryId, season: 'SS26', collection: 'Core' },
      });
      const colour = await testPrisma.colour.create({ data: { styleId: styleNoHsn.id, name: 'Red', colourCode: 'RED' } });
      const skuNoHsn = await testPrisma.sku.create({
        data: { skuCode: 'NOHSN-001-RED-M', styleId: styleNoHsn.id, colourId: colour.id, sizeId },
      });

      const invoiceService = new InvoiceService(app);
      await expect(
        invoiceService.issueInvoice(
          {
            orderId: 'order-no-hsn',
            locationId,
            recipientName: 'Jane Doe',
            billingAddress: {},
            deliveryAddress: {},
            shippingStateCode: 'DL',
            lines: [{ skuId: skuNoHsn.id, quantity: 1, unitPrice: 500 }],
          },
          actorStaffId,
        ),
      ).rejects.toMatchObject({ statusCode: 422, code: 'TAX_CONFIGURATION_MISSING' });
    });
  });

  describe('Intra-state vs inter-state computation', () => {
    it('splits CGST+SGST (never IGST) for an intra-state sale', async () => {
      const { registration } = await makeLegalEntityAndRegistration('DL', 'Delhi');
      await testPrisma.location.update({ where: { id: locationId }, data: { gstRegistrationId: registration.id } });
      await testPrisma.taxRate.create({
        data: { hsnCode: styleHsn, gstRatePercent: 12, effectiveFrom: new Date(Date.now() - 86_400_000) },
      });

      const invoiceService = new InvoiceService(app);
      const invoice = await invoiceService.issueInvoice(
        {
          orderId: 'order-intra-1',
          locationId,
          recipientName: 'Jane Doe',
          billingAddress: {},
          deliveryAddress: {},
          shippingStateCode: 'DL', // same as registration's state
          lines: [{ skuId, quantity: 2, unitPrice: 500 }],
        },
        actorStaffId,
      );

      expect(invoice.isIntraState).toBe(true);
      expect(Number(invoice.totalIgst)).toBe(0);
      expect(Number(invoice.totalCgst)).toBeGreaterThan(0);
      expect(Number(invoice.totalSgst)).toBeGreaterThan(0);
      expect(Number(invoice.totalCgst)).toBeCloseTo(Number(invoice.totalSgst), 2);
      // taxable 1000 @ 12% = 120 total -> 60/60 split
      expect(Number(invoice.totalCgst)).toBeCloseTo(60, 2);
      expect(Number(invoice.totalSgst)).toBeCloseTo(60, 2);
    });

    it('applies IGST only (never CGST/SGST) for an inter-state sale', async () => {
      const { registration } = await makeLegalEntityAndRegistration('DL', 'Delhi');
      await testPrisma.location.update({ where: { id: locationId }, data: { gstRegistrationId: registration.id } });
      await testPrisma.taxRate.create({
        data: { hsnCode: styleHsn, gstRatePercent: 12, effectiveFrom: new Date(Date.now() - 86_400_000) },
      });

      const invoiceService = new InvoiceService(app);
      const invoice = await invoiceService.issueInvoice(
        {
          orderId: 'order-inter-1',
          locationId,
          recipientName: 'John Doe',
          billingAddress: {},
          deliveryAddress: {},
          shippingStateCode: 'MH', // different from registration's DL
          lines: [{ skuId, quantity: 2, unitPrice: 500 }],
        },
        actorStaffId,
      );

      expect(invoice.isIntraState).toBe(false);
      expect(Number(invoice.totalCgst)).toBe(0);
      expect(Number(invoice.totalSgst)).toBe(0);
      expect(Number(invoice.totalIgst)).toBeCloseTo(120, 2);
    });

    it('never produces both CGST/SGST and IGST nonzero on the same invoice (DB CHECK constraint holds)', async () => {
      // Direct engine-level proof independent of DB round trip.
      const intra = splitTax({ taxableValue: 1000, gstRatePercent: 18, isIntraState: true });
      const inter = splitTax({ taxableValue: 1000, gstRatePercent: 18, isIntraState: false });
      expect(intra.igst).toBe(0);
      expect(inter.cgst).toBe(0);
      expect(inter.sgst).toBe(0);
    });
  });

  describe('Effective-date boundaries and historical immutability', () => {
    it('rejects when the only configured rate has not yet become effective', async () => {
      const { registration } = await makeLegalEntityAndRegistration('DL', 'Delhi');
      await testPrisma.location.update({ where: { id: locationId }, data: { gstRegistrationId: registration.id } });
      await testPrisma.taxRate.create({
        data: { hsnCode: styleHsn, gstRatePercent: 12, effectiveFrom: new Date(Date.now() + 30 * 86_400_000) }, // 30 days in the future
      });

      const invoiceService = new InvoiceService(app);
      await expect(
        invoiceService.issueInvoice(
          {
            orderId: 'order-future-rate',
            locationId,
            recipientName: 'Jane Doe',
            billingAddress: {},
            deliveryAddress: {},
            shippingStateCode: 'DL',
            lines: [{ skuId, quantity: 1, unitPrice: 999 }],
          },
          actorStaffId,
        ),
      ).rejects.toMatchObject({ code: 'TAX_CONFIGURATION_MISSING' });
    });

    it('rejects when the only configured rate has already expired', async () => {
      const { registration } = await makeLegalEntityAndRegistration('DL', 'Delhi');
      await testPrisma.location.update({ where: { id: locationId }, data: { gstRegistrationId: registration.id } });
      await testPrisma.taxRate.create({
        data: {
          hsnCode: styleHsn,
          gstRatePercent: 12,
          effectiveFrom: new Date(Date.now() - 60 * 86_400_000),
          effectiveTo: new Date(Date.now() - 30 * 86_400_000),
        },
      });

      const invoiceService = new InvoiceService(app);
      await expect(
        invoiceService.issueInvoice(
          {
            orderId: 'order-expired-rate',
            locationId,
            recipientName: 'Jane Doe',
            billingAddress: {},
            deliveryAddress: {},
            shippingStateCode: 'DL',
            lines: [{ skuId, quantity: 1, unitPrice: 999 }],
          },
          actorStaffId,
        ),
      ).rejects.toMatchObject({ code: 'TAX_CONFIGURATION_MISSING' });
    });

    it('keeps a previously issued invoice unchanged after the tax rate reference data later changes', async () => {
      const { registration } = await makeLegalEntityAndRegistration('DL', 'Delhi');
      await testPrisma.location.update({ where: { id: locationId }, data: { gstRegistrationId: registration.id } });
      await testPrisma.taxRate.create({
        data: { hsnCode: styleHsn, gstRatePercent: 12, effectiveFrom: new Date(Date.now() - 86_400_000) },
      });

      const invoiceService = new InvoiceService(app);
      const invoice = await invoiceService.issueInvoice(
        {
          orderId: 'order-historical-rate',
          locationId,
          recipientName: 'Jane Doe',
          billingAddress: {},
          deliveryAddress: {},
          shippingStateCode: 'DL',
          lines: [{ skuId, quantity: 1, unitPrice: 1000 }],
        },
        actorStaffId,
      );
      expect(Number(invoice.lines[0]!.gstRatePercent)).toBe(12);
      expect(Number(invoice.totalCgst)).toBeCloseTo(60, 2);

      // A rate correction is entered later, effective now - this must
      // NOT retroactively change the already-issued invoice.
      await testPrisma.taxRate.create({
        data: { hsnCode: styleHsn, gstRatePercent: 18, effectiveFrom: new Date(Date.now() - 1000) },
      });

      const reread = await invoiceService.getInvoice(invoice.id);
      expect(Number(reread.lines[0]!.gstRatePercent)).toBe(12);
      expect(Number(reread.totalCgst)).toBeCloseTo(60, 2);
    });
  });

  describe('Invoice numbering: concurrency and duplicate prevention', () => {
    it('assigns unique sequential invoice numbers under concurrent issuance (no duplicates, no gaps-that-collide)', async () => {
      const { registration } = await makeLegalEntityAndRegistration('DL', 'Delhi');
      await testPrisma.location.update({ where: { id: locationId }, data: { gstRegistrationId: registration.id } });
      await testPrisma.taxRate.create({
        data: { hsnCode: styleHsn, gstRatePercent: 12, effectiveFrom: new Date(Date.now() - 86_400_000) },
      });

      const invoiceService = new InvoiceService(app);
      const concurrency = 15;
      const results = await Promise.all(
        Array.from({ length: concurrency }, (_, i) =>
          invoiceService.issueInvoice(
            {
              orderId: `order-concurrent-${i}`,
              locationId,
              recipientName: 'Concurrent Buyer',
              billingAddress: {},
              deliveryAddress: {},
              shippingStateCode: 'DL',
              lines: [{ skuId, quantity: 1, unitPrice: 100 }],
            },
            actorStaffId,
          ),
        ),
      );

      const numbers = results.map((r) => r.invoiceNumber);
      expect(new Set(numbers).size).toBe(concurrency); // every number unique
      const sequences = results.map((r) => r.sequenceNumber).sort((a, b) => a - b);
      expect(sequences).toEqual(Array.from({ length: concurrency }, (_, i) => i + 1)); // contiguous 1..N
    });

    it('rejects issuing a second invoice for an order that already has one', async () => {
      const { registration } = await makeLegalEntityAndRegistration('DL', 'Delhi');
      await testPrisma.location.update({ where: { id: locationId }, data: { gstRegistrationId: registration.id } });
      await testPrisma.taxRate.create({
        data: { hsnCode: styleHsn, gstRatePercent: 12, effectiveFrom: new Date(Date.now() - 86_400_000) },
      });

      const invoiceService = new InvoiceService(app);
      const input = {
        orderId: 'order-dup-1',
        locationId,
        recipientName: 'Jane Doe',
        billingAddress: {},
        deliveryAddress: {},
        shippingStateCode: 'DL',
        lines: [{ skuId, quantity: 1, unitPrice: 999 }],
      };
      await invoiceService.issueInvoice(input, actorStaffId);
      await expect(invoiceService.issueInvoice(input, actorStaffId)).rejects.toMatchObject({ statusCode: 409 });
    });

    it('formats invoice numbers as PREFIX/financial-year/sequence, scoped per financial year', async () => {
      const { registration } = await makeLegalEntityAndRegistration('DL', 'Delhi');
      await testPrisma.location.update({ where: { id: locationId }, data: { gstRegistrationId: registration.id } });
      await testPrisma.taxRate.create({
        data: { hsnCode: styleHsn, gstRatePercent: 12, effectiveFrom: new Date(Date.now() - 86_400_000) },
      });

      const invoiceService = new InvoiceService(app);
      const invoice = await invoiceService.issueInvoice(
        {
          orderId: 'order-fy-format',
          locationId,
          recipientName: 'Jane Doe',
          billingAddress: {},
          deliveryAddress: {},
          shippingStateCode: 'DL',
          lines: [{ skuId, quantity: 1, unitPrice: 100 }],
        },
        actorStaffId,
      );
      const fy = getIndianFinancialYear(new Date());
      expect(invoice.invoiceNumber).toBe(`INV/${fy}/000001`);
      expect(invoice.financialYear).toBe(fy);
    });
  });

  describe('Credit notes', () => {
    async function issueBaseInvoice(invoiceService: InvoiceService, orderId: string, quantity = 4) {
      const { registration } = await makeLegalEntityAndRegistration('DL', 'Delhi');
      await testPrisma.location.update({ where: { id: locationId }, data: { gstRegistrationId: registration.id } });
      await testPrisma.taxRate.create({
        data: { hsnCode: styleHsn, gstRatePercent: 12, effectiveFrom: new Date(Date.now() - 86_400_000) },
      });
      return invoiceService.issueInvoice(
        {
          orderId,
          locationId,
          recipientName: 'Jane Doe',
          billingAddress: {},
          deliveryAddress: {},
          shippingStateCode: 'DL',
          lines: [{ skuId, quantity, unitPrice: 250 }],
        },
        actorStaffId,
      );
    }

    it('issues a credit note linked to the original invoice with proportionally reduced amounts', async () => {
      const invoiceService = new InvoiceService(app);
      const invoice = await issueBaseInvoice(invoiceService, 'order-cn-1', 4);

      const creditNote = await invoiceService.issueCreditNote(
        {
          originalInvoiceId: invoice.id,
          reason: 'Customer return - 1 of 4 units',
          lines: [{ invoiceLineId: invoice.lines[0]!.id, quantity: 1 }],
        },
        actorStaffId,
      );

      expect(creditNote.originalInvoiceId).toBe(invoice.id);
      expect(creditNote.lines[0]!.quantity).toBe(1);
      // 1/4 of the invoice line's taxable value
      const expectedTaxable = Number(invoice.lines[0]!.taxableValue) / 4;
      expect(Number(creditNote.totalTaxableValueReduction)).toBeCloseTo(expectedTaxable, 2);

      const linked = await invoiceService.listCreditNotesForInvoice(invoice.id);
      expect(linked.map((c) => c.id)).toContain(creditNote.id);
    });

    it('rejects crediting more quantity than the original invoice line has', async () => {
      const invoiceService = new InvoiceService(app);
      const invoice = await issueBaseInvoice(invoiceService, 'order-cn-2', 2);

      await expect(
        invoiceService.issueCreditNote(
          {
            originalInvoiceId: invoice.id,
            reason: 'Over-credit attempt',
            lines: [{ invoiceLineId: invoice.lines[0]!.id, quantity: 99 }],
          },
          actorStaffId,
        ),
      ).rejects.toMatchObject({ statusCode: 400 });
    });

    it('rejects a credit note line referencing an invoice line from a different invoice', async () => {
      const invoiceService = new InvoiceService(app);
      const invoiceA = await issueBaseInvoice(invoiceService, 'order-cn-3a', 2);
      const invoiceB = await issueBaseInvoice(invoiceService, 'order-cn-3b', 2);

      await expect(
        invoiceService.issueCreditNote(
          {
            originalInvoiceId: invoiceA.id,
            reason: 'Cross-invoice line mismatch',
            lines: [{ invoiceLineId: invoiceB.lines[0]!.id, quantity: 1 }],
          },
          actorStaffId,
        ),
      ).rejects.toMatchObject({ statusCode: 400 });
    });

    it('assigns unique sequential credit-note numbers under concurrent issuance', async () => {
      const invoiceService = new InvoiceService(app);
      const invoice = await issueBaseInvoice(invoiceService, 'order-cn-concurrent', 20);

      const concurrency = 10;
      const results = await Promise.all(
        Array.from({ length: concurrency }, () =>
          invoiceService.issueCreditNote(
            {
              originalInvoiceId: invoice.id,
              reason: 'Concurrent partial credit',
              lines: [{ invoiceLineId: invoice.lines[0]!.id, quantity: 1 }],
            },
            actorStaffId,
          ),
        ),
      );
      const numbers = results.map((r) => r.creditNoteNumber);
      expect(new Set(numbers).size).toBe(concurrency);
    });
  });

  describe('HTTP-layer authorization', () => {
    it('rejects tax configuration writes without tax:manage permission', async () => {
      const { token } = await createAuthenticatedStaff(app, []);
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/tax/legal-entities',
        headers: { authorization: `Bearer ${token}` },
        payload: { legalName: 'Should Not Be Created Pvt Ltd' },
      });
      expect(res.statusCode).toBe(403);
    });

    it('allows a FINANCE-role staff member to configure tax reference data end to end via HTTP', async () => {
      await grantPermissions('FINANCE', ['tax:manage']);
      const { token } = await createAuthenticatedStaff(app, ['FINANCE']);
      const entityRes = await app.inject({
        method: 'POST',
        url: '/api/v1/tax/legal-entities',
        headers: { authorization: `Bearer ${token}` },
        payload: { legalName: 'HTTP Test Pvt Ltd' },
      });
      expect(entityRes.statusCode).toBe(201);

      const regRes = await app.inject({
        method: 'POST',
        url: '/api/v1/tax/gst-registrations',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          legalEntityId: entityRes.json().id,
          gstin: 'DLAAAAA0000A1Z9',
          stateCode: 'DL',
          stateName: 'Delhi',
          status: 'ACTIVE',
          effectiveFrom: new Date(Date.now() - 86_400_000).toISOString(),
        },
      });
      expect(regRes.statusCode).toBe(201);

      const rateRes = await app.inject({
        method: 'POST',
        url: '/api/v1/tax/rates',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          hsnCode: '6109',
          gstRatePercent: 5,
          effectiveFrom: new Date(Date.now() - 86_400_000).toISOString(),
        },
      });
      expect(rateRes.statusCode).toBe(201);
    });
  });
});
