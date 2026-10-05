import type { Prisma, PrismaClient } from '@fcp/db';
import { NotFoundError, ValidationError } from '@fcp/shared';
import { recordAudit } from '../audit/service.js';

/**
 * Dispatch checks, documents and courier handover (docs/admin/DISPATCH.md;
 * Product Owner review 2026-10-05, AO-D5).
 *
 * - Scans: a pick scan must equal the size's barcode; pack scans must match
 *   the package's units exactly. Whether scans are REQUIRED is the owner's
 *   setting (B-2), off by default; a scan that is given is always checked.
 * - Parcel: gross weight and dimensions recorded at pack and sent with the
 *   courier booking. Required only when the owner's setting says so (B-3).
 * - Handover: recorded separately from booking (staff confirmation or the
 *   carrier's first in-transit event). The stock SALE is NOT moved; it is
 *   still posted at booking until the consequences review is done.
 */

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * Where a package really is (AO-D5). A package is marked shipped when it is
 * booked with a courier (the sale is posted then), so "shipped" alone does
 * not say whether the courier has it. The admin shows this stage instead.
 */
export type DispatchStage = 'PENDING' | 'PACKED' | 'READY_TO_SHIP' | 'SHIPPED' | 'BOOKED_AWAITING_COLLECTION' | 'HANDED_OVER' | 'DELIVERED';

export function dispatchStage(fulfilmentStatus: string, shipment: { handedOverAt: Date | null } | null | undefined): DispatchStage {
  if (fulfilmentStatus === 'SHIPPED' && shipment) return shipment.handedOverAt ? 'HANDED_OVER' : 'BOOKED_AWAITING_COLLECTION';
  return fulfilmentStatus as DispatchStage;
}

export interface DispatchSettingsValue {
  requireScanAtPick: boolean;
  requireScanAtPack: boolean;
  requireParcelMeasurements: boolean;
}

export interface ParcelInput {
  weightGrams?: number;
  lengthCm?: number;
  widthCm?: number;
  heightCm?: number;
}

/** Most parcels the handover page lists at once (oldest first). */
export const HANDOVER_LIST_LIMIT = 500;

const DEFAULTS: DispatchSettingsValue = { requireScanAtPick: false, requireScanAtPack: false, requireParcelMeasurements: false };

export async function dispatchSettings(db: Db): Promise<DispatchSettingsValue> {
  const row = await db.dispatchSettings.findUnique({ where: { id: 'default' } });
  return row ? { requireScanAtPick: row.requireScanAtPick, requireScanAtPack: row.requireScanAtPack, requireParcelMeasurements: row.requireParcelMeasurements } : DEFAULTS;
}

const normalise = (code: string) => code.trim();

/** Pick: the scanned code must be this size's barcode. */
export async function checkPickScan(db: Db, skuId: string, scannedBarcode: string | undefined): Promise<string | null> {
  const settings = await dispatchSettings(db);
  const sku = await db.sku.findUnique({ where: { id: skuId }, select: { skuCode: true, barcode: true } });
  if (!sku) throw new NotFoundError('Sku', skuId);
  const scan = scannedBarcode === undefined ? '' : normalise(scannedBarcode);
  if (!scan) {
    if (settings.requireScanAtPick) {
      throw new ValidationError(
        sku.barcode
          ? `Scan the item's barcode to confirm the pick (${sku.skuCode})`
          : `${sku.skuCode} has no barcode, and scanning at pick is required. Add the barcode in the product workspace first.`,
      );
    }
    return null;
  }
  if (!sku.barcode) throw new ValidationError(`${sku.skuCode} has no barcode to check the scan against. Add it in the product workspace.`);
  if (scan !== sku.barcode) {
    const other = await db.sku.findUnique({ where: { barcode: scan }, select: { skuCode: true } });
    throw new ValidationError(
      other ? `Wrong item: the scanned barcode belongs to ${other.skuCode}, this pick is ${sku.skuCode}` : `The scanned barcode ${scan} does not match ${sku.skuCode}`,
    );
  }
  return scan;
}

