-- CreateEnum
CREATE TYPE "ShoppableMediaState" AS ENUM ('DRAFT', 'PENDING_MODERATION', 'SCHEDULED', 'PUBLISHED', 'UNPUBLISHED', 'REJECTED');

-- CreateTable
CREATE TABLE "shoppable_media" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "mediaUrl" TEXT NOT NULL,
    "thumbnailUrl" TEXT,
    "creatorAttribution" TEXT,
    "campaignRef" TEXT,
    "state" "ShoppableMediaState" NOT NULL DEFAULT 'DRAFT',
    "scheduledPublishAt" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "merchandisingPosition" INTEGER NOT NULL DEFAULT 0,
    "moderatedByStaffId" TEXT,
    "moderationNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shoppable_media_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shoppable_media_tags" (
    "id" TEXT NOT NULL,
    "shoppableMediaId" TEXT NOT NULL,
    "styleId" TEXT NOT NULL,
    "colourId" TEXT,
    "sizeId" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "shoppable_media_tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shoppable_media_events" (
    "id" TEXT NOT NULL,
    "shoppableMediaId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "actorType" "AuditActorType" NOT NULL DEFAULT 'CUSTOMER',
    "customerId" TEXT,
    "sessionRef" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shoppable_media_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "shoppable_media_state_merchandisingPosition_idx" ON "shoppable_media"("state", "merchandisingPosition");

-- CreateIndex
CREATE INDEX "shoppable_media_state_scheduledPublishAt_idx" ON "shoppable_media"("state", "scheduledPublishAt");

-- CreateIndex
CREATE INDEX "shoppable_media_tags_shoppableMediaId_idx" ON "shoppable_media_tags"("shoppableMediaId");

-- CreateIndex
CREATE UNIQUE INDEX "shoppable_media_tags_shoppableMediaId_styleId_colourId_key" ON "shoppable_media_tags"("shoppableMediaId", "styleId", "colourId");

-- CreateIndex
CREATE INDEX "shoppable_media_events_shoppableMediaId_eventType_idx" ON "shoppable_media_events"("shoppableMediaId", "eventType");

-- AddForeignKey
ALTER TABLE "shoppable_media" ADD CONSTRAINT "shoppable_media_moderatedByStaffId_fkey" FOREIGN KEY ("moderatedByStaffId") REFERENCES "staff_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shoppable_media_tags" ADD CONSTRAINT "shoppable_media_tags_shoppableMediaId_fkey" FOREIGN KEY ("shoppableMediaId") REFERENCES "shoppable_media"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shoppable_media_tags" ADD CONSTRAINT "shoppable_media_tags_styleId_fkey" FOREIGN KEY ("styleId") REFERENCES "styles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shoppable_media_tags" ADD CONSTRAINT "shoppable_media_tags_colourId_fkey" FOREIGN KEY ("colourId") REFERENCES "colours"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shoppable_media_tags" ADD CONSTRAINT "shoppable_media_tags_sizeId_fkey" FOREIGN KEY ("sizeId") REFERENCES "sizes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shoppable_media_events" ADD CONSTRAINT "shoppable_media_events_shoppableMediaId_fkey" FOREIGN KEY ("shoppableMediaId") REFERENCES "shoppable_media"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Hand-written CHECK constraints (same discipline as prior migrations).
ALTER TABLE "shoppable_media" ADD CONSTRAINT "shoppable_media_position_nonneg"
  CHECK ("merchandisingPosition" >= 0);
ALTER TABLE "shoppable_media_tags" ADD CONSTRAINT "shoppable_media_tags_sortOrder_nonneg"
  CHECK ("sortOrder" >= 0);

