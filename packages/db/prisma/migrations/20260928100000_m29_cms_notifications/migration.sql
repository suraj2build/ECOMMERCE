-- CreateEnum
CREATE TYPE "NotificationEvent" AS ENUM ('ORDER_CONFIRMED', 'ORDER_SHIPPED', 'ORDER_DELIVERED', 'ORDER_CANCELLED', 'RETURN_RECEIVED', 'REFUND_COMPLETED', 'EXCHANGE_COMPLETED', 'LOYALTY_POINTS_VESTED');

-- CreateEnum
CREATE TYPE "NotificationDeliveryStatus" AS ENUM ('SENT', 'FAILED', 'SKIPPED_OPTOUT', 'SKIPPED_NO_ADDRESS', 'AMBIGUOUS_RECONCILIATION_REQUIRED');

-- CreateTable
CREATE TABLE "cms_banners" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "imageUrl" TEXT NOT NULL,
    "linkUrl" TEXT,
    "placement" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "publishedAt" TIMESTAMP(3),
    "createdByStaffId" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cms_banners_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cms_content_blocks" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdByStaffId" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cms_content_blocks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cms_landing_pages" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "metaDescription" TEXT,
    "heroImageUrl" TEXT,
    "blockKeys" JSONB NOT NULL DEFAULT '[]',
    "isPublished" BOOLEAN NOT NULL DEFAULT false,
    "publishedAt" TIMESTAMP(3),
    "createdByStaffId" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cms_landing_pages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cms_navigation_menus" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "items" JSONB NOT NULL,
    "updatedByStaffId" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cms_navigation_menus_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_deliveries" (
    "id" TEXT NOT NULL,
    "event" "NotificationEvent" NOT NULL,
    "channel" "CommunicationChannel" NOT NULL,
    "customerId" TEXT NOT NULL,
    "referenceId" TEXT NOT NULL,
    "status" "NotificationDeliveryStatus" NOT NULL,
    "providerMessageId" TEXT,
    "errorMessage" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "cms_banners_placement_idx" ON "cms_banners"("placement");

-- CreateIndex
CREATE UNIQUE INDEX "cms_content_blocks_key_key" ON "cms_content_blocks"("key");

-- CreateIndex
CREATE UNIQUE INDEX "cms_landing_pages_slug_key" ON "cms_landing_pages"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "cms_navigation_menus_key_key" ON "cms_navigation_menus"("key");

-- CreateIndex
CREATE INDEX "notification_deliveries_customerId_idx" ON "notification_deliveries"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "notification_deliveries_event_referenceId_channel_key" ON "notification_deliveries"("event", "referenceId", "channel");

-- AddForeignKey
ALTER TABLE "cms_banners" ADD CONSTRAINT "cms_banners_createdByStaffId_fkey" FOREIGN KEY ("createdByStaffId") REFERENCES "staff_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cms_content_blocks" ADD CONSTRAINT "cms_content_blocks_createdByStaffId_fkey" FOREIGN KEY ("createdByStaffId") REFERENCES "staff_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cms_landing_pages" ADD CONSTRAINT "cms_landing_pages_createdByStaffId_fkey" FOREIGN KEY ("createdByStaffId") REFERENCES "staff_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cms_navigation_menus" ADD CONSTRAINT "cms_navigation_menus_updatedByStaffId_fkey" FOREIGN KEY ("updatedByStaffId") REFERENCES "staff_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