/** Pack: every unit scanned exactly once per unit; nothing missing, extra or from another order. */
export async function checkPackScans(db: Db, expected: Array<{ skuCode: string; barcode: string | null; quantity: number }>, scannedBarcodes: string[] | undefined): Promise<boolean> {
  const settings = await dispatchSettings(db);
  const scans = (scannedBarcodes ?? []).map(normalise).filter(Boolean);
  if (scans.length === 0) {
    if (settings.requireScanAtPack) throw new ValidationError('Scan every unit into the parcel before marking it packed');
    return false;
  }
  const missingBarcode = expected.filter((e) => !e.barcode).map((e) => e.skuCode);
  if (missingBarcode.length > 0) {
    throw new ValidationError(`These sizes have no barcode, so their scans cannot be checked: ${missingBarcode.join(', ')}. Add the barcodes in the product workspace.`);
  }
  const want = new Map<string, { skuCode: string; quantity: number }>();
  for (const e of expected) {
    const cur = want.get(e.barcode!);
    want.set(e.barcode!, { skuCode: e.skuCode, quantity: (cur?.quantity ?? 0) + e.quantity });
  }
  const got = new Map<string, number>();
  for (const s of scans) got.set(s, (got.get(s) ?? 0) + 1);

  const problems: string[] = [];
  for (const [code, { skuCode, quantity }] of want) {
    const n = got.get(code) ?? 0;
    if (n < quantity) problems.push(`${skuCode}: ${quantity - n} more to scan`);
    if (n > quantity) problems.push(`${skuCode}: scanned ${n - quantity} too many`);
  }
  for (const [code, n] of got) {
    if (want.has(code)) continue;
    const other = await db.sku.findUnique({ where: { barcode: code }, select: { skuCode: true } });
    problems.push(other ? `${other.skuCode} (${n}) is not in this package` : `${code} is not a known barcode`);
  }
  if (problems.length > 0) throw new ValidationError(`The scans do not match the package: ${problems.join('; ')}`);
  return true;
}

export async function checkParcel(db: Db, parcel: ParcelInput | undefined): Promise<ParcelInput> {
  const settings = await dispatchSettings(db);
  const p = parcel ?? {};
  for (const [k, v] of Object.entries(p)) {
    if (v !== undefined && (!Number.isInteger(v) || v <= 0)) throw new ValidationError(`${k} must be a whole number above zero`);
  }
  const dims = [p.lengthCm, p.widthCm, p.heightCm];
  if (dims.some((d) => d !== undefined) && dims.some((d) => d === undefined)) throw new ValidationError('Give all three dimensions (length, width and height) or none');
  if (settings.requireParcelMeasurements && (p.weightGrams === undefined || dims.some((d) => d === undefined))) {
    throw new ValidationError('Enter the parcel weight and its length, width and height before marking it packed');
  }
  return p;
}

interface ShippingAddressJson {
  line1?: string;
  line2?: string;
  city?: string;
  state?: string;
  pincode?: string;
}

/**
 * The sender and return address on a courier label is the address of the
 * location the package is dispatched from. A booking is refused until that
 * address is complete (Product Owner review after `6217031`): a parcel
 * booked without it has no return address.
 */
export async function assertSenderAddress(db: Db, fulfilmentId: string) {
  const line = await db.orderLine.findFirst({ where: { fulfilmentId, status: { not: 'CANCELLED' } }, select: { locationId: true } });
  let locationId = line?.locationId ?? null;
  if (!locationId) {
    const f = await db.orderFulfilment.findUnique({ where: { id: fulfilmentId }, select: { exchangeId: true } });
    if (f?.exchangeId) locationId = (await db.pickTask.findUnique({ where: { exchangeId: f.exchangeId }, select: { locationId: true } }))?.locationId ?? null;
  }
  const location = locationId
    ? await db.location.findUnique({ where: { id: locationId }, select: { name: true, addressLine1: true, city: true, state: true, pinCode: true } })
    : null;
  if (!location) throw new ValidationError('This package has no dispatch location, so it has no sender address; it cannot be booked with a courier');
  const missing = [
    !location.addressLine1?.trim() && 'address line',
    !location.city?.trim() && 'city',
    !location.state?.trim() && 'state',
    !location.pinCode?.trim() && 'PIN code',
  ].filter((m): m is string => Boolean(m));
  if (missing.length > 0) {
    const list = missing.length === 1 ? missing[0] : `${missing.slice(0, -1).join(', ')} and ${missing[missing.length - 1]}`;
    throw new ValidationError(
      `Add the ${list} for ${location.name} on Business & warehouse before booking a courier: it is the sender and return address on the label.`,
    );
  }
}

