import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createTestApp } from '../helpers/app.js';
import { resetDatabase, seedRbac, seedBrandAndLocation, testPrisma } from '../helpers/db.js';
import { GrnService } from '../../src/modules/grn/service.js';
import { ProcurementService } from '../../src/modules/procurement/service.js';
import { InventoryService } from '../../src/modules/inventory/service.js';

/**
 * acceptance/m05-grn.md "Concurrency": two GRN entries submitted
 * concurrently for the same PO line must not corrupt the PO's
 * remaining-quantity calculation - both persist correctly, and the
 * remaining quantity is accurate after both. Proven here with real
 * concurrent createGoodsReceipt() calls against a real Postgres instance.
 */
describe('GRN concurrency - PO line receipt roll-up (GRN concurrency)', () => {
  let app: FastifyInstance;
  let poId: string;
  let poLineId: string;
  let skuId: string;
  let locationId: string;
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
      data: {
        styleCode: 'GRNC-001',
        name: 'GRN Concurrency Style',
        brandId: brand.id,
        categoryId: category.id,
        season: 'SS26',
        collection: 'Core',
      },
    });
    const colour = await testPrisma.colour.create({ data: { styleId: style.id, name: 'Blue', colourCode: 'BLU' } });
    const sku = await testPrisma.sku.create({
      data: { styleId: style.id, colourId: colour.id, sizeId: size.id, skuCode: 'GRNC-001-BLU-M' },
    });
    const supplier = await testPrisma.supplier.create({
      data: { code: 'GRNC-SUP', name: 'GRN Concurrency Supplier', type: 'FINISHED_GOODS' },
    });
    const staffUser = await testPrisma.staffUser.create({
      data: { email: `grn-conc-${Date.now()}@example.com`, passwordHash: 'x', fullName: 'GRN Tester' },
    });

    const procurement = new ProcurementService(app);
    const po = await procurement.createPurchaseOrder(
      {
        supplierId: supplier.id,
        locationId: location.id,
        lines: [{ skuId: sku.id, orderedQty: 100, unitCost: 500 }],
      },
      staffUser.id,
    );
    await procurement.submitPurchaseOrder(po.id, staffUser.id);
    const approver = await testPrisma.staffUser.create({
      data: { email: `grn-conc-approver-${Date.now()}@example.com`, passwordHash: 'x', fullName: 'Approver' },
    });
    await procurement.approvePurchaseOrder(po.id, approver.id);

    poId = po.id;
    poLineId = po.lines[0]!.id;
    skuId = sku.id;
    locationId = location.id;
    actorStaffId = staffUser.id;
  });

  it('correctly rolls up two concurrent partial GRNs against the same PO line without losing an update', async () => {
    const grn = new GrnService(app);

    // Two GRNs of 40 units each, submitted concurrently, against a PO
    // line ordered for 100. If the receivedQty update were a lost-update
    // race, the PO line would show only 40 received instead of 80.
    const [first, second] = await Promise.all([
      grn.createGoodsReceipt(
        {
          poId,
          locationId,
          lines: [{ poLineId, skuId, receivedQty: 40, acceptedQty: 40, damagedQty: 0, rejectedQty: 0 }],
        },
        actorStaffId,
      ),
      grn.createGoodsReceipt(
        {
          poId,
          locationId,
          lines: [{ poLineId, skuId, receivedQty: 40, acceptedQty: 40, damagedQty: 0, rejectedQty: 0 }],
        },
        actorStaffId,
      ),
    ]);

    expect(first.id).not.toBe(second.id);

    const line = await testPrisma.purchaseOrderLine.findUniqueOrThrow({ where: { id: poLineId } });
    expect(line.receivedQty).toBe(80); // both GRNs' receipts persisted - no lost update

    const po = await testPrisma.purchaseOrder.findUniqueOrThrow({ where: { id: poId } });
    expect(po.status).toBe('PARTIALLY_RECEIVED');

    const inventory = new InventoryService(app);
    const balance = await inventory.getBalance(skuId, locationId);
    expect(balance.onHand).toBe(80); // both accepted quantities posted to the ledger

    const reconciliation = await inventory.reconcileBalance(skuId, locationId);
    expect(reconciliation.matches).toBe(true);
  });

  it('supports full receipt of the remaining quantity in a third GRN after two partials', async () => {
    const grn = new GrnService(app);

    await grn.createGoodsReceipt(
      { poId, locationId, lines: [{ poLineId, skuId, receivedQty: 30, acceptedQty: 30, damagedQty: 0, rejectedQty: 0 }] },
      actorStaffId,
    );
    await grn.createGoodsReceipt(
      { poId, locationId, lines: [{ poLineId, skuId, receivedQty: 30, acceptedQty: 30, damagedQty: 0, rejectedQty: 0 }] },
      actorStaffId,
    );

    let po = await testPrisma.purchaseOrder.findUniqueOrThrow({ where: { id: poId } });
    expect(po.status).toBe('PARTIALLY_RECEIVED');

    // Remaining 40 units (100 ordered - 60 received so far).
    await grn.createGoodsReceipt(
      { poId, locationId, lines: [{ poLineId, skuId, receivedQty: 40, acceptedQty: 40, damagedQty: 0, rejectedQty: 0 }] },
      actorStaffId,
    );

    po = await testPrisma.purchaseOrder.findUniqueOrThrow({ where: { id: poId } });
    expect(po.status).toBe('FULLY_RECEIVED');

    const line = await testPrisma.purchaseOrderLine.findUniqueOrThrow({ where: { id: poLineId } });
    expect(line.receivedQty).toBe(100);
  });
});
