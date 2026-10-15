-- Dispatch checks, parcel measurements and courier handover (docs/admin/DISPATCH.md; AO-D5).
-- AlterTable
ALTER TABLE "order_fulfilments" ADD COLUMN     "packScanVerifiedAt" TIMESTAMP(3),
ADD COLUMN     "parcelHeightCm" INTEGER,
ADD COLUMN     "parcelLengthCm" INTEGER,
ADD COLUMN     "parcelWeightGrams" INTEGER,
ADD COLUMN     "parcelWidthCm" INTEGER;

-- AlterTable
ALTER TABLE "pick_tasks" ADD COLUMN     "scannedBarcode" TEXT;

-- AlterTable
ALTER TABLE "shipments" ADD COLUMN     "handedOverAt" TIMESTAMP(3),
ADD COLUMN     "handedOverByStaffId" TEXT,
ADD COLUMN     "handoverReference" TEXT,
ADD COLUMN     "handoverSource" TEXT;

-- CreateTable
CREATE TABLE "dispatch_settings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "requireScanAtPick" BOOLEAN NOT NULL DEFAULT false,
    "requireScanAtPack" BOOLEAN NOT NULL DEFAULT false,
    "requireParcelMeasurements" BOOLEAN NOT NULL DEFAULT false,
    "updatedByStaffId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dispatch_settings_pkey" PRIMARY KEY ("id")
);


-- Parcel measurements are positive whole numbers when present.
ALTER TABLE "order_fulfilments" ADD CONSTRAINT "order_fulfilments_parcel_positive_check" CHECK (
  ("parcelWeightGrams" IS NULL OR "parcelWeightGrams" > 0)
  AND ("parcelLengthCm" IS NULL OR "parcelLengthCm" > 0)
  AND ("parcelWidthCm" IS NULL OR "parcelWidthCm" > 0)
  AND ("parcelHeightCm" IS NULL OR "parcelHeightCm" > 0)
);

-- A recorded handover always says where it came from; a staff handover names the person.
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_handover_check" CHECK (
  ("handedOverAt" IS NULL AND "handoverSource" IS NULL AND "handedOverByStaffId" IS NULL)
  OR ("handedOverAt" IS NOT NULL AND "handoverSource" = 'STAFF' AND "handedOverByStaffId" IS NOT NULL)
  OR ("handedOverAt" IS NOT NULL AND "handoverSource" = 'CARRIER_EVENT' AND "handedOverByStaffId" IS NULL)
);

ALTER TABLE "dispatch_settings" ADD CONSTRAINT "dispatch_settings_single_row_check" CHECK ("id" = 'default');