export class DispatchService {
  constructor(private readonly prisma: PrismaClient) {}

  /** Data for the packing slip and address label of one package. */
  async documents(fulfilmentId: string) {
    const f = await this.prisma.orderFulfilment.findUnique({
      where: { id: fulfilmentId },
      include: {
        order: { select: { id: true, orderNumber: true, createdAt: true, contactName: true, contactMobile: true, shippingAddress: true, paymentMethod: true, checkoutSessionId: true } },
        exchange: { select: { exchangeNumber: true } },
        lines: {
          where: { status: { not: 'CANCELLED' } },
          select: { quantity: true, locationId: true, sku: { select: { skuCode: true, barcode: true, style: { select: { name: true } }, colour: { select: { name: true } }, size: { select: { label: true } } } } },
        },
        shipment: { select: { provider: true, trackingRef: true, bookedAt: true, handedOverAt: true, handoverReference: true } },
      },
    });
    if (!f) throw new NotFoundError('OrderFulfilment', fulfilmentId);

    let lines = f.lines.map((l) => ({ skuCode: l.sku.skuCode, name: l.sku.style.name, colour: l.sku.colour.name, size: l.sku.size.label, quantity: l.quantity, barcode: l.sku.barcode }));
    let locationId = f.lines[0]?.locationId ?? null;
    if (f.exchangeId) {
      const task = await this.prisma.pickTask.findUnique({
        where: { exchangeId: f.exchangeId },
        select: { locationId: true, allocatedQuantity: true, pickedQuantity: true, sku: { select: { skuCode: true, barcode: true, style: { select: { name: true } }, colour: { select: { name: true } }, size: { select: { label: true } } } } },
      });
      if (task) {
        lines = [{ skuCode: task.sku.skuCode, name: task.sku.style.name, colour: task.sku.colour.name, size: task.sku.size.label, quantity: task.pickedQuantity || task.allocatedQuantity, barcode: task.sku.barcode }];
        locationId = task.locationId;
      }
    }

    const location = locationId
      ? await this.prisma.location.findUnique({ where: { id: locationId }, include: { gstRegistration: { include: { legalEntity: { select: { legalName: true } } } } } })
      : null;
    const to = (f.order.shippingAddress ?? {}) as ShippingAddressJson;
    const isExchange = Boolean(f.exchangeId);
    const cod = !isExchange && f.order.paymentMethod === 'COD'
      ? await this.prisma.payment.findFirst({ where: { checkoutSessionId: f.order.checkoutSessionId, provider: 'COD' }, orderBy: { createdAt: 'desc' }, select: { amount: true } })
      : null;

    return {
      fulfilmentId: f.id,
      status: f.status,
      reference: f.exchange?.exchangeNumber ?? f.order.orderNumber,
      orderNumber: f.order.orderNumber,
      orderDate: f.order.createdAt,
      shipTo: { name: f.order.contactName, mobile: f.order.contactMobile, line1: to.line1 ?? null, line2: to.line2 ?? null, city: to.city ?? null, state: to.state ?? null, pincode: to.pincode ?? null },
      shipFrom: location
        ? {
            name: location.gstRegistration?.legalEntity.legalName ?? location.name,
            line1: location.addressLine1,
            line2: location.addressLine2,
            city: location.city,
            state: location.state,
            pincode: location.pinCode,
          }
        : null,
      paymentMethod: isExchange ? 'EXCHANGE' : f.order.paymentMethod,
      cashToCollect: cod ? Number(cod.amount) : null,
      parcel: { weightGrams: f.parcelWeightGrams, lengthCm: f.parcelLengthCm, widthCm: f.parcelWidthCm, heightCm: f.parcelHeightCm },
      lines,
      shipment: f.shipment,
    };
  }

