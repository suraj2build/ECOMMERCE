import { describe, it, expect, beforeEach } from 'vitest';
import { resetDatabase, seedRbac, seedBrandAndLocation, testPrisma } from '../helpers/db.js';

/**
 * Certification-pass database integrity round: proves the CHECK/unique
 * constraints added in migration 20260922171222_add_integrity_constraints
 * actually reject invalid data at the database level, not just in
 * application code - a real backstop, not documentation. Each test
 * bypasses the service layer and writes directly via Prisma to prove the
 * database itself refuses the bad state.
 */
describe('Database integrity constraints (certification pass)', () => {
  beforeEach(async () => {
    await resetDatabase();
    await seedRbac();
  });

  it('rejects an InventoryBalance row where reserved exceeds onHand', async () => {
    const { location } = await seedBrandAndLocation();
    const brand = await testPrisma.brand.findFirstOrThrow();
    const category = await testPrisma.category.findFirstOrThrow();
    const size = await testPrisma.size.findFirstOrThrow();
    const style = await testPrisma.style.create({
      data: { styleCode: 'DBI-001', name: 'DB Integrity', brandId: brand.id, categoryId: category.id, season: 'SS26', collection: 'Core' },
    });
    const colour = await testPrisma.colour.create({ data: { styleId: style.id, name: 'Black', colourCode: 'BLK' } });
    const sku = await testPrisma.sku.create({ data: { styleId: style.id, colourId: colour.id, sizeId: size.id, skuCode: 'DBI-001-BLK-M' } });

    await expect(
      testPrisma.inventoryBalance.create({
        data: { skuId: sku.id, locationId: location.id, onHand: 5, reserved: 10 },
      }),
    ).rejects.toThrow(/reserved_le_onHand|violates check constraint/i);
  });

  it('rejects a negative InventoryBalance.onHand', async () => {
    const { location } = await seedBrandAndLocation();
    const brand = await testPrisma.brand.findFirstOrThrow();
    const category = await testPrisma.category.findFirstOrThrow();
    const size = await testPrisma.size.findFirstOrThrow();
    const style = await testPrisma.style.create({
      data: { styleCode: 'DBI-002', name: 'DB Integrity 2', brandId: brand.id, categoryId: category.id, season: 'SS26', collection: 'Core' },
    });
    const colour = await testPrisma.colour.create({ data: { styleId: style.id, name: 'Blue', colourCode: 'BLU' } });
    const sku = await testPrisma.sku.create({ data: { styleId: style.id, colourId: colour.id, sizeId: size.id, skuCode: 'DBI-002-BLU-M' } });

    await expect(
      testPrisma.inventoryBalance.create({ data: { skuId: sku.id, locationId: location.id, onHand: -1 } }),
    ).rejects.toThrow(/violates check constraint/i);
  });

  it('rejects a non-positive InventoryTransaction.quantity', async () => {
    const { location } = await seedBrandAndLocation();
    const brand = await testPrisma.brand.findFirstOrThrow();
    const category = await testPrisma.category.findFirstOrThrow();
    const size = await testPrisma.size.findFirstOrThrow();
    const style = await testPrisma.style.create({
      data: { styleCode: 'DBI-003', name: 'DB Integrity 3', brandId: brand.id, categoryId: category.id, season: 'SS26', collection: 'Core' },
    });
    const colour = await testPrisma.colour.create({ data: { styleId: style.id, name: 'Red', colourCode: 'RED' } });
    const sku = await testPrisma.sku.create({ data: { styleId: style.id, colourId: colour.id, sizeId: size.id, skuCode: 'DBI-003-RED-M' } });

    await expect(
      testPrisma.inventoryTransaction.create({
        data: { skuId: sku.id, locationId: location.id, type: 'RECEIPT', quantity: 0 },
      }),
    ).rejects.toThrow(/violates check constraint/i);

    await expect(
      testPrisma.inventoryTransaction.create({
        data: { skuId: sku.id, locationId: location.id, type: 'RECEIPT', quantity: -5 },
      }),
    ).rejects.toThrow(/violates check constraint/i);
  });

  it('rejects two GoodsReceiptLine rows for the same (grn, poLine) pair', async () => {
    const { brand, location, category, size } = await seedBrandAndLocation();
    const style = await testPrisma.style.create({
      data: { styleCode: 'DBI-004', name: 'DB Integrity 4', brandId: brand.id, categoryId: category.id, season: 'SS26', collection: 'Core' },
    });
    const colour = await testPrisma.colour.create({ data: { styleId: style.id, name: 'Green', colourCode: 'GRN' } });
    const sku = await testPrisma.sku.create({ data: { styleId: style.id, colourId: colour.id, sizeId: size.id, skuCode: 'DBI-004-GRN-M' } });
    const supplier = await testPrisma.supplier.create({ data: { code: 'DBI-SUP', name: 'DB Integrity Supplier', type: 'FINISHED_GOODS' } });
    const staff = await testPrisma.staffUser.create({ data: { email: 'dbi-staff@example.com', passwordHash: 'x', fullName: 'DBI Staff' } });
    const po = await testPrisma.purchaseOrder.create({
      data: { poNumber: 'PO-DBI-0001', supplierId: supplier.id, locationId: location.id, totalCost: 1000, status: 'APPROVED' },
    });
    const poLine = await testPrisma.purchaseOrderLine.create({ data: { poId: po.id, skuId: sku.id, orderedQty: 10, unitCost: 100 } });
    const grn = await testPrisma.goodsReceipt.create({
      data: { grnNumber: 'GRN-DBI-0001', poId: po.id, locationId: location.id, receivedByStaffId: staff.id },
    });

    await testPrisma.goodsReceiptLine.create({
      data: { grnId: grn.id, poLineId: poLine.id, skuId: sku.id, expectedQty: 10, receivedQty: 5, acceptedQty: 5, qcResult: 'PASS' },
    });

    await expect(
      testPrisma.goodsReceiptLine.create({
        data: { grnId: grn.id, poLineId: poLine.id, skuId: sku.id, expectedQty: 5, receivedQty: 5, acceptedQty: 5, qcResult: 'PASS' },
      }),
    ).rejects.toThrow(/unique constraint|goods_receipt_lines_grnId_poLineId_key/i);
  });

  it('rejects a GoodsReceiptLine where accepted+damaged+rejected does not equal received', async () => {
    const { brand, location, category, size } = await seedBrandAndLocation();
    const style = await testPrisma.style.create({
      data: { styleCode: 'DBI-005', name: 'DB Integrity 5', brandId: brand.id, categoryId: category.id, season: 'SS26', collection: 'Core' },
    });
    const colour = await testPrisma.colour.create({ data: { styleId: style.id, name: 'Yellow', colourCode: 'YLW' } });
    const sku = await testPrisma.sku.create({ data: { styleId: style.id, colourId: colour.id, sizeId: size.id, skuCode: 'DBI-005-YLW-M' } });
    const supplier = await testPrisma.supplier.create({ data: { code: 'DBI-SUP2', name: 'DB Integrity Supplier 2', type: 'FINISHED_GOODS' } });
    const staff = await testPrisma.staffUser.create({ data: { email: 'dbi-staff2@example.com', passwordHash: 'x', fullName: 'DBI Staff 2' } });
    const po = await testPrisma.purchaseOrder.create({
      data: { poNumber: 'PO-DBI-0002', supplierId: supplier.id, locationId: location.id, totalCost: 1000, status: 'APPROVED' },
    });
    const poLine = await testPrisma.purchaseOrderLine.create({ data: { poId: po.id, skuId: sku.id, orderedQty: 10, unitCost: 100 } });
    const grn = await testPrisma.goodsReceipt.create({
      data: { grnNumber: 'GRN-DBI-0002', poId: po.id, locationId: location.id, receivedByStaffId: staff.id },
    });

    await expect(
      testPrisma.goodsReceiptLine.create({
        data: { grnId: grn.id, poLineId: poLine.id, skuId: sku.id, expectedQty: 10, receivedQty: 10, acceptedQty: 5, damagedQty: 0, rejectedQty: 0, qcResult: 'PARTIAL' },
      }),
    ).rejects.toThrow(/violates check constraint/i);
  });

  it('rejects a Price where sellingPrice exceeds mrp, at the database level', async () => {
    const { brand, category } = await seedBrandAndLocation();
    const style = await testPrisma.style.create({
      data: { styleCode: 'DBI-006', name: 'DB Integrity 6', brandId: brand.id, categoryId: category.id, season: 'SS26', collection: 'Core' },
    });

    await expect(
      testPrisma.price.create({ data: { styleId: style.id, mrp: 1000, sellingPrice: 1200 } }),
    ).rejects.toThrow(/violates check constraint/i);
  });

  it('rejects a non-positive PurchaseOrderLine.orderedQty at the database level', async () => {
    const { brand, location, category, size } = await seedBrandAndLocation();
    const style = await testPrisma.style.create({
      data: { styleCode: 'DBI-007', name: 'DB Integrity 7', brandId: brand.id, categoryId: category.id, season: 'SS26', collection: 'Core' },
    });
    const colour = await testPrisma.colour.create({ data: { styleId: style.id, name: 'Purple', colourCode: 'PPL' } });
    const sku = await testPrisma.sku.create({ data: { styleId: style.id, colourId: colour.id, sizeId: size.id, skuCode: 'DBI-007-PPL-M' } });
    const supplier = await testPrisma.supplier.create({ data: { code: 'DBI-SUP3', name: 'DB Integrity Supplier 3', type: 'FINISHED_GOODS' } });
    const po = await testPrisma.purchaseOrder.create({
      data: { poNumber: 'PO-DBI-0003', supplierId: supplier.id, locationId: location.id, totalCost: 0 },
    });

    await expect(
      testPrisma.purchaseOrderLine.create({ data: { poId: po.id, skuId: sku.id, orderedQty: 0, unitCost: 100 } }),
    ).rejects.toThrow(/violates check constraint/i);
  });

  it('rejects a duplicate size label within the same size chart', async () => {
    const chart = await testPrisma.sizeChart.create({
      data: { name: 'DBI Chart', entries: { create: [{ sizeLabel: 'M', measurements: { chest: 40 } }] } },
    });

    await expect(
      testPrisma.sizeChartEntry.create({
        data: { sizeChartId: chart.id, sizeLabel: 'M', measurements: { chest: 41 } },
      }),
    ).rejects.toThrow(/unique constraint|size_chart_entries_sizeChartId_sizeLabel_key/i);
  });

  it('blocks deleting a StaffUser who has an AuditLog entry attributed to them (never silently loses attribution)', async () => {
    const staff = await testPrisma.staffUser.create({ data: { email: 'dbi-audited@example.com', passwordHash: 'x', fullName: 'Audited Staff' } });
    await testPrisma.auditLog.create({
      data: { actorType: 'STAFF', actorStaffId: staff.id, action: 'test.action', entityType: 'Test', entityId: 'x' },
    });

    await expect(testPrisma.staffUser.delete({ where: { id: staff.id } })).rejects.toThrow(
      /foreign key constraint|violates foreign key/i,
    );
  });
});
