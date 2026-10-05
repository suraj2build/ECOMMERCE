import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createTestApp } from '../helpers/app.js';
import { resetDatabase, seedRbac, grantPermissions, seedBrandAndLocation, testPrisma } from '../helpers/db.js';
import { createAuthenticatedStaff } from '../helpers/auth.js';

const PASSWORD = 'TestPassword123!'; // createAuthenticatedStaff's password
const GUEST_HEADER = 'x-guest-session-id';
const PINCODE = '110001';

/**
 * AO-D4 (Product Owner, 2026-10-05): one approval policy for purchase
 * orders, large stock adjustments, receiving QC sign-off and large pick
 * shortfalls. Independent approval by default; owner self-approval only
 * when switched on, for named owners, with a reason and a password
 * re-confirmation; every approval recorded. docs/admin/APPROVALS.md.
 */
describe('Approval policy (AO-D4)', () => {
  let app: FastifyInstance;
  let counter = 0;
  const auth = (token: string) => ({ authorization: `Bearer ${token}` });
  const OWNER_PERMS = [
    'org:manage', 'po:create', 'po:submit', 'po:approve', 'po:read', 'supplier:write', 'grn:create', 'grn:read',
    'grn:qc:manager_signoff', 'inventory:read', 'inventory:adjust', 'inventory:adjust:coapprove',
    'order:read', 'order:fulfil', 'warehouse:read', 'warehouse:pick',
  ];

  let owner: { staffUserId: string; token: string };
  let partner: { staffUserId: string; token: string };
  let clerk: { staffUserId: string; token: string };
  let fixtures: Awaited<ReturnType<typeof seedBrandAndLocation>>;

  beforeAll(async () => {
    app = await createTestApp();
  });
  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    counter += 1;
    await resetDatabase();
    await seedRbac();
    await grantPermissions('BUSINESS_ADMIN', OWNER_PERMS);
    await grantPermissions('WAREHOUSE_OPERATOR', ['grn:create', 'grn:read', 'inventory:adjust', 'inventory:read', 'order:read', 'warehouse:read', 'warehouse:pick']);
    owner = await createAuthenticatedStaff(app, ['BUSINESS_ADMIN']);
    partner = await createAuthenticatedStaff(app, ['BUSINESS_ADMIN']);
    clerk = await createAuthenticatedStaff(app, ['WAREHOUSE_OPERATOR']);
    fixtures = await seedBrandAndLocation();
  });

  const setPolicy = (token: string, body: Record<string, unknown>) =>
    app.inject({ method: 'PUT', url: '/api/v1/approvals/policy', headers: auth(token), payload: body });
  const ownerMode = (owners: string[] = [owner.staffUserId]) =>
    setPolicy(owner.token, { ownerApprovalEnabled: true, ownerStaffIds: owners, confirmation: { password: PASSWORD } });
  const selfApproval = (reason = 'Sole owner; approving my own order') => ({ reason, password: PASSWORD });

  async function sku() {
    const code = `AP-${counter}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
    const style = await testPrisma.style.create({ data: { styleCode: code, name: 'Shirt', brandId: fixtures.brand.id, categoryId: fixtures.category.id, season: 'SS26', collection: 'Core' } });
    const colour = await testPrisma.colour.create({ data: { styleId: style.id, name: 'Black', colourCode: 'BLK' } });
    return testPrisma.sku.create({ data: { styleId: style.id, colourId: colour.id, sizeId: fixtures.size.id, skuCode: `${code}-BLK-M` } });
  }

  async function submittedPo(token: string, orderedQty = 30) {
    const s = await sku();
    const supplier = await testPrisma.supplier.create({ data: { code: `SUP-${counter}-${Math.random().toString(36).slice(2, 6)}`, name: 'Supplier', type: 'FINISHED_GOODS' } });
    const created = await app.inject({
      method: 'POST', url: '/api/v1/procurement/purchase-orders', headers: auth(token),
      payload: { supplierId: supplier.id, locationId: fixtures.location.id, lines: [{ skuId: s.id, orderedQty, unitCost: 100 }] },
    });
    expect(created.statusCode).toBe(201);
    const po = created.json() as { id: string; lines: Array<{ id: string; skuId: string }> };
    expect((await app.inject({ method: 'POST', url: `/api/v1/procurement/purchase-orders/${po.id}/submit`, headers: auth(token) })).statusCode).toBe(200);
    return po;
  }
  const approvePo = (poId: string, token: string, body: Record<string, unknown> = {}) =>
    app.inject({ method: 'POST', url: `/api/v1/procurement/purchase-orders/${poId}/approve`, headers: auth(token), payload: body });

  describe('the policy itself', () => {
    it('starts off; only org:manage may change it, with a correct password; every change is audited', async () => {
      const read = (await app.inject({ method: 'GET', url: '/api/v1/approvals/policy', headers: auth(clerk.token) })).json();
      expect(read).toMatchObject({ ownerApprovalEnabled: false, owners: [], viewerIsOwner: false });

      expect((await setPolicy(clerk.token, { ownerApprovalEnabled: true, ownerStaffIds: [clerk.staffUserId], confirmation: { password: PASSWORD } })).statusCode).toBe(403);
      const wrong = await setPolicy(owner.token, { ownerApprovalEnabled: true, ownerStaffIds: [owner.staffUserId], confirmation: { password: 'wrong' } });
      expect(wrong.statusCode).toBe(400);
      expect(wrong.json().error.message).toMatch(/password is not correct/);
      expect(await testPrisma.auditLog.count({ where: { action: 'approval.confirmation_failed', actorStaffId: owner.staffUserId } })).toBe(1);
      const empty = await setPolicy(owner.token, { ownerApprovalEnabled: true, ownerStaffIds: [], confirmation: { password: PASSWORD } });
      expect(empty.json().error.message).toMatch(/at least one owner/);

      const on = await ownerMode();
      expect(on.statusCode).toBe(200);
      expect(on.json()).toMatchObject({ ownerApprovalEnabled: true, owners: [{ id: owner.staffUserId }], viewerIsOwner: true });
      const audit = await testPrisma.auditLog.findFirstOrThrow({ where: { action: 'approval_policy.update' } });
      expect(audit.oldValue).toEqual({ ownerApprovalEnabled: false, ownerStaffIds: [] });
      expect(audit.newValue).toEqual({ ownerApprovalEnabled: true, ownerStaffIds: [owner.staffUserId] });
    });

    it('refuses further confirmations after five wrong passwords in 15 minutes', async () => {
      for (let i = 0; i < 5; i++) {
        await setPolicy(owner.token, { ownerApprovalEnabled: false, ownerStaffIds: [], confirmation: { password: `wrong-${i}` } });
      }
      const blocked = await ownerMode();
      expect(blocked.statusCode).toBe(400);
      expect(blocked.json().error.message).toMatch(/Too many incorrect confirmations/);
    });

    it('the database refuses a self-approval without a reason, and an "independent" approval by the requester', async () => {
      const base = { kind: 'PURCHASE_ORDER' as const, entityType: 'PurchaseOrder', entityId: 'x', requestedByStaffId: owner.staffUserId, approvedByStaffId: owner.staffUserId };
      await expect(testPrisma.approvalRecord.create({ data: { ...base, selfApproved: true, reason: null } })).rejects.toThrow();
      await expect(testPrisma.approvalRecord.create({ data: { ...base, selfApproved: false } })).rejects.toThrow();
    });
  });

  describe('purchase orders', () => {
    it('with owner approval off, the submitter cannot approve; someone else can, and it is recorded', async () => {
      const po = await submittedPo(owner.token);
      const self = await approvePo(po.id, owner.token, { selfApproval: selfApproval() });
      expect(self.statusCode).toBe(400);
      expect(self.json().error.message).toMatch(/someone other than the person who made it.*the Approvals page/);
      expect((await testPrisma.purchaseOrder.findUniqueOrThrow({ where: { id: po.id } })).status).toBe('SUBMITTED');

      expect((await approvePo(po.id, partner.token)).statusCode).toBe(200);
      const record = await testPrisma.approvalRecord.findFirstOrThrow({ where: { entityId: po.id } });
      expect(record).toMatchObject({ kind: 'PURCHASE_ORDER', requestedByStaffId: owner.staffUserId, approvedByStaffId: partner.staffUserId, selfApproved: false, reason: null });
    });

    it('with owner approval on, the owner approves their own PO only with a reason and their password', async () => {
      await ownerMode();
      const po = await submittedPo(owner.token);
      expect((await approvePo(po.id, owner.token)).json().error.message).toMatch(/give a reason and re-enter your password/);
      expect((await approvePo(po.id, owner.token, { selfApproval: selfApproval('ok') })).json().error.message).toMatch(/at least 10 characters/);
      expect((await approvePo(po.id, owner.token, { selfApproval: { reason: 'Sole owner approving', password: 'nope' } })).json().error.message).toMatch(/password is not correct/);
      expect((await testPrisma.purchaseOrder.findUniqueOrThrow({ where: { id: po.id } })).status).toBe('SUBMITTED');
      expect(await testPrisma.approvalRecord.count()).toBe(0);

      const ok = await approvePo(po.id, owner.token, { comment: 'fine', selfApproval: selfApproval() });
      expect(ok.statusCode).toBe(200);
      expect(ok.json().status).toBe('APPROVED');
      const record = await testPrisma.approvalRecord.findFirstOrThrow({ where: { entityId: po.id } });
      expect(record).toMatchObject({ selfApproved: true, reason: 'Sole owner; approving my own order', requestedByStaffId: owner.staffUserId, approvedByStaffId: owner.staffUserId });
      expect(await testPrisma.auditLog.count({ where: { action: 'approval.self_approved', entityId: po.id } })).toBe(1);

      // The log shows it, filtered to self-approvals.
      const log = (await app.inject({ method: 'GET', url: '/api/v1/approvals/records?selfApproved=true', headers: auth(owner.token) })).json();
      expect(log.total).toBe(1);
      expect(log.records[0]).toMatchObject({ kind: 'PURCHASE_ORDER', selfApproved: true, reason: 'Sole owner; approving my own order' });
      expect((await app.inject({ method: 'GET', url: '/api/v1/approvals/records', headers: auth(clerk.token) })).statusCode).toBe(403);
    });

    it('owner approval on does not let a non-owner approve their own PO, and independent approval still works', async () => {
      await ownerMode();
      const po = await submittedPo(partner.token);
      const self = await approvePo(po.id, partner.token, { selfApproval: selfApproval() });
      expect(self.statusCode).toBe(400);
      expect(self.json().error.message).toMatch(/someone other than/);
      expect((await approvePo(po.id, owner.token)).statusCode).toBe(200);
      expect((await testPrisma.approvalRecord.findFirstOrThrow({ where: { entityId: po.id } })).selfApproved).toBe(false);
    });
  });

  describe('stock adjustments', () => {
    const adjust = (token: string, payload: Record<string, unknown>) => app.inject({ method: 'POST', url: '/api/v1/inventory/adjustments', headers: auth(token), payload });

    it('a large adjustment: self co-approval refused while off, allowed for an owner with confirmation, recorded either way', async () => {
      const s = await sku();
      const base = { skuId: s.id, locationId: fixtures.location.id, quantityDelta: 60, reason: 'Opening stock count' };
      const off = await adjust(owner.token, { ...base, coApproverStaffId: owner.staffUserId, idempotencyKey: 'adj-off', selfApproval: selfApproval() });
      expect(off.statusCode).toBe(400);
      expect(await testPrisma.inventoryTransaction.count()).toBe(0);

      const other = await adjust(owner.token, { ...base, coApproverStaffId: partner.staffUserId, idempotencyKey: 'adj-other' });
      expect(other.statusCode).toBe(201);
      await ownerMode();
      const self = await adjust(owner.token, { ...base, coApproverStaffId: owner.staffUserId, idempotencyKey: 'adj-self', selfApproval: selfApproval('Counted the shelf myself') });
      expect(self.statusCode).toBe(201);
      const records = await testPrisma.approvalRecord.findMany({ where: { kind: 'STOCK_ADJUSTMENT' }, orderBy: { createdAt: 'asc' } });
      expect(records.map((r) => [r.entityId, r.selfApproved])).toEqual([[other.json().id, false], [self.json().id, true]]);
    });
  });

  describe('receiving QC sign-off', () => {
    async function receive(token: string, extra: Record<string, unknown>) {
      const po = await submittedPo(owner.token);
      expect((await approvePo(po.id, partner.token)).statusCode).toBe(200);
      const line = po.lines[0]!;
      return app.inject({
        method: 'POST', url: '/api/v1/grn', headers: auth(token),
        payload: { poId: po.id, locationId: fixtures.location.id, lines: [{ poLineId: line.id, skuId: line.skuId, receivedQty: 30, acceptedQty: 10, damagedQty: 0, rejectedQty: 20 }], ...extra },
      });
    }

    it('the receiver can no longer sign off their own QC failure unless owner approval allows it', async () => {
      const self = await receive(owner.token, { managerSignoffStaffId: owner.staffUserId });
      expect(self.statusCode).toBe(400);
      expect(self.json().error.message).toMatch(/receiving QC sign-off needs approval from someone other/);
      expect(await testPrisma.goodsReceipt.count()).toBe(0);

      const other = await receive(clerk.token, { managerSignoffStaffId: owner.staffUserId });
      expect(other.statusCode).toBe(201);
      // The signer must hold grn:qc:manager_signoff.
      expect((await receive(owner.token, { managerSignoffStaffId: clerk.staffUserId })).statusCode).toBe(400);

      await ownerMode();
      const ownerSelf = await receive(owner.token, { managerSignoffStaffId: owner.staffUserId, selfApproval: selfApproval('Supplier sent torn stock') });
      expect(ownerSelf.statusCode).toBe(201);
      const records = await testPrisma.approvalRecord.findMany({ where: { kind: 'RECEIVING_QC' }, orderBy: { createdAt: 'asc' } });
      expect(records.map((r) => [r.entityId, r.selfApproved])).toEqual([[other.json().id, false], [ownerSelf.json().id, true]]);
    });
  });

  describe('pick shortfalls', () => {
    async function pickTaskFor(quantity: number) {
      await testPrisma.serviceablePincode.create({ data: { pincode: PINCODE, city: 'New Delhi', state: 'Delhi', isServiceable: true, codAvailable: true } });
      const entity = await testPrisma.legalEntity.create({ data: { legalName: 'Approval Test Pvt Ltd', registeredState: 'Delhi' } });
      const reg = await testPrisma.gstRegistration.create({ data: { legalEntityId: entity.id, gstin: `DLAPTST${counter}A1Z${counter % 10}`, stateCode: 'DL', stateName: 'Delhi', status: 'ACTIVE', effectiveFrom: new Date(Date.now() - 86_400_000) } });
      await testPrisma.location.update({ where: { id: fixtures.location.id }, data: { gstRegistrationId: reg.id } });
      await testPrisma.taxRate.create({ data: { hsnCode: '6109', gstRatePercent: 12, effectiveFrom: new Date(Date.now() - 86_400_000) } });
      const s = await sku();
      await testPrisma.style.update({ where: { id: s.styleId }, data: { hsnCode: '6109', lifecycleState: 'PUBLISHED', publishedAt: new Date() } });
      await testPrisma.price.create({ data: { styleId: s.styleId, mrp: 10, sellingPrice: 10 } });
      await testPrisma.inventoryBalance.create({ data: { skuId: s.id, locationId: fixtures.location.id, onHand: quantity + 5, reserved: 0 } });
      const headers = { [GUEST_HEADER]: `guest-approval-${counter}` };
      const added = await app.inject({ method: 'POST', url: '/api/v1/storefront/cart/items', headers, payload: { skuId: s.id, quantity } });
      expect(added.statusCode, added.body).toBe(201);
      const address = { line1: '1 Test Street', city: 'New Delhi', state: 'Delhi', stateCode: 'DL', pincode: PINCODE };
      const checkout = await app.inject({
        method: 'POST', url: '/api/v1/storefront/checkout', headers,
        payload: { contactName: 'Jane', contactMobile: '9876543210', billingAddress: address, shippingAddress: address, paymentMethod: 'COD', idempotencyKey: `approval-${counter}` },
      });
      expect(checkout.statusCode).toBe(201);
      const order = await testPrisma.order.findUniqueOrThrow({ where: { checkoutSessionId: checkout.json().id } });
      return testPrisma.pickTask.findFirstOrThrow({ where: { orderId: order.id } });
    }
    const pick = (taskId: string, token: string, payload: Record<string, unknown>) =>
      app.inject({ method: 'POST', url: `/api/v1/warehouse/pick-tasks/${taskId}/pick`, headers: auth(token), payload: { outcome: 'SHORT', pickedQuantity: 1, exceptionReason: 'Most of the rack is empty', ...payload } });

    it('closes the gap: the picker cannot name themselves (or someone without the permission) as co-approver', async () => {
      // A named co-approver is checked whenever one is given (required at/above
      // the threshold; the cart allows at most 10 of an item, so this shortfall is 9).
      const task = await pickTaskFor(10);
      const asSelf = await pick(task.id, owner.token, { idempotencyKey: 'p-self', coApproverStaffId: owner.staffUserId });
      expect(asSelf.statusCode).toBe(400);
      expect(asSelf.json().error.message).toMatch(/pick shortfall write-off needs approval from someone other/);
      const noPermission = await pick(task.id, owner.token, { idempotencyKey: 'p-clerk', coApproverStaffId: clerk.staffUserId });
      expect(noPermission.statusCode).toBe(400);
      expect(noPermission.json().error.message).toMatch(/inventory:adjust:coapprove/);
      expect((await testPrisma.pickTask.findUniqueOrThrow({ where: { id: task.id } })).status).toBe('PENDING');

      const ok = await pick(task.id, clerk.token, { idempotencyKey: 'p-ok', coApproverStaffId: owner.staffUserId });
      expect(ok.statusCode).toBe(200);
      expect(ok.json().status).toBe('SHORT_PICKED');
      const record = await testPrisma.approvalRecord.findFirstOrThrow({ where: { kind: 'PICK_SHORTFALL' } });
      expect(record).toMatchObject({ requestedByStaffId: clerk.staffUserId, approvedByStaffId: owner.staffUserId, selfApproved: false });
      expect((record.detail as { quantityDelta: number }).quantityDelta).toBe(-9);
    });

    it('an owner can co-approve their own large shortfall under owner approval', async () => {
      await ownerMode();
      const task = await pickTaskFor(10);
      const ok = await pick(task.id, owner.token, { idempotencyKey: 'p-owner', coApproverStaffId: owner.staffUserId, selfApproval: selfApproval('Rack was empty when I checked') });
      expect(ok.statusCode).toBe(200);
      expect(await testPrisma.approvalRecord.count({ where: { kind: 'PICK_SHORTFALL', selfApproved: true } })).toBe(1);
    });
  });

  it('approver pickers offer the caller only while owner approval lets them approve their own work', async () => {
    const list = async () => (await app.inject({ method: 'GET', url: '/api/v1/admin/lookup/staff?capability=inventory-coapprover', headers: auth(owner.token) })).json() as Array<{ id: string; self: boolean }>;
    expect((await list()).some((s) => s.id === owner.staffUserId)).toBe(false);
    await ownerMode();
    expect((await list())[0]).toMatchObject({ id: owner.staffUserId, self: true });
    await setPolicy(owner.token, { ownerApprovalEnabled: true, ownerStaffIds: [partner.staffUserId], confirmation: { password: PASSWORD } });
    expect((await list()).some((s) => s.id === owner.staffUserId)).toBe(false);
  });
});
