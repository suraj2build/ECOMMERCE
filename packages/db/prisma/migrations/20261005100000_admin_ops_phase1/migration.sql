-- CreateEnum
CREATE TYPE "ProductType" AS ENUM ('APPAREL', 'FOOTWEAR', 'BELT', 'FRAGRANCE');

-- AlterTable
ALTER TABLE "categories" ADD COLUMN     "productType" "ProductType" NOT NULL DEFAULT 'APPAREL';

-- AlterTable
ALTER TABLE "product_media" ADD COLUMN     "byteSize" INTEGER,
ADD COLUMN     "isCover" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "mimeType" TEXT,
ADD COLUMN     "storageKey" TEXT,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateTable
CREATE TABLE "product_import_runs" (
    "id" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "totalRows" INTEGER NOT NULL,
    "totalBatches" INTEGER NOT NULL,
    "batchResults" JSONB NOT NULL DEFAULT '{}',
    "createdByStaffId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_import_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "product_import_runs_createdAt_idx" ON "product_import_runs"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "product_media_storageKey_key" ON "product_media"("storageKey");

-- AddForeignKey
ALTER TABLE "product_import_runs" ADD CONSTRAINT "product_import_runs_createdByStaffId_fkey" FOREIGN KEY ("createdByStaffId") REFERENCES "staff_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Data: the approved launch categories that are not apparel (Product Owner,
-- 2026-10-04 launch assortment). Any other category keeps APPAREL and the
-- owner can change it in admin.
UPDATE "categories" SET "productType" = 'FOOTWEAR' WHERE "slug" = 'business-casual-shoes';
UPDATE "categories" SET "productType" = 'BELT' WHERE "slug" = 'business-casual-belts';
UPDATE "categories" SET "productType" = 'FRAGRANCE' WHERE "slug" = 'perfume';

-- At most one chosen listing photo per product.
CREATE UNIQUE INDEX "product_media_one_cover_per_style" ON "product_media"("styleId") WHERE "isCover";
