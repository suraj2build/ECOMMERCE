-- CreateEnum
CREATE TYPE "ChannelListingStatus" AS ENUM ('NOT_PUBLISHED', 'PUBLISHED', 'FAILED');

-- CreateEnum
CREATE TYPE "ChannelPublicationAction" AS ENUM ('PUBLISH', 'UNPUBLISH');

-- CreateEnum
CREATE TYPE "ChannelPublicationAttemptStatus" AS ENUM ('SUCCESS', 'FAILURE');

-- CreateTable
CREATE TABLE "channels" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "providerName" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "config" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "channels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "channel_listings" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "skuId" TEXT NOT NULL,
    "status" "ChannelListingStatus" NOT NULL DEFAULT 'NOT_PUBLISHED',
    "externalId" TEXT,
    "lastSyncedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "payloadSnapshot" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "channel_listings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "channel_publication_attempts" (
    "id" TEXT NOT NULL,
    "channelListingId" TEXT NOT NULL,
    "action" "ChannelPublicationAction" NOT NULL,
    "status" "ChannelPublicationAttemptStatus" NOT NULL,
    "requestPayload" JSONB,
    "responsePayload" JSONB,
    "errorMessage" TEXT,
    "actorStaffId" TEXT NOT NULL,
    "attemptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "channel_publication_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "channels_key_key" ON "channels"("key");

-- CreateIndex
CREATE INDEX "channel_listings_skuId_idx" ON "channel_listings"("skuId");

-- CreateIndex
CREATE UNIQUE INDEX "channel_listings_channelId_skuId_key" ON "channel_listings"("channelId", "skuId");

-- CreateIndex
CREATE INDEX "channel_publication_attempts_channelListingId_idx" ON "channel_publication_attempts"("channelListingId");

-- AddForeignKey
ALTER TABLE "channel_listings" ADD CONSTRAINT "channel_listings_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "channels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channel_listings" ADD CONSTRAINT "channel_listings_skuId_fkey" FOREIGN KEY ("skuId") REFERENCES "skus"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channel_publication_attempts" ADD CONSTRAINT "channel_publication_attempts_channelListingId_fkey" FOREIGN KEY ("channelListingId") REFERENCES "channel_listings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channel_publication_attempts" ADD CONSTRAINT "channel_publication_attempts_actorStaffId_fkey" FOREIGN KEY ("actorStaffId") REFERENCES "staff_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

