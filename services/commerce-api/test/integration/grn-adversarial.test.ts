import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createTestApp } from '../helpers/app.js';
import { resetDatabase, seedRbac, seedBrandAndLocation, testPrisma } from '../helpers/db.js';
import { GrnService } from '../../src/modules/grn/service.js';
import { ProcurementService } from '../../src/modules/procurement/service.js';
import { InventoryService } from '../../src/modules/inventory/service.js';

/**
 * Certification-pass expanded Procurement/GRN adversarial round (beyond
 * the pure-concurrency scenarios in grn-concurrency.test.ts): exact/excess
 * receipt boundaries, invalid PO state, and transaction atomicity - a GRN
 * must never exist half-applied.
 */
describe('Procurement/GRN adversarial certification', () => {
  let app: FastifyInstance;
  let skuId: string;
  let locationId: string;
  let supplierId: string;
  let actorStaffId: string;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDatabase();
    await seedRbac();
    const { brand, location, category, size } = await seedBrandAndLocation();
    const style = await testPrisma.style.create({
      data: { styleCode: 'GRNA-001', name: 'GRN Adversarial', brandId: brand.id, categoryId: category.id, season: 'SS26', collection: 'Core' },
    });
    const colour = await testPrisma.colour.create({ data: { styleId: style.id, name: 'Navy', colourCode: 'NVY' } });
    const sku = await testPrisma.sku.create({ data: { styleId: style.id, colourId: colour.id, sizeId: size.id, skuCode: 'GRNA-001-NVY-M' } });
    const supplier = await testPrisma.supplier.create({ data: { code: 'GRNA-SUP', name: 'GRN Adversarial Supplier', type: 'FINISHED_GOODS' } });
    const staff = await testPrisma.staffUser.create({ data: { email: `grna-${Date.now()}@example.com`, passwordHash: 'x', fullName: 'GRN Adversarial Staff' } });

    skuId = sku.id;
    locationId = location.id;
    supplierId = supplier.id;
    actorStaffId = staff.id;
  });

  async function createApprovedPo(orderedQty: number) {
    const procurement = new ProcurementService(app);
    const po = await procurement.createPurchaseOrder(
      { supplierId, locationId, lines: [{ skuId, orderedQty, unitCost: 250 }] },
      actorStaffId,
    );
    await procurement.submitPurchaseOrder(po.id, actorStaffId);
    const approver = await testPrisma.staffUser.create({
      data: { email: `grna-approver-${Date.now()}@example.com`, passwordHash: 'x', fullName: 'Approver' },
    });
    await procurement.approvePurchaseOrder(po.id, approver.id);
    return { poId: po.id, poLineId: po.lines[0]!.id };
  }

  it('accepts a receipt exactly equal to the remaining ordered quantity, no exception flagged', async () => {
    const grn = new GrnService(app);
    const { poId, poLineId } = await createApprovedPo(50);

    const result = await grn.createGoodsReceipt(
      { poId, locationId, lines: [{ poLineId, skuId, receivedQty: 50, acceptedQty: 50, damagedQty: 0, rejectedQty: 0 }] },
      actorStaffId,
    );

    expect(result.exceptions).toHaveLength(0);
    const po = await testPrisma.purchaseOrder.findUniqueOrThrow({ where: { id: poId } });
    expect(po.status).toBe('FULLY_RECEIVED');
  });

  it('flags an excess receipt above the (zero) tolerance as an exception without blocking it', async () => {
    const grn = new GrnService(app);
    const { poId, poLineId } = await createApprovedPo(50);

    const result = await grn.createGoodsReceipt(
      { poId, locationId, lines: [{ poLineId, skuId, receivedQty: 55, acceptedQty: 55, damagedQty: 0, rejectedQty: 0 }] },
      actorStaffId,
    );

    expect(result.exceptions).toHaveLength(1);
    expect(result.exceptions[0]!.excessQty).toBe(5);
    expect(result.exceptions[0]!.isExcessException).toBe(true);

    // Not silently accepted as ordinary - but also not blocked: the
    // inventory ledger still reflects what physically arrived.
    const inventory = new InventoryService(app);
    const balance = await inventory.getBalance(skuId, locationId);
    expect(balance.onHand).toBe(55);
  });

  it('flags a short receipt as an exception (shortQty > 0)', async () => {
    const grn = new GrnService(app);
    const { poId, poLineId } = await createApprovedPo(50);

    const result = await grn.createGoodsReceipt(
      { poId, locationId, lines: [{ poLineId, skuId, receivedQty: 30, acceptedQty: 30, damagedQty: 0, rejectedQty: 0 }] },
      actorStaffId,
    );

    expect(result.exceptions).toHaveLength(1);
    expect(result.exceptions[0]!.shortQty).toBe(20);
  });

  it('rejects recording a GRN against a DRAFT purchase order', async () => {
    const procurement = new ProcurementService(app);
    const grn = new GrnService(app);
    const po = await procurement.createPurchaseOrder(
      { supplierId, locationId, lines: [{ skuId, orderedQty: 10, unitCost: 100 }] },
      actorStaffId,
    );

    await expect(
      grn.createGoodsReceipt(
        { poId: po.id, locationId, lines: [{ poLineId: po.lines[0]!.id, skuId, receivedQty: 10, acceptedQty: 10, damagedQty: 0, rejectedQty: 0 }] },
        actorStaffId,
      ),
    ).rejects.toThrow(/status 'DRAFT'/i);
  });

  it('rejects recording a GRN against a SUBMITTED (not yet approved) purchase order', async () => {
    const procurement = new ProcurementService(app);
    const grn = new GrnService(app);
    const po = await procurement.createPurchaseOrder(
      { supplierId, locationId, lines: [{ skuId, orderedQty: 10, unitCost: 100 }] },
      actorStaffId,
    );
    await procurement.submitPurchaseOrder(po.id, actorStaffId);

    await expect(
      grn.createGoodsReceipt(
        { poId: po.id, locationId, lines: [{ poLineId: po.lines[0]!.id, skuId, receivedQty: 10, acceptedQty: 10, damagedQty: 0, rejectedQty: 0 }] },
        actorStaffId,
      ),
    ).rejects.toThrow(/status 'SUBMITTED'/i);
  });

  it('rejects recording a GRN against a CANCELLED purchase order', async () => {
    const procurement = new ProcurementService(app);
    const grn = new GrnService(app);
    const po = await procurement.createPurchaseOrder(
      { supplierId, locationId, lines: [{ skuId, orderedQty: 10, unitCost: 100 }] },
      actorStaffId,
    );
    await procurement.cancelPurchaseOrder(po.id, actorStaffId);

    await expect(
      grn.createGoodsReceipt(
        { poId: po.id, locationId, lines: [{ poLineId: po.lines[0]!.id, skuId, receivedQty: 10, acceptedQty: 10, damagedQty: 0, rejectedQty: 0 }] },
        actorStaffId,
      ),
    ).rejects.toThrow(/status 'CANCELLED'/i);
  });

  it('rejects recording a GRN against a REJECTED purchase order', async () => {
    const procurement = new ProcurementService(app);
    const grn = new GrnService(app);
    const po = await procurement.createPurchaseOrder(
      { supplierId, locationId, lines: [{ skuId, orderedQty: 10, unitCost: 100 }] },
      actorStaffId,
    );
    await procurement.submitPurchaseOrder(po.id, actorStaffId);
    await procurement.rejectPurchaseOrder(po.id, actorStaffId);

    await expect(
      grn.createGoodsReceipt(
        { poId: po.id, locationId, lines: [{ poLineId: po.lines[0]!.id, skuId, receivedQty: 10, acceptedQty: 10, damagedQty: 0, rejectedQty: 0 }] },
        actorStaffId,
      ),
    ).rejects.toThrow(/status 'REJECTED'/i);
  });

  it('rejects a duplicate poLineId within a single GRN request before touching the database', async () => {
    const grn = new GrnService(app);
    const { poId, poLineId } = await createApprovedPo(50);

    await expect(
      grn.createGoodsReceipt(
        {
          poId,
          locationId,
          lines: [
            { poLineId, skuId, receivedQty: 20, acceptedQty: 20, damagedQty: 0, rejectedQty: 0 },
            { poLineId, skuId, receivedQty: 20, acceptedQty: 20, damagedQty: 0, rejectedQty: 0 },
          ],
        },
        actorStaffId,
      ),
    ).rejects.toThrow(/cannot include the same purchase order line more than once/i);

    // No partial state should exist: PO line receivedQty must be untouched.
    const line = await testPrisma.purchaseOrderLine.findUniqueOrThrow({ where: { id: poLineId } });
    expect(line.receivedQty).toBe(0);
  });

  it('a GRN that fails partway through the transaction leaves no half-applied state', async () => {
    const grn = new GrnService(app);
    const { poId, poLineId } = await createApprovedPo(50);

    // A non-existent locationId passes every pre-transaction check
    // (poLineId/skuId membership, quantity balance) but fails the
    // database's foreign-key constraint on GoodsReceipt.locationId -
    // exercising real mid-transaction rollback, not just early validation.
    await expect(
      grn.createGoodsReceipt(
        {
          poId,
          locationId: '00000000-0000-0000-0000-000000000000',
          lines: [{ poLineId, skuId, receivedQty: 50, acceptedQty: 50, damagedQty: 0, rejectedQty: 0 }],
        },
        actorStaffId,
      ),
    ).rejects.toThrow();

    // Proves atomicity: the PO line's receivedQty (mutated by
    // applyGrnReceipt earlier in the same transaction) and the PO's
    // status must both be rolled back along with the failed GRN insert.
    const line = await testPrisma.purchaseOrderLine.findUniqueOrThrow({ where: { id: poLineId } });
    expect(line.receivedQty).toBe(0);
    const po = await testPrisma.purchaseOrder.findUniqueOrThrow({ where: { id: poId } });
    expect(po.status).toBe('APPROVED');

    const grnCount = await testPrisma.goodsReceipt.count({ where: { poId } });
    expect(grnCount).toBe(0);

    const inventory = new InventoryService(app);
    const balance = await inventory.getBalance(skuId, locationId);
    expect(balance.onHand).toBe(0); // no inventory was posted either
  });

  it('persists unit cost and total cost unchanged through the receipt lifecycle (margin-analytics requirement)', async () => {
    const procurement = new ProcurementService(app);
    const grn = new GrnService(app);
    const po = await procurement.createPurchaseOrder(
      { supplierId, locationId, lines: [{ skuId, orderedQty: 20, unitCost: 375.5 }] },
      actorStaffId,
    );
    await procurement.submitPurchaseOrder(po.id, actorStaffId);
    const approver = await testPrisma.staffUser.create({ data: { email: `grna-approver2-${Date.now()}@example.com`, passwordHash: 'x', fullName: 'Approver 2' } });
    await procurement.approvePurchaseOrder(po.id, approver.id);

    await grn.createGoodsReceipt(
      { poId: po.id, locationId, lines: [{ poLineId: po.lines[0]!.id, skuId, receivedQty: 20, acceptedQty: 20, damagedQty: 0, rejectedQty: 0 }] },
      actorStaffId,
    );

    const line = await testPrisma.purchaseOrderLine.findUniqueOrThrow({ where: { id: po.lines[0]!.id } });
    expect(Number(line.unitCost)).toBe(375.5); // never rewritten by receipt
    const poAfter = await testPrisma.purchaseOrder.findUniqueOrThrow({ where: { id: po.id } });
    expect(Number(poAfter.totalCost)).toBe(7510); // 20 * 375.50, computed once at creation
  });
});