  /**
   * Parcels booked with a courier and not yet handed over, oldest first.
   * At most HANDOVER_LIST_LIMIT are listed; `total` says how many there are,
   * so the page can say when it shows only the oldest.
   */
  async awaitingHandover() {
    const where = { status: 'BOOKED' as const, handedOverAt: null };
    const total = await this.prisma.shipment.count({ where });
    const shipments = await this.prisma.shipment.findMany({
      where,
      orderBy: { bookedAt: 'asc' },
      take: HANDOVER_LIST_LIMIT,
      include: {
        order: { select: { orderNumber: true } },
        fulfilment: { select: { id: true, parcelWeightGrams: true, exchange: { select: { exchangeNumber: true } }, lines: { where: { status: { not: 'CANCELLED' } }, select: { quantity: true } } } },
      },
    });
    return {
      total,
      limit: HANDOVER_LIST_LIMIT,
      shipments: shipments.map((s) => ({
        id: s.id,
        provider: s.provider,
        trackingRef: s.trackingRef,
        bookedAt: s.bookedAt,
        reference: s.fulfilment.exchange?.exchangeNumber ?? s.order.orderNumber,
        fulfilmentId: s.fulfilment.id,
        units: s.fulfilment.exchange ? 1 : s.fulfilment.lines.reduce((n, l) => n + l.quantity, 0),
        parcelWeightGrams: s.fulfilment.parcelWeightGrams,
      })),
    };
  }

  /**
   * Staff confirm that the courier collected these parcels. Only booked,
   * not-yet-handed-over shipments are updated; repeating the call for a
   * parcel already handed over changes nothing. Does NOT post any stock
   * movement (the SALE stays at booking - AO-D5).
   */
  async recordHandover(shipmentIds: string[], reference: string | undefined, actorStaffId: string) {
    const ids = [...new Set(shipmentIds)];
    if (ids.length === 0) throw new ValidationError('Choose at least one parcel');
    return this.prisma.$transaction(async (tx) => {
      // Lock the parcels first (in a fixed order), so two people confirming
      // the same parcels at once are serialised: the second sees them as
      // already handed over and records nothing in their name.
      const locked = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM shipments WHERE id = ANY(${ids}::text[]) ORDER BY id FOR UPDATE`;
      if (locked.length !== ids.length) {
        const missingId = ids.find((id) => !locked.some((r) => r.id === id))!;
        throw new NotFoundError('Shipment', missingId);
      }
      const found = await tx.shipment.findMany({ where: { id: { in: ids } }, select: { id: true, status: true, handedOverAt: true, orderId: true } });
      const missing = ids.filter((id) => !found.some((s) => s.id === id));
      if (missing.length > 0) throw new NotFoundError('Shipment', missing[0]!);
      const notBooked = found.filter((s) => s.status === 'CREATED');
      if (notBooked.length > 0) throw new ValidationError('A parcel that is not booked with the courier yet cannot be handed over');
      const now = new Date();
      const updated = await tx.shipment.updateMany({
        where: { id: { in: ids }, handedOverAt: null },
        data: { handedOverAt: now, handoverSource: 'STAFF', handedOverByStaffId: actorStaffId, handoverReference: reference?.trim() || null },
      });
      for (const s of found.filter((x) => !x.handedOverAt)) {
        await recordAudit(tx, {
          actorType: 'STAFF',
          actorStaffId,
          action: 'shipping.handover',
          entityType: 'Shipment',
          entityId: s.id,
          newValue: { handoverReference: reference?.trim() || null, source: 'STAFF' },
          reference: s.orderId,
        });
      }
      return { recorded: updated.count, alreadyHandedOver: ids.length - updated.count };
    });
  }

  getSettings() {
    return dispatchSettings(this.prisma);
  }

  async updateSettings(value: DispatchSettingsValue, actorStaffId: string) {
    const before = await dispatchSettings(this.prisma);
    await this.prisma.$transaction(async (tx) => {
      await tx.dispatchSettings.upsert({ where: { id: 'default' }, create: { id: 'default', ...value, updatedByStaffId: actorStaffId }, update: { ...value, updatedByStaffId: actorStaffId } });
      await recordAudit(tx, { actorType: 'STAFF', actorStaffId, action: 'dispatch_settings.update', entityType: 'DispatchSettings', entityId: 'default', oldValue: { ...before }, newValue: { ...value } });
    });
    return dispatchSettings(this.prisma);
  }
}
