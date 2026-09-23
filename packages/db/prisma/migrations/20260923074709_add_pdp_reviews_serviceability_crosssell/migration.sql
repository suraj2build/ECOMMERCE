-- CreateEnum
CREATE TYPE "ReviewStatus" AS ENUM ('PUBLISHED', 'HIDDEN');

-- AlterTable
ALTER TABLE "product_media" ADD COLUMN     "modelInfo" JSONB;

-- CreateTable
CREATE TABLE "reviews" (
    "id" TEXT NOT NULL,
    "styleId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "title" TEXT,
    "body" TEXT NOT NULL,
    "status" "ReviewStatus" NOT NULL DEFAULT 'PUBLISHED',
    "moderatedByStaffId" TEXT,
    "moderatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "serviceable_pincodes" (
    "pincode" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "isServiceable" BOOLEAN NOT NULL DEFAULT true,
    "codAvailable" BOOLEAN NOT NULL DEFAULT true,
    "estimatedDaysMin" INTEGER,
    "estimatedDaysMax" INTEGER,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "serviceable_pincodes_pkey" PRIMARY KEY ("pincode")
);

-- CreateTable
CREATE TABLE "cross_sell_overrides" (
    "id" TEXT NOT NULL,
    "styleId" TEXT NOT NULL,
    "relatedStyleId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdByStaffId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cross_sell_overrides_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "reviews_styleId_status_idx" ON "reviews"("styleId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "reviews_styleId_customerId_key" ON "reviews"("styleId", "customerId");

-- CreateIndex
CREATE UNIQUE INDEX "cross_sell_overrides_styleId_relatedStyleId_key" ON "cross_sell_overrides"("styleId", "relatedStyleId");

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_styleId_fkey" FOREIGN KEY ("styleId") REFERENCES "styles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_moderatedByStaffId_fkey" FOREIGN KEY ("moderatedByStaffId") REFERENCES "staff_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cross_sell_overrides" ADD CONSTRAINT "cross_sell_overrides_styleId_fkey" FOREIGN KEY ("styleId") REFERENCES "styles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cross_sell_overrides" ADD CONSTRAINT "cross_sell_overrides_relatedStyleId_fkey" FOREIGN KEY ("relatedStyleId") REFERENCES "styles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cross_sell_overrides" ADD CONSTRAINT "cross_sell_overrides_createdByStaffId_fkey" FOREIGN KEY ("createdByStaffId") REFERENCES "staff_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Defense-in-depth CHECK constraints (M11, mirrors the M08 pattern of
-- never trusting application code alone for invariants that matter).
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_rating_range"
  CHECK ("rating" >= 1 AND "rating" <= 5);

ALTER TABLE "cross_sell_overrides" ADD CONSTRAINT "cross_sell_overrides_not_self"
  CHECK ("styleId" != "relatedStyleId");

-- Indian PIN codes are exactly 6 digits.
ALTER TABLE "serviceable_pincodes" ADD CONSTRAINT "serviceable_pincodes_format"
  CHECK ("pincode" ~ '^[0-9]{6}$');
