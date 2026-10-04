-- CreateTable
CREATE TABLE "content_assets" (
    "id" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "altText" TEXT,
    "createdByStaffId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "content_assets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "content_assets_storageKey_key" ON "content_assets"("storageKey");

-- CreateIndex
CREATE INDEX "content_assets_createdAt_idx" ON "content_assets"("createdAt");

-- AddForeignKey
ALTER TABLE "content_assets" ADD CONSTRAINT "content_assets_createdByStaffId_fkey" FOREIGN KEY ("createdByStaffId") REFERENCES "staff_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

