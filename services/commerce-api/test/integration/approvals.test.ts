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
  const approveRequest = (id: string, token: string) => app.inject({ method: 'POST', url: `/api/v1/approvals/requests/${id}/approve`, headers: auth(token) });
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

    it('a burst of simultaneous wrong passwords cannot slip past the limit of five', async () => {
      const attempts = await Promise.all(
        Array.from({ length: 12 }, () => setPolicy(owner.token, { ownerApprovalEnabled: true, ownerStaffIds: [owner.staffUserId], confirmation: { password: 'wrong-password' } })),
      );
      expect(attempts.every((r) => r.statusCode === 400)).toBe(true);
      expect(await testPrisma.auditLog.count({ where: { actorStaffId: owner.staffUserId, action: 'approval.confirmation_failed' } })).toBe(5);
      expect(attempts.filter((r) => /Too many incorrect confirmations/.test(r.json().error.message))).toHaveLength(7);
      // Even the right password is refused until the window passes.
      expect((await ownerMode()).statusCode).toBe(400);
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

      const queued = await adjust(owner.token, { ...base, coApproverStaffId: partner.staffUserId, idempotencyKey: 'adj-other' });
      expect(queued.statusCode).toBe(202);
      const otherApproval = await approveRequest(queued.json().pendingApproval.id, partner.token);
      expect(otherApproval.statusCode, otherApproval.body).toBe(200);
      const other = { json: () => ({ id: otherApproval.json().resultEntityId as string }) };
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

      const queued = await receive(clerk.token, { managerSignoffStaffId: owner.staffUserId });
      expect(queued.statusCode).toBe(202);
      expect(await testPrisma.goodsReceipt.count()).toBe(0);
      const otherApproval = await approveRequest(queued.json().pendingApproval.id, owner.token);
      expect(otherApproval.statusCode, otherApproval.body).toBe(200);
      const other = { json: () => ({ id: otherApproval.json().resultEntityId as string }) };
      // The signer must hold grn:qc:manager_signoff.
      expect((await receive(owner.token, { managerSignoffStaffId: clerk.staffUserId })).statusCode).toBe(400);

      await ownerMode();
      const ownerSelf = await receive(owner.token, { managerSignoffStaffId: owner.staffUserId, selfApproval: selfApproval('Supplier sent torn stock') });
      expect(ownerSelf.statusCode).toBe(201);
      const records = await testPrisma.approvalRecord.findMany({ where: { kind: 'RECEIVING_QC' }, orderBy: { createdAt: 'asc' } });
      expect(records.map((r) => [r.entityId, r.selfApproved])).toEqual([[other.json().id, false], [ownerSelf.json().id, true]]);
    });
    it('a queued receipt receives nothing until the manager approves; then it posts as the receiver, signed off by the manager', async () => {
      const queued = await receive(clerk.token, { managerSignoffStaffId: partner.staffUserId });
      expect(queued.statusCode).toBe(202);
      const pending = queued.json().pendingApproval as { id: string; summary: { failedUnits: number; lines: Array<{ rejectedQty: number }> } };
      expect(pending.summary.failedUnits).toBe(20);
      expect(pending.summary.lines[0]!.rejectedQty).toBe(20);
      expect(await testPrisma.goodsReceipt.count()).toBe(0);
      expect(await testPrisma.inventoryTransaction.count()).toBe(0);
      // Another manager cannot approve on the named manager's behalf.
      expect((await approveRequest(pending.id, owner.token)).statusCode).toBe(403);

      const approved = await approveRequest(pending.id, partner.token);
      expect(approved.statusCode, approved.body).toBe(200);
      const grn = await testPrisma.goodsReceipt.findUniqueOrThrow({ where: { id: approved.json().resultEntityId } });
      expect(grn.receivedByStaffId).toBe(clerk.staffUserId);
      expect(await testPrisma.approvalRecord.findFirstOrThrow({ where: { approvalRequestId: pending.id } })).toMatchObject({
        kind: 'RECEIVING_QC', requestedByStaffId: clerk.staffUserId, approvedByStaffId: partner.staffUserId, selfApproved: false, entityId: grn.id,
      });
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

      const queued = await pick(task.id, clerk.token, { idempotencyKey: 'p-ok', coApproverStaffId: owner.staffUserId });
      expect(queued.statusCode).toBe(202);
      expect((await testPrisma.pickTask.findUniqueOrThrow({ where: { id: task.id } })).status).toBe('PENDING');
      const approved = await approveRequest(queued.json().pendingApproval.id, owner.token);
      expect(approved.statusCode, approved.body).toBe(200);
      expect((await testPrisma.pickTask.findUniqueOrThrow({ where: { id: task.id } })).status).toBe('SHORT_PICKED');
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

    it('a queued shortfall holds the task: no direct pick while it waits; withdrawing frees it', async () => {
      const task = await pickTaskFor(10);
      const queued = await pick(task.id, clerk.token, { idempotencyKey: 'p-wait', coApproverStaffId: owner.staffUserId });
      expect(queued.statusCode).toBe(202);
      const id = queued.json().pendingApproval.id as string;
      expect(queued.json().pendingApproval.summary).toMatchObject({ allocatedQuantity: 10, pickedQuantity: 1, writeOff: 9 });

      // Asking again is the same request; a different outcome is refused while one is open.
      expect((await pick(task.id, clerk.token, { idempotencyKey: 'p-wait', coApproverStaffId: owner.staffUserId })).json().pendingApproval.id).toBe(id);
      expect((await pick(task.id, clerk.token, { idempotencyKey: 'p-other', pickedQuantity: 2, coApproverStaffId: owner.staffUserId })).statusCode).toBe(409);
      // Nor can anyone record the pick directly meanwhile.
      const direct = await pick(task.id, clerk.token, { idempotencyKey: 'p-direct', outcome: 'FULL', pickedQuantity: 10 });
      expect(direct.statusCode).toBe(409);
      expect(direct.json().error.message).toMatch(/waiting for .* to approve the shortfall/);
      const view = await app.inject({ method: 'GET', url: `/api/v1/warehouse/pick-tasks/${task.id}`, headers: auth(clerk.token) });
      expect(view.json().pendingApproval).toMatchObject({ id });

      expect((await app.inject({ method: 'POST', url: `/api/v1/approvals/requests/${id}/cancel`, headers: auth(clerk.token) })).json().status).toBe('CANCELLED');
      const full = await pick(task.id, clerk.token, { idempotencyKey: 'p-full', outcome: 'FULL', pickedQuantity: 10 });
      expect(full.statusCode, full.body).toBe(200);
      expect(full.json().status).toBe('PICKED');
      expect(await testPrisma.approvalRecord.count({ where: { kind: 'PICK_SHORTFALL' } })).toBe(0);
    });

    it('a shortfall approved after the line was cancelled fails with the reason and writes nothing off', async () => {
      const task = await pickTaskFor(10);
      const id = (await pick(task.id, clerk.token, { idempotencyKey: 'p-cancelled', coApproverStaffId: owner.staffUserId })).json().pendingApproval.id as string;
      await testPrisma.pickTask.update({ where: { id: task.id }, data: { status: 'CANCELLED' } });
      const res = await approveRequest(id, owner.token);
      expect(res.statusCode).toBe(409);
      const row = await testPrisma.approvalRequest.findUniqueOrThrow({ where: { id } });
      expect(row.status).toBe('FAILED');
      expect(row.failureReason).toMatch(/already been processed/);
      expect(await testPrisma.inventoryTransaction.count({ where: { type: 'ADJUSTMENT_OUT' } })).toBe(0);
    });
  });

  describe('approval requests: the named approver confirms from their own login', () => {
    const adjust = (token: string, payload: Record<string, unknown>) => app.inject({ method: 'POST', url: '/api/v1/inventory/adjustments', headers: auth(token), payload });
    const requests = (token: string, box: 'inbox' | 'outbox' | 'all', status?: string) =>
      app.inject({ method: 'GET', url: `/api/v1/approvals/requests?box=${box}${status ? `&status=${status}` : ''}`, headers: auth(token) });
    const decide = (id: string, verb: 'approve' | 'reject' | 'cancel', token: string, payload: Record<string, unknown> = {}) =>
      app.inject({ method: 'POST', url: `/api/v1/approvals/requests/${id}/${verb}`, headers: auth(token), payload });
    const balance = async (skuId: string) =>
      (await testPrisma.inventoryBalance.findUnique({ where: { skuId_locationId: { skuId, locationId: fixtures.location.id } } }))?.onHand ?? 0;

    it('naming someone else queues the adjustment: nothing moves until that person approves it themselves', async () => {
      const s = await sku();
      const sent = await adjust(clerk.token, { skuId: s.id, locationId: fixtures.location.id, quantityDelta: 60, reason: 'Opening stock count', coApproverStaffId: owner.staffUserId, idempotencyKey: 'q-1' });
      expect(sent.statusCode, sent.body).toBe(202);
      const pending = sent.json().pendingApproval as { id: string; status: string; approver: string };
      expect(pending.status).toBe('PENDING');
      expect(await testPrisma.inventoryTransaction.count()).toBe(0);
      expect(await testPrisma.approvalRecord.count()).toBe(0);

      // The same request again (a retry) is the same open request.
      const again = await adjust(clerk.token, { skuId: s.id, locationId: fixtures.location.id, quantityDelta: 60, reason: 'Opening stock count', coApproverStaffId: owner.staffUserId, idempotencyKey: 'q-1' });
      expect(again.statusCode).toBe(202);
      expect(again.json().pendingApproval.id).toBe(pending.id);
      expect(await testPrisma.approvalRequest.count()).toBe(1);

      // It is in the approver's inbox and the requester's outbox, nowhere else.
      expect((await requests(owner.token, 'inbox', 'PENDING')).json().requests.map((r: { id: string }) => r.id)).toEqual([pending.id]);
      expect((await requests(clerk.token, 'outbox')).json().requests.map((r: { id: string }) => r.id)).toEqual([pending.id]);
      expect((await requests(partner.token, 'inbox')).json().total).toBe(0);
      expect((await requests(clerk.token, 'all')).statusCode).toBe(403);

      // Neither the requester nor a third person can approve it.
      expect((await decide(pending.id, 'approve', clerk.token)).statusCode).toBe(403);
      expect((await decide(pending.id, 'approve', partner.token)).statusCode).toBe(403);
      expect(await testPrisma.inventoryTransaction.count()).toBe(0);

      const approved = await decide(pending.id, 'approve', owner.token);
      expect(approved.statusCode, approved.body).toBe(200);
      expect(approved.json()).toMatchObject({ status: 'APPROVED', resultEntityType: 'InventoryTransaction' });
      expect(await balance(s.id)).toBe(60);
      const txn = await testPrisma.inventoryTransaction.findFirstOrThrow({ where: { skuId: s.id } });
      expect(txn).toMatchObject({ actorStaffId: clerk.staffUserId, coApproverStaffId: owner.staffUserId, quantity: 60, idempotencyKey: 'q-1' });
      const record = await testPrisma.approvalRecord.findFirstOrThrow({ where: { kind: 'STOCK_ADJUSTMENT' } });
      expect(record).toMatchObject({ requestedByStaffId: clerk.staffUserId, approvedByStaffId: owner.staffUserId, selfApproved: false, approvalRequestId: pending.id, entityId: txn.id });

      // Approving twice does nothing more.
      expect((await decide(pending.id, 'approve', owner.token)).statusCode).toBe(409);
      expect(await testPrisma.inventoryTransaction.count()).toBe(1);
    });

    it('two approvals of the same request at the same moment apply it once', async () => {
      const s = await sku();
      const sent = await adjust(clerk.token, { skuId: s.id, locationId: fixtures.location.id, quantityDelta: 70, reason: 'Recount', coApproverStaffId: owner.staffUserId, idempotencyKey: 'q-race' });
      const id = sent.json().pendingApproval.id as string;
      const results = await Promise.all([decide(id, 'approve', owner.token), decide(id, 'approve', owner.token), decide(id, 'approve', owner.token)]);
      expect(results.map((r) => r.statusCode).sort()).toEqual([200, 409, 409]);
      expect(await balance(s.id)).toBe(70);
      expect(await testPrisma.inventoryTransaction.count({ where: { skuId: s.id } })).toBe(1);
      expect(await testPrisma.approvalRecord.count({ where: { approvalRequestId: id } })).toBe(1);
    });

    it('a rejection needs a note, applies nothing, and closes the request; the requester can withdraw an open one', async () => {
      const s = await sku();
      const first = (await adjust(clerk.token, { skuId: s.id, locationId: fixtures.location.id, quantityDelta: 55, reason: 'Found stock', coApproverStaffId: owner.staffUserId, idempotencyKey: 'q-rej' })).json().pendingApproval.id as string;
      expect((await decide(first, 'reject', owner.token, { note: '' })).statusCode).toBe(400);
      expect((await decide(first, 'reject', clerk.token, { note: 'not mine to reject' })).statusCode).toBe(403);
      const rejected = await decide(first, 'reject', owner.token, { note: 'Count it again with a second person' });
      expect(rejected.json()).toMatchObject({ status: 'REJECTED', decisionNote: 'Count it again with a second person' });
      expect((await decide(first, 'approve', owner.token)).statusCode).toBe(409);
      expect(await testPrisma.inventoryTransaction.count()).toBe(0);

      const second = (await adjust(clerk.token, { skuId: s.id, locationId: fixtures.location.id, quantityDelta: 55, reason: 'Found stock', coApproverStaffId: owner.staffUserId, idempotencyKey: 'q-rej-2' })).json().pendingApproval.id as string;
      expect((await decide(second, 'cancel', owner.token)).statusCode).toBe(403);
      expect((await decide(second, 'cancel', clerk.token)).json().status).toBe('CANCELLED');
      expect((await decide(second, 'approve', owner.token)).statusCode).toBe(409);
      expect(await testPrisma.inventoryTransaction.count()).toBe(0);
      expect(await testPrisma.auditLog.count({ where: { action: { in: ['approval.requested', 'approval.rejected', 'approval.cancelled'] } } })).toBe(4);
    });

    it('re-checked at approval: an approver who lost the permission cannot approve; an action no longer possible fails with the reason', async () => {
      const s = await sku();
      await testPrisma.inventoryBalance.create({ data: { skuId: s.id, locationId: fixtures.location.id, onHand: 60, reserved: 0 } });
      const id = (await adjust(clerk.token, { skuId: s.id, locationId: fixtures.location.id, quantityDelta: -60, reason: 'Water damage', coApproverStaffId: partner.staffUserId, idempotencyKey: 'q-gone' })).json().pendingApproval.id as string;

      // Meanwhile 10 units leave by another route: writing off 60 is no longer possible.
      await testPrisma.inventoryBalance.update({ where: { skuId_locationId: { skuId: s.id, locationId: fixtures.location.id } }, data: { onHand: 50 } });
      const failed = await decide(id, 'approve', partner.token);
      expect(failed.statusCode).toBe(409);
      const row = await testPrisma.approvalRequest.findUniqueOrThrow({ where: { id } });
      expect(row).toMatchObject({ status: 'FAILED', decidedByStaffId: partner.staffUserId });
      expect(row.failureReason).toMatch(/negative on-hand/);
      expect(await testPrisma.inventoryTransaction.count()).toBe(0);

      const id2 = (await adjust(clerk.token, { skuId: s.id, locationId: fixtures.location.id, quantityDelta: -50, reason: 'Water damage', coApproverStaffId: partner.staffUserId, idempotencyKey: 'q-perm' })).json().pendingApproval.id as string;
      const role = await testPrisma.role.findUniqueOrThrow({ where: { key: 'BUSINESS_ADMIN' } });
      const perm = await testPrisma.permission.findUniqueOrThrow({ where: { key: 'inventory:adjust:coapprove' } });
      await testPrisma.rolePermission.delete({ where: { roleId_permissionId: { roleId: role.id, permissionId: perm.id } } });
      expect((await decide(id2, 'approve', partner.token)).statusCode).toBe(400);
      expect((await testPrisma.approvalRequest.findUniqueOrThrow({ where: { id: id2 } })).status).toBe('PENDING');
      expect(await testPrisma.inventoryTransaction.count()).toBe(0);
    });

    it('the database holds the rules: never yourself, decided only by the named approver, cancelled only by the requester', async () => {
      const base = { kind: 'STOCK_ADJUSTMENT' as const, payload: {}, summary: {} };
      await expect(testPrisma.approvalRequest.create({ data: { ...base, requestedByStaffId: clerk.staffUserId, approverStaffId: clerk.staffUserId } })).rejects.toThrow();
      const row = await testPrisma.approvalRequest.create({ data: { ...base, requestedByStaffId: clerk.staffUserId, approverStaffId: owner.staffUserId } });
      await expect(testPrisma.approvalRequest.update({ where: { id: row.id }, data: { status: 'APPROVED', decidedAt: new Date(), decidedByStaffId: partner.staffUserId } })).rejects.toThrow();
      await expect(testPrisma.approvalRequest.update({ where: { id: row.id }, data: { status: 'CANCELLED', decidedAt: new Date(), decidedByStaffId: owner.staffUserId } })).rejects.toThrow();
      await expect(testPrisma.approvalRequest.update({ where: { id: row.id }, data: { status: 'REJECTED', decidedAt: new Date(), decidedByStaffId: owner.staffUserId } })).rejects.toThrow();
    });

    it('the service refuses an independent approval given on someone else’s behalf', async () => {
      const { ApprovalPolicyService } = await import('../../src/modules/approvals/service.js');
      await expect(
        new ApprovalPolicyService(testPrisma).decide({ kind: 'STOCK_ADJUSTMENT', requestedByStaffId: clerk.staffUserId, approverStaffId: owner.staffUserId, actingStaffId: clerk.staffUserId, permission: 'inventory:adjust:coapprove' }),
      ).rejects.toThrow(/from their own login/);
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
