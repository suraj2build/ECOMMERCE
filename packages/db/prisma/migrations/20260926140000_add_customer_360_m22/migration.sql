-- CreateEnum
CREATE TYPE "CommunicationChannel" AS ENUM ('SMS', 'WHATSAPP', 'EMAIL', 'PUSH');

-- CreateEnum
CREATE TYPE "CommunicationMessageType" AS ENUM ('ORDER_UPDATES', 'OFFERS_AND_PROMOTIONS', 'PRODUCT_RECOMMENDATIONS', 'NEWSLETTER');

-- AlterTable
ALTER TABLE "audit_logs" ADD COLUMN     "actorCustomerId" TEXT;

-- CreateTable
CREATE TABLE "customer_addresses" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "label" TEXT,
    "recipientName" TEXT NOT NULL,
    "recipientMobile" TEXT NOT NULL,
    "line1" TEXT NOT NULL,
    "line2" TEXT,
    "landmark" TEXT,
    "city" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "stateCode" TEXT NOT NULL,
    "pincode" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customer_addresses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recently_viewed_products" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "styleId" TEXT NOT NULL,
    "viewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recently_viewed_products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_saved_sizes" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "sizeId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customer_saved_sizes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "communication_preferences" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "channel" "CommunicationChannel" NOT NULL,
    "messageType" "CommunicationMessageType" NOT NULL,
    "optedIn" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "communication_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "customer_addresses_customerId_idx" ON "customer_addresses"("customerId");

-- CreateIndex
CREATE INDEX "recently_viewed_products_customerId_viewedAt_idx" ON "recently_viewed_products"("customerId", "viewedAt");

-- CreateIndex
CREATE UNIQUE INDEX "recently_viewed_products_customerId_styleId_key" ON "recently_viewed_products"("customerId", "styleId");

-- CreateIndex
CREATE UNIQUE INDEX "customer_saved_sizes_customerId_categoryId_key" ON "customer_saved_sizes"("customerId", "categoryId");

-- CreateIndex
CREATE UNIQUE INDEX "communication_preferences_customerId_channel_messageType_key" ON "communication_preferences"("customerId", "channel", "messageType");

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actorCustomerId_fkey" FOREIGN KEY ("actorCustomerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_addresses" ADD CONSTRAINT "customer_addresses_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recently_viewed_products" ADD CONSTRAINT "recently_viewed_products_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recently_viewed_products" ADD CONSTRAINT "recently_viewed_products_styleId_fkey" FOREIGN KEY ("styleId") REFERENCES "styles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_saved_sizes" ADD CONSTRAINT "customer_saved_sizes_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_saved_sizes" ADD CONSTRAINT "customer_saved_sizes_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_saved_sizes" ADD CONSTRAINT "customer_saved_sizes_sizeId_fkey" FOREIGN KEY ("sizeId") REFERENCES "sizes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "communication_preferences" ADD CONSTRAINT "communication_preferences_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Exactly one default address per customer. Prisma's schema DSL has no
-- partial-index syntax, so this genuine database-level invariant is
-- expressed here as raw SQL (the same discipline already used elsewhere
-- in this codebase for constraints the Prisma schema itself cannot
-- express - see the M16/M21 XOR CHECK constraints and trigger pairs).
-- A concurrent "set this address as default" request necessarily
-- serializes on this index (a second commit attempting isDefault=true
-- for a different address of the SAME customer while one already exists
-- violates it), so CustomerProfileService.setDefaultAddress's own
-- transactional "unset old, set new" pattern is backed by a real
-- database guarantee, not just careful application code.
CREATE UNIQUE INDEX "customer_addresses_one_default_per_customer"
  ON "customer_addresses" ("customerId")
  WHERE "isDefault" = true;

