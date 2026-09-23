import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { TaxConfigService } from './service.js';
import { InvoiceService } from './invoice-service.js';

const legalEntitySchema = z.object({
  legalName: z.string().min(1),
  pan: z.string().optional(),
  cin: z.string().optional(),
  registeredAddressLine1: z.string().optional(),
  registeredAddressLine2: z.string().optional(),
  registeredCity: z.string().optional(),
  registeredState: z.string().optional(),
  registeredPinCode: z.string().optional(),
});

const gstRegistrationSchema = z.object({
  legalEntityId: z.string().uuid(),
  gstin: z.string().min(1),
  stateCode: z.string().min(1),
  stateName: z.string().min(1),
  status: z.enum(['PENDING', 'ACTIVE', 'SUSPENDED', 'CANCELLED']).optional(),
  effectiveFrom: z.coerce.date(),
  effectiveTo: z.coerce.date().optional(),
});

const taxRateSchema = z.object({
  hsnCode: z.string().min(1),
  description: z.string().optional(),
  gstRatePercent: z.number().nonnegative(),
  cessPercent: z.number().nonnegative().optional(),
  effectiveFrom: z.coerce.date(),
  effectiveTo: z.coerce.date().optional(),
  sourceReference: z.string().optional(),
  verificationStatus: z.enum(['UNVERIFIED', 'PENDING_REVIEW', 'VERIFIED']).optional(),
});

const complianceProfileSchema = z.object({
  legalEntityId: z.string().uuid(),
  aatoThresholdCrores: z.number().nonnegative().optional(),
  einvoiceApplicable: z.boolean().optional(),
  einvoiceApplicableFrom: z.coerce.date().optional(),
  exemptionNotes: z.string().optional(),
  effectiveFrom: z.coerce.date().optional(),
  effectiveTo: z.coerce.date().optional(),
});

const invoiceLineSchema = z.object({
  skuId: z.string().uuid(),
  quantity: z.number().int().positive(),
  unitPrice: z.number().nonnegative(),
  discountAmount: z.number().nonnegative().optional(),
  discountAppliedPreTax: z.boolean().optional(),
});

const issueInvoiceSchema = z.object({
  orderId: z.string().min(1),
  locationId: z.string().uuid(),
  recipientName: z.string().min(1),
  recipientGstin: z.string().optional(),
  billingAddress: z.record(z.unknown()),
  deliveryAddress: z.record(z.unknown()),
  shippingStateCode: z.string().min(1),
  reverseCharge: z.boolean().optional(),
  lines: z.array(invoiceLineSchema).min(1),
  atDate: z.coerce.date().optional(),
});

const issueCreditNoteSchema = z.object({
  originalInvoiceId: z.string().uuid(),
  reason: z.string().min(1),
  referenceNote: z.string().optional(),
  lines: z
    .array(z.object({ invoiceLineId: z.string().uuid(), quantity: z.number().int().positive() }))
    .min(1),
});

const taxRoutes: FastifyPluginAsync = async (fastify) => {
  const configService = new TaxConfigService(fastify);
  const invoiceService = new InvoiceService(fastify);

  const manageAuth = [fastify.requireStaffAuth, fastify.requirePermission('tax:manage')];
  const readAuth = [fastify.requireStaffAuth, fastify.requirePermission('tax:read')];
  const invoiceReadAuth = [fastify.requireStaffAuth, fastify.requirePermission('invoice:read')];
  const invoiceCreateAuth = [fastify.requireStaffAuth, fastify.requirePermission('invoice:create')];

  // --- Legal entities ---
  fastify.post('/tax/legal-entities', { preHandler: manageAuth }, async (request, reply) => {
    const body = legalEntitySchema.parse(request.body);
    reply.status(201).send(await configService.createLegalEntity(body, request.staffUser!.id));
  });
  fastify.get('/tax/legal-entities', { preHandler: readAuth }, async (_request, reply) => {
    reply.status(200).send(await configService.listLegalEntities());
  });

  // --- GST registrations ---
  fastify.post('/tax/gst-registrations', { preHandler: manageAuth }, async (request, reply) => {
    const body = gstRegistrationSchema.parse(request.body);
    reply.status(201).send(await configService.createGstRegistration(body, request.staffUser!.id));
  });
  fastify.get('/tax/gst-registrations', { preHandler: readAuth }, async (_request, reply) => {
    reply.status(200).send(await configService.listGstRegistrations());
  });
  fastify.post(
    '/tax/locations/:locationId/gst-registration',
    { preHandler: manageAuth },
    async (request, reply) => {
      const { locationId } = z.object({ locationId: z.string().uuid() }).parse(request.params);
      const { gstRegistrationId } = z.object({ gstRegistrationId: z.string().uuid() }).parse(request.body);
      reply
        .status(200)
        .send(
          await configService.assignLocationGstRegistration(
            locationId,
            gstRegistrationId,
            request.staffUser!.id,
          ),
        );
    },
  );

  // --- Tax rates (HSN reference data) ---
  fastify.post('/tax/rates', { preHandler: manageAuth }, async (request, reply) => {
    const body = taxRateSchema.parse(request.body);
    reply.status(201).send(await configService.createTaxRate(body, request.staffUser!.id));
  });
  fastify.get('/tax/rates', { preHandler: readAuth }, async (request, reply) => {
    const { hsnCode } = z.object({ hsnCode: z.string().optional() }).parse(request.query);
    reply.status(200).send(await configService.listTaxRates(hsnCode));
  });

  // --- Compliance profile ---
  fastify.post('/tax/compliance-profiles', { preHandler: manageAuth }, async (request, reply) => {
    const body = complianceProfileSchema.parse(request.body);
    reply.status(201).send(await configService.setComplianceProfile(body, request.staffUser!.id));
  });

  // --- Invoices ---
  // M08-standalone entry point (see invoice-service.ts docblock): M15
  // will call InvoiceService.issueInvoice() directly at order
  // confirmation for the real customer flow.
  fastify.post('/tax/invoices', { preHandler: invoiceCreateAuth }, async (request, reply) => {
    const body = issueInvoiceSchema.parse(request.body);
    reply.status(201).send(await invoiceService.issueInvoice(body, request.staffUser!.id));
  });
  fastify.get('/tax/invoices/:id', { preHandler: invoiceReadAuth }, async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    reply.status(200).send(await invoiceService.getInvoice(id));
  });
  fastify.get('/tax/invoices/by-order/:orderId', { preHandler: invoiceReadAuth }, async (request, reply) => {
    const { orderId } = z.object({ orderId: z.string().min(1) }).parse(request.params);
    reply.status(200).send(await invoiceService.getInvoiceByOrder(orderId));
  });

  // --- Credit notes ---
  fastify.post('/tax/credit-notes', { preHandler: invoiceCreateAuth }, async (request, reply) => {
    const body = issueCreditNoteSchema.parse(request.body);
    reply.status(201).send(await invoiceService.issueCreditNote(body, request.staffUser!.id));
  });
  fastify.get('/tax/credit-notes/:id', { preHandler: invoiceReadAuth }, async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    reply.status(200).send(await invoiceService.getCreditNote(id));
  });
  fastify.get(
    '/tax/invoices/:id/credit-notes',
    { preHandler: invoiceReadAuth },
    async (request, reply) => {
      const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
      reply.status(200).send(await invoiceService.listCreditNotesForInvoice(id));
    },
  );
};

export default taxRoutes;
