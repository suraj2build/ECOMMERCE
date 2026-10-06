import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createTestApp } from '../helpers/app.js';
import { resetDatabase, seedRbac, grantPermissions, seedBrandAndLocation, testPrisma } from '../helpers/db.js';
import { createAuthenticatedStaff } from '../helpers/auth.js';
import { MockCarrierProvider } from '../../src/modules/shipping/provider.js';
import { OrderService } from '../../src/modules/order/service.js';
import { createHmac } from 'node:crypto';

const GUEST_HEADER = 'x-guest-session-id';
const PINCODE = '110001';

/**
 * Dispatch (docs/admin/DISPATCH.md; Product Owner review 2026-10-05, AO-D5):
 * barcode checks at pick and pack, parcel measurements sent with the courier
 * booking, packing slip / label data, and handover recorded separately from
 * booking. AO-D5 option B (Product Owner, 2026-10-06): the handover, not the
 * booking, posts the stock SALE, marks the package shipped and sends the
 * customer's message.
 */
describe('Dispatch: scans, parcel, documents and handover', () => {
  let app: FastifyInstance;
  let counter = 0;
  let staff: { staffUserId: string; token: string };
  let owner: { staffUserId: string; token: string };
  let fixtures: Awaited<ReturnType<typeof seedBrandAndLocation>>;
  const auth = (t = staff.token) => ({ authorization: `Bearer ${t}` });

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
    await grantPermissions('WAREHOUSE_MANAGER', ['order:read', 'order:fulfil', 'warehouse:read', 'warehouse:pick', 'shipping:manage']);
    await grantPermissions('BUSINESS_ADMIN', ['org:manage', 'order:read']);
    staff = await createAuthenticatedStaff(app, ['WAREHOUSE_MANAGER']);
    owner = await createAuthenticatedStaff(app, ['BUSINESS_ADMIN']);
    fixtures = await seedBrandAndLocation();
    await testPrisma.serviceablePincode.create({ data: { pincode: PINCODE, city: 'New Delhi', state: 'Delhi', isServiceable: true, codAvailable: true } });
    const entity = await testPrisma.legalEntity.create({ data: { legalName: 'Dispatch Test Pvt Ltd', registeredState: 'Delhi' } });
    const reg = await testPrisma.gstRegistration.create({ data: { legalEntityId: entity.id, gstin: `DLDSP${counter}A1Z${counter % 10}`, stateCode: 'DL', stateName: 'Delhi', status: 'ACTIVE', effectiveFrom: new Date(Date.now() - 86_400_000) } });
    await testPrisma.location.update({ where: { id: fixtures.location.id }, data: { gstRegistrationId: reg.id, addressLine1: '12 Godown Lane', city: 'New Delhi', state: 'Delhi', pinCode: '110020' } });
    await testPrisma.taxRate.create({ data: { hsnCode: '6109', gstRatePercent: 12, effectiveFrom: new Date(Date.now() - 86_400_000) } });
  });

  async function sku(barcode: string | null, code = `DSP-${counter}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`) {
    const style = await testPrisma.style.create({ data: { styleCode: code, name: 'Oxford Shirt', brandId: fixtures.brand.id, categoryId: fixtures.category.id, season: 'SS26', collection: 'Core', hsnCode: '6109', lifecycleState: 'PUBLISHED', publishedAt: new Date() } });
    const colour = await testPrisma.colour.create({ data: { styleId: style.id, name: 'White', colourCode: 'WHT' } });
    const s = await testPrisma.sku.create({ data: { styleId: style.id, colourId: colour.id, sizeId: fixtures.size.id, skuCode: `${code}-WHT-M`, barcode } });
    await testPrisma.price.create({ data: { styleId: style.id, mrp: 500, sellingPrice: 500 } });
    await testPrisma.inventoryBalance.create({ data: { skuId: s.id, locationId: fixtures.location.id, onHand: 20, reserved: 0 } });
    return s;
  }

  async function order(items: Array<{ skuId: string; quantity: number }>) {
    const headers = { [GUEST_HEADER]: `guest-dispatch-${counter}-${Math.random().toString(36).slice(2, 6)}` };
    for (const item of items) expect((await app.inject({ method: 'POST', url: '/api/v1/storefront/cart/items', headers, payload: item })).statusCode).toBe(201);
    const address = { line1: '7 Park Street', city: 'New Delhi', state: 'Delhi', stateCode: 'DL', pincode: PINCODE };
    const res = await app.inject({
      method: 'POST', url: '/api/v1/storefront/checkout', headers,
      payload: { contactName: 'Asha Rao', contactMobile: '9876543210', billingAddress: address, shippingAddress: address, paymentMethod: 'COD', idempotencyKey: `dispatch-${counter}-${Math.random()}` },
    });
    expect(res.statusCode, res.body).toBe(201);
    const row = await testPrisma.order.findUniqueOrThrow({ where: { checkoutSessionId: res.json().id }, include: { lines: { orderBy: { id: 'asc' } } } });
    return Object.assign(row, { shopperHeaders: headers });
  }

  const pick = (taskId: string, payload: Record<string, unknown>) =>
    app.inject({ method: 'POST', url: `/api/v1/warehouse/pick-tasks/${taskId}/pick`, headers: auth(), payload: { idempotencyKey: `pick-${taskId}-${Math.random()}`, outcome: 'FULL', ...payload } });

  async function pickAll(orderId: string, scans: Record<string, string> = {}) {
    for (const task of await testPrisma.pickTask.findMany({ where: { orderId } })) {
      const res = await pick(task.id, { pickedQuantity: task.allocatedQuantity, ...(scans[task.skuId] ? { scannedBarcode: scans[task.skuId] } : {}) });
      expect(res.statusCode, res.body).toBe(200);
    }
  }

  async function fulfilment(orderId: string, lineIds: string[]) {
    const res = await app.inject({ method: 'POST', url: `/api/v1/orders/${orderId}/fulfilments`, headers: auth(), payload: { lineIds } });
    expect(res.statusCode, res.body).toBe(201);
    return res.json() as { id: string };
  }
  const pack = (fulfilmentId: string, payload: Record<string, unknown> = {}) =>
    app.inject({ method: 'POST', url: `/api/v1/orders/fulfilments/${fulfilmentId}/pack`, headers: auth(), payload });
  const setSettings = (value: Record<string, boolean>, t = owner.token) =>
    app.inject({ method: 'PUT', url: '/api/v1/dispatch/settings', headers: auth(t), payload: { requireScanAtPick: false, requireScanAtPack: false, requireParcelMeasurements: false, ...value } });

  describe('pick scan', () => {
    it('accepts the right barcode and refuses another item, an unknown code, or a size with no barcode', async () => {
      const a = await sku('8901000000011');
      const b = await sku('8901000000028');
      const o = await order([{ skuId: a.id, quantity: 1 }]);
      const task = await testPrisma.pickTask.findFirstOrThrow({ where: { orderId: o.id } });

      const wrong = await pick(task.id, { pickedQuantity: 1, scannedBarcode: b.barcode });
      expect(wrong.statusCode).toBe(400);
      expect(wrong.json().error.message).toMatch(new RegExp(`belongs to ${b.skuCode}`));
      const unknown = await pick(task.id, { pickedQuantity: 1, scannedBarcode: '0000000000000' });
      expect(unknown.json().error.message).toMatch(/does not match/);
      expect((await testPrisma.pickTask.findUniqueOrThrow({ where: { id: task.id } })).status).toBe('PENDING');

      const ok = await pick(task.id, { pickedQuantity: 1, scannedBarcode: ` ${a.barcode} ` });
      expect(ok.statusCode).toBe(200);
      expect((await testPrisma.pickTask.findUniqueOrThrow({ where: { id: task.id } })).scannedBarcode).toBe(a.barcode);

      const noBarcode = await sku(null);
      const o2 = await order([{ skuId: noBarcode.id, quantity: 1 }]);
      const t2 = await testPrisma.pickTask.findFirstOrThrow({ where: { orderId: o2.id } });
      expect((await pick(t2.id, { pickedQuantity: 1, scannedBarcode: '123' })).json().error.message).toMatch(/has no barcode/);
    });

    it('is optional until the owner requires it; then a pick without a scan is refused', async () => {
      const a = await sku('8901000000035');
      const o = await order([{ skuId: a.id, quantity: 1 }]);
      const task = await testPrisma.pickTask.findFirstOrThrow({ where: { orderId: o.id } });
      expect((await setSettings({ requireScanAtPick: true }, staff.token)).statusCode).toBe(403);
      expect((await setSettings({ requireScanAtPick: true })).statusCode).toBe(200);
      const res = await pick(task.id, { pickedQuantity: 1 });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.message).toMatch(/Scan the item's barcode/);
      // An exception picks nothing and needs no scan.
      expect((await pick(task.id, { outcome: 'EXCEPTION', exceptionType: 'DAMAGED', exceptionReason: 'Torn' })).statusCode).toBe(200);
      expect(await testPrisma.auditLog.count({ where: { action: 'dispatch_settings.update' } })).toBe(1);
    });
  });

  describe('pack scans and parcel', () => {
    it('matches every unit exactly: missing, extra, foreign and unknown scans are refused with the reason', async () => {
      const a = await sku('8901000000042');
      const b = await sku('8901000000059');
      const other = await sku('8901000000066');
      const o = await order([{ skuId: a.id, quantity: 2 }, { skuId: b.id, quantity: 1 }]);
      await pickAll(o.id);
      const f = await fulfilment(o.id, o.lines.map((l) => l.id));

      const missing = await pack(f.id, { scannedBarcodes: [a.barcode, b.barcode] });
      expect(missing.statusCode).toBe(400);
      expect(missing.json().error.message).toMatch(new RegExp(`${a.skuCode}: 1 more to scan`));
      const extra = await pack(f.id, { scannedBarcodes: [a.barcode, a.barcode, a.barcode, b.barcode] });
      expect(extra.json().error.message).toMatch(/scanned 1 too many/);
      const foreign = await pack(f.id, { scannedBarcodes: [a.barcode, a.barcode, b.barcode, other.barcode] });
      expect(foreign.json().error.message).toMatch(new RegExp(`${other.skuCode} \\(1\\) is not in this package`));
      const unknown = await pack(f.id, { scannedBarcodes: [a.barcode, a.barcode, b.barcode, '999'] });
      expect(unknown.json().error.message).toMatch(/999 is not a known barcode/);
      expect((await testPrisma.orderFulfilment.findUniqueOrThrow({ where: { id: f.id } })).status).toBe('PENDING');

      const ok = await pack(f.id, { scannedBarcodes: [b.barcode, a.barcode, a.barcode], parcel: { weightGrams: 850, lengthCm: 35, widthCm: 25, heightCm: 8 } });
      expect(ok.statusCode, ok.body).toBe(200);
      const packed = await testPrisma.orderFulfilment.findUniqueOrThrow({ where: { id: f.id } });
      expect(packed).toMatchObject({ status: 'PACKED', parcelWeightGrams: 850, parcelLengthCm: 35, parcelWidthCm: 25, parcelHeightCm: 8 });
      expect(packed.packScanVerifiedAt).not.toBeNull();
    });

    it('validates measurements and enforces the owner\'s requirements', async () => {
      const a = await sku('8901000000073');
      const o = await order([{ skuId: a.id, quantity: 1 }]);
      await pickAll(o.id);
      const f = await fulfilment(o.id, [o.lines[0]!.id]);
      expect((await pack(f.id, { parcel: { weightGrams: -1 } })).statusCode).toBe(400);
      expect((await pack(f.id, { parcel: { lengthCm: 30 } })).json().error.message).toMatch(/all three dimensions/);
      await setSettings({ requireScanAtPack: true, requireParcelMeasurements: true });
      expect((await pack(f.id, { parcel: { weightGrams: 300, lengthCm: 30, widthCm: 20, heightCm: 3 } })).json().error.message).toMatch(/Scan every unit/);
      expect((await pack(f.id, { scannedBarcodes: [a.barcode] })).json().error.message).toMatch(/parcel weight/);
      expect((await pack(f.id, { scannedBarcodes: [a.barcode], parcel: { weightGrams: 300, lengthCm: 30, widthCm: 20, heightCm: 3 } })).statusCode).toBe(200);
    });

    it('packing without scans still works by default (no change for existing flows)', async () => {
      const a = await sku(null);
      const o = await order([{ skuId: a.id, quantity: 1 }]);
      await pickAll(o.id);
      const f = await fulfilment(o.id, [o.lines[0]!.id]);
      expect((await pack(f.id)).statusCode).toBe(200);
      expect((await testPrisma.orderFulfilment.findUniqueOrThrow({ where: { id: f.id } })).packScanVerifiedAt).toBeNull();
    });
  });

  describe('booking, documents and handover', () => {
    async function readyPackage(barcode = '8901000000080') {
      const a = await sku(barcode);
      const o = await order([{ skuId: a.id, quantity: 2 }]);
      await pickAll(o.id);
      const f = await fulfilment(o.id, [o.lines[0]!.id]);
      expect((await pack(f.id, { scannedBarcodes: [a.barcode, a.barcode], parcel: { weightGrams: 640, lengthCm: 30, widthCm: 22, heightCm: 5 } })).statusCode).toBe(200);
      expect((await app.inject({ method: 'POST', url: `/api/v1/orders/fulfilments/${f.id}/ready-to-ship`, headers: auth() })).statusCode).toBe(200);
      return { a, o, f };
    }
    const book = (fulfilmentId: string) =>
      app.inject({ method: 'POST', url: `/api/v1/orders/fulfilments/${fulfilmentId}/shipment`, headers: auth(), payload: { idempotencyKey: `book-${fulfilmentId}` } });

    it('refuses a courier booking until the warehouse has a full sender address; a replay of an existing booking still converges', async () => {
      const { a, f } = await readyPackage();
      await testPrisma.location.update({ where: { id: fixtures.location.id }, data: { addressLine1: null, pinCode: null } });
      const carrier = vi.spyOn(MockCarrierProvider.prototype, 'initiateShipment');

      const refused = await book(f.id);
      expect(refused.statusCode).toBe(400);
      expect(refused.json().error.message).toBe(
        'Add the address line and PIN code for Test Warehouse on Business & warehouse before booking a courier: it is the sender and return address on the label.',
      );
      // Nothing was booked, recorded or sold, and the courier was never called.
      expect(carrier).not.toHaveBeenCalled();
      expect(await testPrisma.shipment.count({ where: { fulfilmentId: f.id } })).toBe(0);
      expect((await testPrisma.orderFulfilment.findUniqueOrThrow({ where: { id: f.id } })).status).toBe('READY_TO_SHIP');
      expect(await testPrisma.inventoryTransaction.count({ where: { skuId: a.id, type: 'SALE' } })).toBe(0);

      // Completing the address in Business & warehouse is enough.
      const fixed = await app.inject({
        method: 'PATCH',
        url: `/api/v1/organization/locations/${fixtures.location.id}`,
        headers: auth(owner.token),
        payload: { addressLine1: '12 Godown Lane', pinCode: '110020' },
      });
      expect(fixed.statusCode, fixed.body).toBe(200);
      const booked = await book(f.id);
      expect(booked.statusCode, booked.body).toBe(201);
      expect(carrier).toHaveBeenCalledTimes(1);
      carrier.mockRestore();

      // A retry of the same booking returns it, even if the address was blanked since.
      await testPrisma.location.update({ where: { id: fixtures.location.id }, data: { addressLine1: '' } });
      const replay = await book(f.id);
      expect(replay.statusCode).toBe(201);
      expect(replay.json().id).toBe(booked.json().id);
    });

    it('sends the parcel weight and size with the booking; booking moves no stock; the handover posts the sale once', async () => {
      const { a, f } = await readyPackage();
      const balance = () => testPrisma.inventoryBalance.findFirstOrThrow({ where: { skuId: a.id }, select: { onHand: true, reserved: true } });
      const before = await balance();
      const spy = vi.spyOn(MockCarrierProvider.prototype, 'initiateShipment');
      const booked = await book(f.id);
      expect(booked.statusCode, booked.body).toBe(201);
      expect(spy.mock.calls[0]![0]).toMatchObject({ weightGrams: 640, dimensionsCm: { length: 30, width: 22, height: 5 } });
      spy.mockRestore();

      const shipment = await testPrisma.shipment.findUniqueOrThrow({ where: { fulfilmentId: f.id } });
      expect(shipment).toMatchObject({ status: 'BOOKED', handedOverAt: null });
      // AO-D5 option B: booked, not collected - no sale, stock still reserved, lines still packed.
      expect(await testPrisma.inventoryTransaction.count({ where: { skuId: a.id, type: 'SALE' } })).toBe(0);
      expect(await balance()).toEqual(before);
      expect(await testPrisma.orderFulfilment.findUniqueOrThrow({ where: { id: f.id } })).toMatchObject({ status: 'BOOKED', shippedAt: null, carrierName: 'MOCK' });
      expect((await testPrisma.orderLine.findFirstOrThrow({ where: { fulfilmentId: f.id } })).status).toBe('PACKED');
      // A manual "mark shipped" cannot skip the handover.
      const manual = await app.inject({ method: 'POST', url: `/api/v1/orders/fulfilments/${f.id}/ship`, headers: auth(), payload: {} });
      expect(manual.statusCode).toBe(400);
      expect(manual.json().error.message).toMatch(/booked with the courier/);

      const awaiting = (await app.inject({ method: 'GET', url: '/api/v1/shipments/handover', headers: auth() })).json();
      expect(awaiting.shipments).toEqual([expect.objectContaining({ id: shipment.id, units: 2, parcelWeightGrams: 640 })]);

      const handed = await app.inject({ method: 'POST', url: '/api/v1/shipments/handover', headers: auth(), payload: { shipmentIds: [shipment.id], reference: 'MANIFEST-7' } });
      expect(handed.json()).toEqual({ recorded: 1, alreadyHandedOver: 0, shipped: 1 });
      const after = await testPrisma.shipment.findUniqueOrThrow({ where: { id: shipment.id } });
      expect(after).toMatchObject({ handoverSource: 'STAFF', handedOverByStaffId: staff.staffUserId, handoverReference: 'MANIFEST-7', status: 'BOOKED' });
      expect(after.handedOverAt).not.toBeNull();
      expect(await testPrisma.orderFulfilment.findUniqueOrThrow({ where: { id: f.id } })).toMatchObject({ status: 'SHIPPED' });
      expect((await testPrisma.orderLine.findFirstOrThrow({ where: { fulfilmentId: f.id } })).status).toBe('SHIPPED');
      expect(await testPrisma.inventoryTransaction.count({ where: { skuId: a.id, type: 'SALE' } })).toBe(1);
      expect(await balance()).toEqual({ onHand: before.onHand - 2, reserved: before.reserved - 2 });
      const shipAudit = await testPrisma.auditLog.findFirstOrThrow({ where: { action: 'order.fulfilment.ship', entityId: f.id } });
      expect(shipAudit).toMatchObject({ actorType: 'STAFF', actorStaffId: staff.staffUserId });
      expect(shipAudit.newValue).toMatchObject({ at: 'HANDOVER' });

      // Repeating it changes nothing: no second handover, sale or stock movement.
      expect((await app.inject({ method: 'POST', url: '/api/v1/shipments/handover', headers: auth(), payload: { shipmentIds: [shipment.id] } })).json()).toEqual({ recorded: 0, alreadyHandedOver: 1, shipped: 0 });
      expect((await testPrisma.shipment.findUniqueOrThrow({ where: { id: shipment.id } })).handoverReference).toBe('MANIFEST-7');
      expect(await testPrisma.inventoryTransaction.count({ where: { skuId: a.id, type: 'SALE' } })).toBe(1);
      expect(await balance()).toEqual({ onHand: before.onHand - 2, reserved: before.reserved - 2 });
      expect((await app.inject({ method: 'GET', url: '/api/v1/shipments/handover', headers: auth() })).json().shipments).toEqual([]);
      expect((await app.inject({ method: 'GET', url: '/api/v1/shipments/handover', headers: auth(owner.token) })).statusCode).toBe(403);
    });

    it('the carrier\'s first movement event records the handover when staff have not', async () => {
      const { f } = await readyPackage('8901000000097');
      await book(f.id);
      const shipment = await testPrisma.shipment.findUniqueOrThrow({ where: { fulfilmentId: f.id } });
      const poll = vi.spyOn(MockCarrierProvider.prototype, 'trackShipment').mockResolvedValue({
        providerShipmentRef: shipment.providerShipmentRef!,
        rawStatus: 'in_transit',
        normalizedStatus: 'IN_TRANSIT',
        occurredAt: new Date('2026-10-05T10:00:00Z'),
      });
      expect((await app.inject({ method: 'POST', url: '/api/v1/shipments/poll', headers: auth() })).statusCode).toBe(200);
      poll.mockRestore();
      const after = await testPrisma.shipment.findUniqueOrThrow({ where: { id: shipment.id } });
      expect(after).toMatchObject({ status: 'IN_TRANSIT', handoverSource: 'CARRIER_EVENT', handedOverByStaffId: null });
      expect(after.handedOverAt?.toISOString()).toBe('2026-10-05T10:00:00.000Z');
      // The carrier's movement is the handover: it posts the sale and ships the package, as SYSTEM.
      expect((await testPrisma.orderFulfilment.findUniqueOrThrow({ where: { id: f.id } })).status).toBe('SHIPPED');
      const line = await testPrisma.orderLine.findFirstOrThrow({ where: { fulfilmentId: f.id } });
      expect(await testPrisma.inventoryTransaction.count({ where: { type: 'SALE', referenceId: line.id } })).toBe(1);
      expect(await testPrisma.auditLog.findFirstOrThrow({ where: { action: 'order.fulfilment.ship', entityId: f.id } })).toMatchObject({ actorType: 'SYSTEM', actorStaffId: null });
      // A later staff confirmation records nothing more.
      expect((await app.inject({ method: 'POST', url: '/api/v1/shipments/handover', headers: auth(), payload: { shipmentIds: [shipment.id] } })).json()).toEqual({ recorded: 0, alreadyHandedOver: 1, shipped: 0 });
      expect(await testPrisma.inventoryTransaction.count({ where: { type: 'SALE', referenceId: line.id } })).toBe(1);
    });

    it('packing slip and label data: items, barcodes, addresses, COD amount and parcel', async () => {
      const { a, o, f } = await readyPackage('8901000000103');
      const docs = (await app.inject({ method: 'GET', url: `/api/v1/orders/fulfilments/${f.id}/documents`, headers: auth() })).json();
      expect(docs).toMatchObject({
        reference: o.orderNumber,
        shipTo: { name: 'Asha Rao', mobile: '9876543210', line1: '7 Park Street', pincode: PINCODE },
        shipFrom: { name: 'Dispatch Test Pvt Ltd', line1: '12 Godown Lane', pincode: '110020' },
        paymentMethod: 'COD',
        parcel: { weightGrams: 640, lengthCm: 30, widthCm: 22, heightCm: 5 },
        lines: [{ skuCode: a.skuCode, barcode: a.barcode, quantity: 2, name: 'Oxford Shirt', colour: 'White' }],
        shipment: null,
      });
      expect(docs.cashToCollect).toBeGreaterThan(0);
      expect((await app.inject({ method: 'GET', url: `/api/v1/orders/fulfilments/${f.id}/documents`, headers: auth(owner.token) })).statusCode).toBe(200);
      const outsider = await createAuthenticatedStaff(app, ['MARKETING']);
      expect((await app.inject({ method: 'GET', url: `/api/v1/orders/fulfilments/${f.id}/documents`, headers: auth(outsider.token) })).statusCode).toBe(403);
    });

    it('the admin shows "booked, awaiting collection" until the handover, then "handed over"; the filters split them', async () => {
      const { o, f } = await readyPackage('8901000000127');
      expect((await book(f.id)).statusCode).toBe(201);
      const list = async (status: string) =>
        (await app.inject({ method: 'GET', url: `/api/v1/admin/fulfilments?status=${status}`, headers: auth() })).json().items as Array<{ id: string; dispatchStage: string }>;
      expect(await list('BOOKED_AWAITING_COLLECTION')).toEqual([expect.objectContaining({ id: f.id, dispatchStage: 'BOOKED_AWAITING_COLLECTION' })]);
      expect(await list('HANDED_OVER')).toEqual([]);
      const orderView = async () => (await app.inject({ method: 'GET', url: `/api/v1/orders/${o.id}`, headers: auth() })).json().fulfilments[0];
      expect((await orderView()).dispatchStage).toBe('BOOKED_AWAITING_COLLECTION');

      const shipment = await testPrisma.shipment.findUniqueOrThrow({ where: { fulfilmentId: f.id } });
      await app.inject({ method: 'POST', url: '/api/v1/shipments/handover', headers: auth(), payload: { shipmentIds: [shipment.id] } });
      expect(await list('BOOKED_AWAITING_COLLECTION')).toEqual([]);
      expect(await list('HANDED_OVER')).toEqual([expect.objectContaining({ id: f.id, dispatchStage: 'HANDED_OVER' })]);
      expect(await orderView()).toMatchObject({ status: 'SHIPPED', dispatchStage: 'HANDED_OVER' });
      expect((await orderView()).shipment.handedOverAt).not.toBeNull();
    });

    it('two people confirming the same parcel at once record one handover, in one name', async () => {
      const { f } = await readyPackage('8901000000134');
      await book(f.id);
      const shipment = await testPrisma.shipment.findUniqueOrThrow({ where: { fulfilmentId: f.id } });
      const second = await createAuthenticatedStaff(app, ['WAREHOUSE_MANAGER']);
      const results = await Promise.all(
        [staff.token, second.token].map((t) => app.inject({ method: 'POST', url: '/api/v1/shipments/handover', headers: auth(t), payload: { shipmentIds: [shipment.id] } })),
      );
      const bodies = results.map((r) => r.json() as { recorded: number; alreadyHandedOver: number });
      expect(bodies.map((b) => b.recorded).sort()).toEqual([0, 1]);
      const audits = await testPrisma.auditLog.findMany({ where: { action: 'shipping.handover', entityId: shipment.id } });
      expect(audits).toHaveLength(1);
      expect(audits[0]!.actorStaffId).toBe((await testPrisma.shipment.findUniqueOrThrow({ where: { id: shipment.id } })).handedOverByStaffId);
    });

    it('the handover list says how many parcels are waiting in all', async () => {
      const { f } = await readyPackage('8901000000141');
      await book(f.id);
      const res = (await app.inject({ method: 'GET', url: '/api/v1/shipments/handover', headers: auth() })).json();
      expect(res).toMatchObject({ total: 1, limit: 500 });
      expect(res.shipments).toHaveLength(1);
    });

    it('the "shipped" message is sent after the handover commits - never at booking, never for a handover that rolled back', async () => {
      const { o, f } = await readyPackage('8901000000158');
      const customer = await testPrisma.customer.create({ data: { mobile: `98${String(10_000_000 + counter).slice(0, 8)}`, fullName: 'Asha Rao' } });
      await testPrisma.order.update({ where: { id: o.id }, data: { customerId: customer.id, guestSessionId: null } });

      expect((await book(f.id)).statusCode).toBe(201);
      // Booked only: the customer is not told it has shipped.
      expect(await testPrisma.notificationDelivery.count({ where: { event: 'ORDER_SHIPPED' } })).toBe(0);
      const shipment = await testPrisma.shipment.findUniqueOrThrow({ where: { fulfilmentId: f.id } });

      // The handover's own transaction fails after the package was marked shipped inside it.
      const original = OrderService.prototype.markFulfilmentShipped;
      const spy = vi.spyOn(OrderService.prototype, 'markFulfilmentShipped').mockImplementationOnce(async function (this: OrderService, ...args: Parameters<OrderService['markFulfilmentShipped']>) {
        await original.apply(this, args);
        throw new Error('simulated failure before the handover commits');
      });
      const failed = await app.inject({ method: 'POST', url: '/api/v1/shipments/handover', headers: auth(), payload: { shipmentIds: [shipment.id] } });
      expect(failed.statusCode).toBe(500);
      spy.mockRestore();
      expect((await testPrisma.orderFulfilment.findUniqueOrThrow({ where: { id: f.id } })).status).toBe('BOOKED');
      expect((await testPrisma.shipment.findUniqueOrThrow({ where: { id: shipment.id } })).handedOverAt).toBeNull();
      expect(await testPrisma.inventoryTransaction.count({ where: { type: 'SALE', referenceId: o.lines[0]!.id } })).toBe(0);
      expect(await testPrisma.notificationDelivery.count({ where: { event: 'ORDER_SHIPPED' } })).toBe(0);

      // The retry hands it over, and the message goes out once.
      expect((await app.inject({ method: 'POST', url: '/api/v1/shipments/handover', headers: auth(), payload: { shipmentIds: [shipment.id] } })).json()).toMatchObject({ recorded: 1, shipped: 1 });
      const sent = await testPrisma.notificationDelivery.findMany({ where: { event: 'ORDER_SHIPPED' } });
      expect(sent.length).toBeGreaterThan(0);
      expect(sent.every((d) => d.referenceId === f.id && d.customerId === customer.id)).toBe(true);
      expect(sent.some((d) => d.status === 'SENT')).toBe(true);
      // A carrier movement event afterwards sends nothing more.
      const poll = vi.spyOn(MockCarrierProvider.prototype, 'trackShipment').mockResolvedValue({
        providerShipmentRef: shipment.providerShipmentRef!, rawStatus: 'in_transit', normalizedStatus: 'IN_TRANSIT', occurredAt: new Date(),
      });
      expect((await app.inject({ method: 'POST', url: '/api/v1/shipments/poll', headers: auth() })).statusCode).toBe(200);
      poll.mockRestore();
      expect((await testPrisma.shipment.findUniqueOrThrow({ where: { id: shipment.id } })).status).toBe('IN_TRANSIT');
      expect(await testPrisma.notificationDelivery.count({ where: { event: 'ORDER_SHIPPED' } })).toBe(sent.length);
    });

    it('refuses to hand over a parcel that is not booked', async () => {
      const { f } = await readyPackage('8901000000110');
      const intent = await testPrisma.shipment.create({ data: { fulfilmentId: f.id, orderId: (await testPrisma.orderFulfilment.findUniqueOrThrow({ where: { id: f.id } })).orderId, provider: 'MOCK', status: 'CREATED', maxDeliveryAttempts: 2, idempotencyKey: `intent-${f.id}` } });
      const res = await app.inject({ method: 'POST', url: '/api/v1/shipments/handover', headers: auth(), payload: { shipmentIds: [intent.id] } });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.message).toMatch(/not booked/);
    });
  });
  /**
   * AO-D5 option B (Product Owner, 2026-10-06): "At courier handover, post
   * the stock sale, mark shipped and send the customer message. Cover
   * cancellation before handover, duplicate events, split shipments,
   * booking failures and existing shipments without double-posting stock."
   */
  describe('AO-D5 option B: the handover posts the sale', () => {
    let cs: { staffUserId: string; token: string };
    beforeEach(async () => {
      await grantPermissions('CUSTOMER_SERVICE', ['order:read', 'order:cancel', 'order:exception:manage']);
      cs = await createAuthenticatedStaff(app, ['CUSTOMER_SERVICE']);
    });

    async function readyFulfilment(orderId: string, lineIds: string[]) {
      const f = await fulfilment(orderId, lineIds);
      expect((await pack(f.id)).statusCode).toBe(200);
      expect((await app.inject({ method: 'POST', url: `/api/v1/orders/fulfilments/${f.id}/ready-to-ship`, headers: auth() })).statusCode).toBe(200);
      return f;
    }
    async function bookedPackage(quantity = 1) {
      const a = await sku(`89020${String(counter).padStart(4, '0')}${Math.floor(Math.random() * 9000 + 1000)}`);
      const o = await order([{ skuId: a.id, quantity }]);
      await pickAll(o.id);
      const f = await readyFulfilment(o.id, [o.lines[0]!.id]);
      const res = await app.inject({ method: 'POST', url: `/api/v1/orders/fulfilments/${f.id}/shipment`, headers: auth(), payload: { idempotencyKey: `book-${f.id}` } });
      expect(res.statusCode, res.body).toBe(201);
      const shipment = await testPrisma.shipment.findUniqueOrThrow({ where: { fulfilmentId: f.id } });
      return { a, o, f, shipment };
    }
    const handover = (shipmentIds: string[], t = staff.token) =>
      app.inject({ method: 'POST', url: '/api/v1/shipments/handover', headers: auth(t), payload: { shipmentIds } });
    const cancelBooking = (fulfilmentId: string, payload: Record<string, unknown> = {}) =>
      app.inject({
        method: 'POST',
        url: `/api/v1/orders/fulfilments/${fulfilmentId}/cancel-booking`,
        headers: auth(cs.token),
        payload: { reason: 'Customer called before collection', courierCancellationConfirmed: true, courierReference: 'CXL-1', idempotencyKey: `cxl-${fulfilmentId}`, ...payload },
      });
    const sales = (lineId: string) => testPrisma.inventoryTransaction.count({ where: { type: 'SALE', referenceId: lineId } });
    const balance = (skuId: string) => testPrisma.inventoryBalance.findFirstOrThrow({ where: { skuId }, select: { onHand: true, reserved: true } });
    function carrierWebhook(providerShipmentRef: string, status: string, id: string) {
      const body = JSON.stringify({ id, shipment_ref: providerShipmentRef, status, occurred_at: new Date().toISOString() });
      const signature = createHmac('sha256', 'mock-carrier-webhook-secret-test-only').update(body).digest('hex');
      return app.inject({ method: 'POST', url: '/api/v1/webhooks/shipping/mock', headers: { 'content-type': 'application/json', 'x-shipping-signature': signature }, payload: body });
    }

    it('a staff handover and the carrier\'s movement event at the same moment post one sale and one shipped transition', async () => {
      for (let i = 0; i < 3; i += 1) {
        const { o, f, shipment } = await bookedPackage();
        const [staffRes, carrierRes] = await Promise.all([handover([shipment.id]), carrierWebhook(shipment.providerShipmentRef!, 'in_transit', `evt-race-${f.id}`)]);
        expect(staffRes.statusCode, staffRes.body).toBe(200);
        expect(carrierRes.statusCode, carrierRes.body).toBe(200);
        expect(await sales(o.lines[0]!.id)).toBe(1);
        expect(await testPrisma.auditLog.count({ where: { action: 'order.fulfilment.ship', entityId: f.id } })).toBe(1);
        expect((await testPrisma.orderFulfilment.findUniqueOrThrow({ where: { id: f.id } })).status).toBe('SHIPPED');
        const s = await testPrisma.shipment.findUniqueOrThrow({ where: { id: shipment.id } });
        expect(s.status).toBe('IN_TRANSIT');
        expect(s.handedOverAt).not.toBeNull();
        // A redelivered carrier event is a no-op.
        expect((await carrierWebhook(shipment.providerShipmentRef!, 'in_transit', `evt-race-${f.id}`)).statusCode).toBe(200);
        expect(await sales(o.lines[0]!.id)).toBe(1);
      }
    });

    it('split shipment: each package posts its own sale at its own handover', async () => {
      const a = await sku('8902100000011');
      const b = await sku('8902100000028');
      const o = await order([{ skuId: a.id, quantity: 1 }, { skuId: b.id, quantity: 1 }]);
      await pickAll(o.id);
      const lineA = o.lines.find((l) => l.skuId === a.id)!;
      const lineB = o.lines.find((l) => l.skuId === b.id)!;
      const fa = await readyFulfilment(o.id, [lineA.id]);
      const fb = await readyFulfilment(o.id, [lineB.id]);
      for (const f of [fa, fb]) {
        expect((await app.inject({ method: 'POST', url: `/api/v1/orders/fulfilments/${f.id}/shipment`, headers: auth(), payload: { idempotencyKey: `book-${f.id}` } })).statusCode).toBe(201);
      }
      const sa = await testPrisma.shipment.findUniqueOrThrow({ where: { fulfilmentId: fa.id } });
      const sb = await testPrisma.shipment.findUniqueOrThrow({ where: { fulfilmentId: fb.id } });

      expect((await handover([sa.id])).json()).toMatchObject({ recorded: 1, shipped: 1 });
      expect(await sales(lineA.id)).toBe(1);
      expect(await sales(lineB.id)).toBe(0);
      expect((await testPrisma.orderFulfilment.findUniqueOrThrow({ where: { id: fb.id } })).status).toBe('BOOKED');
      expect((await testPrisma.order.findUniqueOrThrow({ where: { id: o.id } })).status).toBe('PROCESSING');

      expect((await carrierWebhook(sb.providerShipmentRef!, 'in_transit', `evt-split-${fb.id}`)).statusCode).toBe(200);
      expect(await sales(lineB.id)).toBe(1);
      expect(await sales(lineA.id)).toBe(1);
      expect((await testPrisma.orderFulfilment.findUniqueOrThrow({ where: { id: fb.id } })).status).toBe('SHIPPED');
    });

    it('a failed courier booking leaves the package ready to ship, with no sale and nothing to hand over', async () => {
      const a = await sku('8902200000010');
      const o = await order([{ skuId: a.id, quantity: 1 }]);
      await pickAll(o.id);
      const f = await readyFulfilment(o.id, [o.lines[0]!.id]);
      const before = await balance(a.id);
      const carrier = vi.spyOn(MockCarrierProvider.prototype, 'initiateShipment').mockRejectedValueOnce(new Error('courier unavailable'));
      const res = await app.inject({ method: 'POST', url: `/api/v1/orders/fulfilments/${f.id}/shipment`, headers: auth(), payload: { idempotencyKey: `book-${f.id}` } });
      carrier.mockRestore();
      expect(res.statusCode).toBeGreaterThanOrEqual(400);
      expect((await testPrisma.orderFulfilment.findUniqueOrThrow({ where: { id: f.id } })).status).toBe('READY_TO_SHIP');
      expect(await sales(o.lines[0]!.id)).toBe(0);
      expect(await balance(a.id)).toEqual(before);
      expect((await app.inject({ method: 'GET', url: '/api/v1/shipments/handover', headers: auth() })).json().shipments).toEqual([]);
      const intent = await testPrisma.shipment.findUnique({ where: { fulfilmentId: f.id } });
      if (intent) {
        expect(intent.status).toBe('CREATED');
        expect((await handover([intent.id])).statusCode).toBe(400);
      }
      // The retry books it; still no sale until the handover.
      const retry = await app.inject({ method: 'POST', url: `/api/v1/orders/fulfilments/${f.id}/shipment`, headers: auth(), payload: { idempotencyKey: `book-${f.id}` } });
      expect(retry.statusCode, retry.body).toBe(201);
      expect((await testPrisma.orderFulfilment.findUniqueOrThrow({ where: { id: f.id } })).status).toBe('BOOKED');
      expect(await sales(o.lines[0]!.id)).toBe(0);
    });

    it('a package shipped before option B (sale posted at booking) only gets its handover recorded - no second sale or message', async () => {
      const { o, f, shipment } = await bookedPackage();
      // Recreate the old state: the sale was posted and the package SHIPPED at booking, no handover yet.
      await new OrderService(app).markFulfilmentShipped(f.id, staff.staffUserId, undefined, undefined, 'BOOKED');
      await testPrisma.shipment.update({ where: { id: shipment.id }, data: { handedOverAt: null, handoverSource: null } });
      expect(await sales(o.lines[0]!.id)).toBe(1);
      const list = (await app.inject({ method: 'GET', url: '/api/v1/admin/fulfilments?status=BOOKED_AWAITING_COLLECTION', headers: auth() })).json().items;
      expect(list).toEqual([expect.objectContaining({ id: f.id, status: 'SHIPPED', dispatchStage: 'BOOKED_AWAITING_COLLECTION' })]);
      const shippedNotices = await testPrisma.notificationDelivery.count({ where: { event: 'ORDER_SHIPPED' } });

      expect((await handover([shipment.id])).json()).toEqual({ recorded: 1, alreadyHandedOver: 0, shipped: 0 });
      expect(await sales(o.lines[0]!.id)).toBe(1);
      expect((await carrierWebhook(shipment.providerShipmentRef!, 'in_transit', `evt-legacy-${f.id}`)).statusCode).toBe(200);
      expect(await sales(o.lines[0]!.id)).toBe(1);
      expect(await testPrisma.auditLog.count({ where: { action: 'order.fulfilment.ship', entityId: f.id } })).toBe(1);
      expect(await testPrisma.notificationDelivery.count({ where: { event: 'ORDER_SHIPPED' } })).toBe(shippedNotices);
    });

    it('cancelling a booked package: line cancels are refused while booked; the package cancel releases the stock and closes the booking', async () => {
      const { a, o, f, shipment } = await bookedPackage(2);
      const line = o.lines[0]!;
      const before = await balance(a.id);

      // Staff and shopper line cancellations are refused while the courier has a booking.
      const staffCancel = await app.inject({ method: 'POST', url: `/api/v1/orders/${o.id}/lines/${line.id}/cancel`, headers: auth(cs.token), payload: { idempotencyKey: `line-${line.id}` } });
      expect(staffCancel.statusCode).toBe(400);
      expect(staffCancel.json().error.message).toMatch(/Cancel the courier booking, then cancel the whole package/);
      const shopperCancel = await app.inject({ method: 'POST', url: `/api/v1/storefront/orders/${o.id}/lines/${line.id}/cancel`, headers: o.shopperHeaders, payload: { idempotencyKey: `shopper-${line.id}` } });
      expect(shopperCancel.statusCode).toBe(400);
      expect(shopperCancel.json().error.message).toMatch(/booked with the courier/);
      // ...and so is an exception, whose resolution could otherwise release the stock.
      const exception = await app.inject({ method: 'POST', url: `/api/v1/orders/${o.id}/lines/${line.id}/exception`, headers: auth(cs.token), payload: { reason: 'damaged' } });
      expect(exception.statusCode).toBe(400);
      expect(exception.json().error.message).toMatch(/Cancel the courier booking/);
      expect((await testPrisma.orderLine.findUniqueOrThrow({ where: { id: line.id } })).status).toBe('PACKED');

      // The package cancel needs the courier cancellation confirmed, a reason, and permission.
      expect((await cancelBooking(f.id, { courierCancellationConfirmed: false })).statusCode).toBe(400);
      expect((await cancelBooking(f.id, { reason: '  ' })).statusCode).toBe(400);
      expect((await app.inject({ method: 'POST', url: `/api/v1/orders/fulfilments/${f.id}/cancel-booking`, headers: auth(), payload: { reason: 'x', courierCancellationConfirmed: true, idempotencyKey: 'k' } })).statusCode).toBe(403);

      const cancelled = await cancelBooking(f.id);
      expect(cancelled.statusCode, cancelled.body).toBe(200);
      expect(cancelled.json()).toMatchObject({ status: 'CANCELLED', shipment: { status: 'CANCELLED', bookingCancellationReference: 'CXL-1', bookingCancelledByStaffId: cs.staffUserId } });
      expect(await testPrisma.orderLine.findUniqueOrThrow({ where: { id: line.id } })).toMatchObject({ status: 'CANCELLED', fulfilmentId: null, cancelledReason: 'Customer called before collection' });
      expect((await testPrisma.order.findUniqueOrThrow({ where: { id: o.id } })).status).toBe('CANCELLED');
      expect(await sales(line.id)).toBe(0);
      expect(await balance(a.id)).toEqual({ onHand: before.onHand, reserved: before.reserved - 2 });
      expect(await testPrisma.auditLog.count({ where: { action: 'order.fulfilment.booking_cancel', entityId: f.id } })).toBe(1);

      // Retrying is a no-op; the cancelled parcel cannot be handed over; carrier events for it are refused.
      expect((await cancelBooking(f.id)).json()).toMatchObject({ status: 'CANCELLED' });
      expect(await balance(a.id)).toEqual({ onHand: before.onHand, reserved: before.reserved - 2 });
      const refusedHandover = await handover([shipment.id]);
      expect(refusedHandover.statusCode).toBe(400);
      expect(refusedHandover.json().error.message).toMatch(/cancelled/);
      expect((await app.inject({ method: 'GET', url: '/api/v1/shipments/handover', headers: auth() })).json().shipments).toEqual([]);
      expect((await carrierWebhook(shipment.providerShipmentRef!, 'in_transit', `evt-after-cxl-${f.id}`)).statusCode).toBe(400);
      expect(await sales(line.id)).toBe(0);
      expect((await testPrisma.shipment.findUniqueOrThrow({ where: { id: shipment.id } })).status).toBe('CANCELLED');
      expect((await app.inject({ method: 'GET', url: '/api/v1/admin/fulfilments?status=CANCELLED', headers: auth() })).json().items).toEqual([expect.objectContaining({ id: f.id, dispatchStage: 'CANCELLED' })]);
    });

    it('a package that has been handed over cannot be cancelled as a booking', async () => {
      const { f, shipment } = await bookedPackage();
      expect((await handover([shipment.id])).statusCode).toBe(200);
      const res = await cancelBooking(f.id);
      expect(res.statusCode).toBe(400);
      expect(res.json().error.message).toMatch(/use a return instead/);
    });

    it('a handover racing a booking cancellation: exactly one wins, and stock stays consistent either way', async () => {
      const outcomes: string[] = [];
      for (let i = 0; i < 4; i += 1) {
        const { a, o, f, shipment } = await bookedPackage();
        const before = await balance(a.id);
        const [h, c] = await Promise.all([handover([shipment.id]), cancelBooking(f.id)]);
        const pkg = await testPrisma.orderFulfilment.findUniqueOrThrow({ where: { id: f.id } });
        const after = await balance(a.id);
        if (pkg.status === 'SHIPPED') {
          outcomes.push('handover');
          expect(h.statusCode, h.body).toBe(200);
          expect(c.statusCode).toBe(400);
          expect(await sales(o.lines[0]!.id)).toBe(1);
          expect(after).toEqual({ onHand: before.onHand - 1, reserved: before.reserved - 1 });
          expect((await testPrisma.orderLine.findUniqueOrThrow({ where: { id: o.lines[0]!.id } })).status).toBe('SHIPPED');
        } else {
          outcomes.push('cancel');
          expect(pkg.status).toBe('CANCELLED');
          expect(c.statusCode, c.body).toBe(200);
          expect(h.statusCode).toBe(400);
          expect(await sales(o.lines[0]!.id)).toBe(0);
          expect(after).toEqual({ onHand: before.onHand, reserved: before.reserved - 1 });
          expect((await testPrisma.orderLine.findUniqueOrThrow({ where: { id: o.lines[0]!.id } })).status).toBe('CANCELLED');
        }
      }
      expect(outcomes).toHaveLength(4);
    });

    // --- Cancel booking and rebook (Product Owner, 2026-10-06): a courier-booking mistake keeps the order and its reserved stock ---

    const rebook = (fulfilmentId: string, payload: Record<string, unknown> = {}, t = staff.token) =>
      app.inject({
        method: 'POST',
        url: `/api/v1/orders/fulfilments/${fulfilmentId}/cancel-booking-rebook`,
        headers: auth(t),
        payload: { reason: 'Booked with the wrong parcel size', courierCancellationConfirmed: true, courierReference: 'CXL-RB1', idempotencyKey: `rbk-${fulfilmentId}`, ...payload },
      });
    const reservation = (lineId: string) =>
      testPrisma.orderLine.findUniqueOrThrow({ where: { id: lineId }, select: { reservationId: true } }).then((l) => testPrisma.inventoryReservation.findUniqueOrThrow({ where: { id: l.reservationId! } }));

    it('cancel booking and rebook: the order and its reserved stock are kept, the items wait for a new package, and only the new handover posts the sale', async () => {
      const { a, o, f, shipment } = await bookedPackage(2);
      const line = o.lines[0]!;
      const before = await balance(a.id);
      const reservedBefore = await reservation(line.id);

      // Not without the courier cancellation confirmed, a reason, or the booking permission.
      expect((await rebook(f.id, { courierCancellationConfirmed: false })).statusCode).toBe(400);
      expect((await rebook(f.id, { reason: '  ' })).statusCode).toBe(400);
      expect((await rebook(f.id, {}, cs.token)).statusCode).toBe(403);
      expect((await testPrisma.orderFulfilment.findUniqueOrThrow({ where: { id: f.id } })).status).toBe('BOOKED');

      const released = await rebook(f.id);
      expect(released.statusCode, released.body).toBe(200);
      expect(released.json()).toMatchObject({
        id: f.id,
        status: 'CANCELLED',
        releasedForRebook: true,
        shipment: { id: shipment.id, status: 'CANCELLED', bookingCancellationReference: 'CXL-RB1', bookingCancelledByStaffId: staff.staffUserId },
      });
      // The item is back to picked with no package; the order, the line, the reservation and the pick stand.
      expect(await testPrisma.orderLine.findUniqueOrThrow({ where: { id: line.id } })).toMatchObject({ status: 'PICKED', fulfilmentId: null, cancelledAt: null });
      expect((await testPrisma.order.findUniqueOrThrow({ where: { id: o.id } })).status).toBe('PROCESSING');
      expect(await balance(a.id)).toEqual(before);
      expect(await reservation(line.id)).toMatchObject({ status: reservedBefore.status, quantity: reservedBefore.quantity });
      expect((await testPrisma.pickTask.findFirstOrThrow({ where: { orderLineId: line.id } })).status).toBe('PICKED');
      expect(await sales(line.id)).toBe(0);
      expect(await testPrisma.auditLog.count({ where: { action: 'order.fulfilment.booking_release', entityId: f.id } })).toBe(1);
      expect(await testPrisma.auditLog.count({ where: { action: 'order.fulfilment.booking_cancel', entityId: f.id } })).toBe(0);
      expect(await testPrisma.auditLog.count({ where: { action: 'order.line.cancel', entityId: line.id } })).toBe(0);
      expect(await testPrisma.notificationDelivery.count()).toBe(0);

      // A retry with the same key returns the same package and changes nothing.
      const retry = await rebook(f.id);
      expect(retry.statusCode).toBe(200);
      expect(retry.json().id).toBe(f.id);
      expect(await testPrisma.auditLog.count({ where: { action: 'order.fulfilment.booking_release', entityId: f.id } })).toBe(1);
      // A different key on the same package, and the whole-package cancel, are refused rather than taken as done.
      expect((await rebook(f.id, { idempotencyKey: `rbk-other-${f.id}` })).statusCode).toBe(409);
      const whole = await cancelBooking(f.id);
      expect(whole.statusCode).toBe(409);
      expect(whole.json().error.message).toMatch(/kept for rebooking/);
      expect((await testPrisma.orderLine.findUniqueOrThrow({ where: { id: line.id } })).status).toBe('PICKED');

      // The cancelled parcel cannot be handed over and the carrier's events for it are refused.
      expect((await handover([shipment.id])).statusCode).toBe(400);
      expect((await carrierWebhook(shipment.providerShipmentRef!, 'in_transit', `evt-rbk-old-${f.id}`)).statusCode).toBe(400);
      expect((await app.inject({ method: 'GET', url: '/api/v1/shipments/handover', headers: auth() })).json().shipments).toEqual([]);
      expect(await sales(line.id)).toBe(0);

      // Pack & ship shows the item waiting for a package and the old package as released for rebooking.
      const cancelledList = (await app.inject({ method: 'GET', url: '/api/v1/admin/fulfilments?status=CANCELLED', headers: auth() })).json().items;
      expect(cancelledList).toEqual([expect.objectContaining({ id: f.id, releasedForRebook: true, dispatchStage: 'CANCELLED' })]);
      const orderView = (await app.inject({ method: 'GET', url: `/api/v1/orders/${o.id}`, headers: auth() })).json();
      expect(orderView.fulfilments).toEqual([expect.objectContaining({ id: f.id, status: 'CANCELLED', releasedForRebook: true })]);
      expect(orderView.lines[0]).toMatchObject({ status: 'PICKED', fulfilmentId: null });
      // The shopper sees no "cancelled" shipment for an internal booking correction, and the item still on order.
      const shopperView = (await app.inject({ method: 'GET', url: `/api/v1/storefront/orders/${o.id}`, headers: o.shopperHeaders })).json();
      expect(shopperView.fulfilments).toEqual([]);
      expect(shopperView).toMatchObject({ status: 'PROCESSING', lines: [expect.objectContaining({ status: 'PICKED' })] });

      // A new package: packed, ready, booked, handed over - one sale, stock leaves once.
      const second = await readyFulfilment(o.id, [line.id]);
      expect(second.id).not.toBe(f.id);
      const booking = await app.inject({ method: 'POST', url: `/api/v1/orders/fulfilments/${second.id}/shipment`, headers: auth(), payload: { idempotencyKey: `book-${second.id}` } });
      expect(booking.statusCode, booking.body).toBe(201);
      expect(booking.json().id).not.toBe(shipment.id);
      expect(await balance(a.id)).toEqual(before);
      expect((await handover([booking.json().id])).json()).toMatchObject({ recorded: 1, shipped: 1 });
      expect(await sales(line.id)).toBe(1);
      expect(await balance(a.id)).toEqual({ onHand: before.onHand - 2, reserved: before.reserved - 2 });
      expect(await testPrisma.orderLine.findUniqueOrThrow({ where: { id: line.id } })).toMatchObject({ status: 'SHIPPED', fulfilmentId: second.id });

      // Once collected, the new booking can no longer be cancelled either way.
      const late = await rebook(second.id);
      expect(late.statusCode).toBe(400);
      expect(late.json().error.message).toMatch(/already collected/);
      // The first key cannot be reused for the new package.
      expect((await rebook(second.id, { idempotencyKey: `rbk-${f.id}` })).statusCode).toBe(409);
    });

    it('cancel booking and rebook is refused for a package that is not booked or already handed over', async () => {
      const a = await sku('8902300000019');
      const o = await order([{ skuId: a.id, quantity: 1 }]);
      await pickAll(o.id);
      const f = await readyFulfilment(o.id, [o.lines[0]!.id]);
      const notBooked = await rebook(f.id);
      expect(notBooked.statusCode).toBe(400);
      expect(notBooked.json().error.message).toMatch(/ready to ship now/);

      const { f: handed, shipment } = await bookedPackage();
      expect((await handover([shipment.id])).statusCode).toBe(200);
      const late = await rebook(handed.id);
      expect(late.statusCode).toBe(400);
      expect(late.json().error.message).toMatch(/use a return instead/);

      const missing = await rebook('00000000-0000-4000-8000-000000000000');
      expect(missing.statusCode).toBe(404);
    });

    it('split shipment: cancelling one package\'s booking for rebooking leaves the other package and its line alone', async () => {
      const a = await sku('8902400000018');
      const b = await sku('8902400000025');
      const o = await order([{ skuId: a.id, quantity: 1 }, { skuId: b.id, quantity: 1 }]);
      await pickAll(o.id);
      const lineA = o.lines.find((l) => l.skuId === a.id)!;
      const lineB = o.lines.find((l) => l.skuId === b.id)!;
      const fa = await readyFulfilment(o.id, [lineA.id]);
      const fb = await readyFulfilment(o.id, [lineB.id]);
      for (const f of [fa, fb]) {
        expect((await app.inject({ method: 'POST', url: `/api/v1/orders/fulfilments/${f.id}/shipment`, headers: auth(), payload: { idempotencyKey: `book-${f.id}` } })).statusCode).toBe(201);
      }
      const sb = await testPrisma.shipment.findUniqueOrThrow({ where: { fulfilmentId: fb.id } });

      expect((await rebook(fa.id)).statusCode).toBe(200);
      expect(await testPrisma.orderLine.findUniqueOrThrow({ where: { id: lineA.id } })).toMatchObject({ status: 'PICKED', fulfilmentId: null });
      expect(await testPrisma.orderLine.findUniqueOrThrow({ where: { id: lineB.id } })).toMatchObject({ status: 'PACKED', fulfilmentId: fb.id });
      expect((await testPrisma.orderFulfilment.findUniqueOrThrow({ where: { id: fb.id } })).status).toBe('BOOKED');
      expect((await testPrisma.shipment.findUniqueOrThrow({ where: { id: sb.id } })).status).toBe('BOOKED');

      expect((await handover([sb.id])).json()).toMatchObject({ recorded: 1, shipped: 1 });
      expect(await sales(lineB.id)).toBe(1);
      expect(await sales(lineA.id)).toBe(0);
      expect((await testPrisma.order.findUniqueOrThrow({ where: { id: o.id } })).status).toBe('PROCESSING');
    });

    it('a handover racing a cancel-and-rebook: exactly one wins, and stock stays consistent either way', async () => {
      const outcomes: string[] = [];
      for (let i = 0; i < 4; i += 1) {
        const { a, o, f, shipment } = await bookedPackage();
        const line = o.lines[0]!;
        const before = await balance(a.id);
        const [h, r] = await Promise.all([handover([shipment.id]), rebook(f.id)]);
        const pkg = await testPrisma.orderFulfilment.findUniqueOrThrow({ where: { id: f.id } });
        const after = await balance(a.id);
        if (pkg.status === 'SHIPPED') {
          outcomes.push('handover');
          expect(h.statusCode, h.body).toBe(200);
          expect(r.statusCode).toBe(400);
          expect(await sales(line.id)).toBe(1);
          expect(after).toEqual({ onHand: before.onHand - 1, reserved: before.reserved - 1 });
          expect(await testPrisma.orderLine.findUniqueOrThrow({ where: { id: line.id } })).toMatchObject({ status: 'SHIPPED', fulfilmentId: f.id });
        } else {
          outcomes.push('rebook');
          expect(pkg).toMatchObject({ status: 'CANCELLED', releasedForRebook: true });
          expect(r.statusCode, r.body).toBe(200);
          expect(h.statusCode).toBe(400);
          expect(await sales(line.id)).toBe(0);
          expect(after).toEqual(before);
          expect(await testPrisma.orderLine.findUniqueOrThrow({ where: { id: line.id } })).toMatchObject({ status: 'PICKED', fulfilmentId: null });
        }
      }
      expect(outcomes).toHaveLength(4);
    });

    it('a carrier movement event racing a cancel-and-rebook: exactly one wins', async () => {
      for (let i = 0; i < 3; i += 1) {
        const { a, o, f, shipment } = await bookedPackage();
        const before = await balance(a.id);
        const [w, r] = await Promise.all([carrierWebhook(shipment.providerShipmentRef!, 'in_transit', `evt-rbk-race-${f.id}`), rebook(f.id)]);
        const pkg = await testPrisma.orderFulfilment.findUniqueOrThrow({ where: { id: f.id } });
        if (pkg.status === 'SHIPPED') {
          expect(r.statusCode).toBe(400);
          expect(await sales(o.lines[0]!.id)).toBe(1);
          expect(await balance(a.id)).toEqual({ onHand: before.onHand - 1, reserved: before.reserved - 1 });
        } else {
          expect(r.statusCode, r.body).toBe(200);
          expect(w.statusCode).toBe(400);
          expect(await sales(o.lines[0]!.id)).toBe(0);
          expect(await balance(a.id)).toEqual(before);
        }
      }
    });

    it('after a cancel-and-rebook the items can still be cancelled on their own, and a line cancel racing the release stays consistent', async () => {
      // Cancelling an item after its booking was released releases its stock as usual.
      const first = await bookedPackage();
      expect((await rebook(first.f.id)).statusCode).toBe(200);
      const before = await balance(first.a.id);
      const line = first.o.lines[0]!;
      const cancel = await app.inject({ method: 'POST', url: `/api/v1/orders/${first.o.id}/lines/${line.id}/cancel`, headers: auth(cs.token), payload: { idempotencyKey: `line-${line.id}` } });
      expect(cancel.statusCode, cancel.body).toBe(200);
      expect((await testPrisma.orderLine.findUniqueOrThrow({ where: { id: line.id } })).status).toBe('CANCELLED');
      expect(await balance(first.a.id)).toEqual({ onHand: before.onHand, reserved: before.reserved - 1 });

      // A line cancel sent at the same moment as the release: either the line is cancelled after
      // the release (stock released) or refused while still booked (stock kept for the rebooking).
      for (let i = 0; i < 4; i += 1) {
        const { a, o, f } = await bookedPackage();
        const l = o.lines[0]!;
        const start = await balance(a.id);
        const [r, c] = await Promise.all([
          rebook(f.id),
          app.inject({ method: 'POST', url: `/api/v1/orders/${o.id}/lines/${l.id}/cancel`, headers: auth(cs.token), payload: { idempotencyKey: `line-race-${l.id}` } }),
        ]);
        expect(r.statusCode, r.body).toBe(200);
        const row = await testPrisma.orderLine.findUniqueOrThrow({ where: { id: l.id } });
        expect(row.fulfilmentId).toBeNull();
        if (row.status === 'CANCELLED') {
          expect(c.statusCode, c.body).toBe(200);
          expect(await balance(a.id)).toEqual({ onHand: start.onHand, reserved: start.reserved - 1 });
        } else {
          expect(row.status).toBe('PICKED');
          expect(c.statusCode).toBe(400);
          expect(await balance(a.id)).toEqual(start);
        }
        expect(await sales(l.id)).toBe(0);
      }
    });
  });
});
