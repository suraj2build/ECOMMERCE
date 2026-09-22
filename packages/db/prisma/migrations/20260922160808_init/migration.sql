-- CreateEnum
CREATE TYPE "LocationType" AS ENUM ('WAREHOUSE', 'STORE');

-- CreateEnum
CREATE TYPE "AuditActorType" AS ENUM ('STAFF', 'CUSTOMER', 'SYSTEM');

-- CreateEnum
CREATE TYPE "StyleLifecycleState" AS ENUM ('DRAFT', 'READY_FOR_ENRICHMENT', 'READY_FOR_QA', 'PUBLISHED', 'UNPUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "MediaType" AS ENUM ('IMAGE', 'VIDEO');

-- CreateEnum
CREATE TYPE "SupplierType" AS ENUM ('FINISHED_GOODS', 'MANUFACTURING');

-- CreateEnum
CREATE TYPE "PurchaseOrderStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'PARTIALLY_RECEIVED', 'FULLY_RECEIVED', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "POApprovalAction" AS ENUM ('SUBMITTED', 'APPROVED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "GoodsReceiptStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "QcResult" AS ENUM ('PASS', 'FAIL', 'PARTIAL');

-- CreateEnum
CREATE TYPE "InventoryTxnType" AS ENUM ('RECEIPT', 'QC_FAIL', 'RESERVATION', 'RESERVATION_RELEASE', 'ALLOCATION', 'SALE', 'CANCELLATION', 'RETURN_RECEIVED', 'RETURN_QC_PASS', 'RETURN_QC_FAIL', 'EXCHANGE_RELEASE', 'EXCHANGE_RESERVE', 'RTO', 'ADJUSTMENT', 'TRANSFER_OUT', 'TRANSFER_IN');

-- CreateEnum
CREATE TYPE "ReservationStatus" AS ENUM ('ACTIVE', 'CONVERTED', 'RELEASED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "TransferStatus" AS ENUM ('IN_TRANSIT', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "BadgeType" AS ENUM ('NEW_ARRIVAL', 'BESTSELLER', 'SALE', 'MARKDOWN');

-- CreateEnum
CREATE TYPE "BadgeSource" AS ENUM ('RULE', 'MANUAL');

-- CreateTable
CREATE TABLE "brands" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "brands_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "locations" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "LocationType" NOT NULL DEFAULT 'WAREHOUSE',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "addressLine1" TEXT,
    "addressLine2" TEXT,
    "city" TEXT,
    "state" TEXT,
    "pinCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customers" (
    "id" TEXT NOT NULL,
    "mobile" TEXT NOT NULL,
    "email" TEXT,
    "fullName" TEXT,
    "mobileVerifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "otp_codes" (
    "id" TEXT NOT NULL,
    "mobile" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "purpose" TEXT NOT NULL DEFAULT 'LOGIN',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "otp_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_refresh_tokens" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff_users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "mfaEnabled" BOOLEAN NOT NULL DEFAULT false,
    "mfaSecret" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "staff_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff_sessions" (
    "id" TEXT NOT NULL,
    "staffUserId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "staff_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permissions" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "description" TEXT,

    CONSTRAINT "permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "roleId" TEXT NOT NULL,
    "permissionId" TEXT NOT NULL,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("roleId","permissionId")
);

-- CreateTable
CREATE TABLE "staff_user_roles" (
    "staffUserId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,

    CONSTRAINT "staff_user_roles_pkey" PRIMARY KEY ("staffUserId","roleId")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "actorType" "AuditActorType" NOT NULL,
    "actorStaffId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "oldValue" JSONB,
    "newValue" JSONB,
    "reference" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "categories" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "parentId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "styles" (
    "id" TEXT NOT NULL,
    "styleCode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "department" TEXT,
    "gender" TEXT,
    "division" TEXT,
    "subcategory" TEXT,
    "season" TEXT NOT NULL,
    "collection" TEXT NOT NULL,
    "fabric" TEXT,
    "fit" TEXT,
    "pattern" TEXT,
    "occasion" TEXT,
    "sleeve" TEXT,
    "neck" TEXT,
    "washCare" TEXT,
    "countryOfOrigin" TEXT,
    "hsnCode" TEXT,
    "customAttributes" JSONB,
    "lifecycleState" "StyleLifecycleState" NOT NULL DEFAULT 'DRAFT',
    "qaPassedAt" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "publishedByStaffId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "styles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "colours" (
    "id" TEXT NOT NULL,
    "styleId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "colourCode" TEXT NOT NULL,
    "hexSwatch" TEXT,

    CONSTRAINT "colours_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sizes" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "sizes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "size_charts" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT,
    "gender" TEXT,
    "brandId" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveTo" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "size_charts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "size_chart_entries" (
    "id" TEXT NOT NULL,
    "sizeChartId" TEXT NOT NULL,
    "sizeLabel" TEXT NOT NULL,
    "measurements" JSONB NOT NULL,

    CONSTRAINT "size_chart_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "skus" (
    "id" TEXT NOT NULL,
    "skuCode" TEXT NOT NULL,
    "barcode" TEXT,
    "styleId" TEXT NOT NULL,
    "colourId" TEXT NOT NULL,
    "sizeId" TEXT NOT NULL,
    "sizeChartId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "skus_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_media" (
    "id" TEXT NOT NULL,
    "styleId" TEXT NOT NULL,
    "colourId" TEXT,
    "url" TEXT NOT NULL,
    "type" "MediaType" NOT NULL DEFAULT 'IMAGE',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "altText" TEXT,
    "isSwatch" BOOLEAN NOT NULL DEFAULT false,
    "seoMetadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_media_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "suppliers" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "SupplierType" NOT NULL,
    "contactName" TEXT,
    "contactEmail" TEXT,
    "contactPhone" TEXT,
    "paymentTerms" TEXT,
    "leadTimeDays" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_skus" (
    "id" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "skuId" TEXT NOT NULL,
    "styleId" TEXT NOT NULL,
    "cost" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "isPreferred" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supplier_skus_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_orders" (
    "id" TEXT NOT NULL,
    "poNumber" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "status" "PurchaseOrderStatus" NOT NULL DEFAULT 'DRAFT',
    "submittedByStaffId" TEXT,
    "approvedByStaffId" TEXT,
    "approvalThresholdApplied" DECIMAL(12,2),
    "totalCost" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "expectedDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "purchase_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_order_lines" (
    "id" TEXT NOT NULL,
    "poId" TEXT NOT NULL,
    "skuId" TEXT NOT NULL,
    "orderedQty" INTEGER NOT NULL,
    "unitCost" DECIMAL(12,2) NOT NULL,
    "receivedQty" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "purchase_order_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_order_approvals" (
    "id" TEXT NOT NULL,
    "poId" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "action" "POApprovalAction" NOT NULL,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "purchase_order_approvals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "goods_receipts" (
    "id" TEXT NOT NULL,
    "grnNumber" TEXT NOT NULL,
    "poId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "receivedByStaffId" TEXT NOT NULL,
    "status" "GoodsReceiptStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "goods_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "goods_receipt_lines" (
    "id" TEXT NOT NULL,
    "grnId" TEXT NOT NULL,
    "poLineId" TEXT NOT NULL,
    "skuId" TEXT NOT NULL,
    "expectedQty" INTEGER NOT NULL,
    "receivedQty" INTEGER NOT NULL,
    "acceptedQty" INTEGER NOT NULL DEFAULT 0,
    "shortQty" INTEGER NOT NULL DEFAULT 0,
    "excessQty" INTEGER NOT NULL DEFAULT 0,
    "damagedQty" INTEGER NOT NULL DEFAULT 0,
    "rejectedQty" INTEGER NOT NULL DEFAULT 0,
    "qcResult" "QcResult" NOT NULL,
    "qcNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "goods_receipt_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_transactions" (
    "id" TEXT NOT NULL,
    "skuId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "type" "InventoryTxnType" NOT NULL,
    "quantity" INTEGER NOT NULL,
    "referenceType" TEXT,
    "referenceId" TEXT,
    "reason" TEXT,
    "idempotencyKey" TEXT,
    "actorType" "AuditActorType" NOT NULL DEFAULT 'SYSTEM',
    "actorStaffId" TEXT,
    "coApproverStaffId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_balances" (
    "skuId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "onHand" INTEGER NOT NULL DEFAULT 0,
    "reserved" INTEGER NOT NULL DEFAULT 0,
    "damaged" INTEGER NOT NULL DEFAULT 0,
    "returnPending" INTEGER NOT NULL DEFAULT 0,
    "inTransit" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inventory_balances_pkey" PRIMARY KEY ("skuId","locationId")
);

-- CreateTable
CREATE TABLE "inventory_reservations" (
    "id" TEXT NOT NULL,
    "skuId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "status" "ReservationStatus" NOT NULL DEFAULT 'ACTIVE',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "referenceType" TEXT,
    "referenceId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inventory_reservations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_transfers" (
    "id" TEXT NOT NULL,
    "skuId" TEXT NOT NULL,
    "fromLocationId" TEXT NOT NULL,
    "toLocationId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "status" "TransferStatus" NOT NULL DEFAULT 'IN_TRANSIT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "inventory_transfers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prices" (
    "id" TEXT NOT NULL,
    "styleId" TEXT NOT NULL,
    "colourId" TEXT,
    "mrp" DECIMAL(12,2) NOT NULL,
    "sellingPrice" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "isMarkdown" BOOLEAN NOT NULL DEFAULT false,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveTo" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "prices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "collections" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "collections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "collection_styles" (
    "collectionId" TEXT NOT NULL,
    "styleId" TEXT NOT NULL,

    CONSTRAINT "collection_styles_pkey" PRIMARY KEY ("collectionId","styleId")
);

-- CreateTable
CREATE TABLE "merchandise_badges" (
    "id" TEXT NOT NULL,
    "styleId" TEXT NOT NULL,
    "badgeType" "BadgeType" NOT NULL,
    "source" "BadgeSource" NOT NULL DEFAULT 'RULE',
    "startsAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endsAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "merchandise_badges_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "brands_code_key" ON "brands"("code");

-- CreateIndex
CREATE UNIQUE INDEX "locations_code_key" ON "locations"("code");

-- CreateIndex
CREATE UNIQUE INDEX "customers_mobile_key" ON "customers"("mobile");

-- CreateIndex
CREATE INDEX "otp_codes_mobile_consumedAt_idx" ON "otp_codes"("mobile", "consumedAt");

-- CreateIndex
CREATE UNIQUE INDEX "customer_refresh_tokens_tokenHash_key" ON "customer_refresh_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "customer_refresh_tokens_customerId_idx" ON "customer_refresh_tokens"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "staff_users_email_key" ON "staff_users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "staff_sessions_tokenHash_key" ON "staff_sessions"("tokenHash");

-- CreateIndex
CREATE INDEX "staff_sessions_staffUserId_idx" ON "staff_sessions"("staffUserId");

-- CreateIndex
CREATE UNIQUE INDEX "roles_key_key" ON "roles"("key");

-- CreateIndex
CREATE UNIQUE INDEX "permissions_key_key" ON "permissions"("key");

-- CreateIndex
CREATE INDEX "audit_logs_entityType_entityId_idx" ON "audit_logs"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "audit_logs_action_idx" ON "audit_logs"("action");

-- CreateIndex
CREATE UNIQUE INDEX "categories_slug_key" ON "categories"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "styles_styleCode_key" ON "styles"("styleCode");

-- CreateIndex
CREATE INDEX "styles_lifecycleState_idx" ON "styles"("lifecycleState");

-- CreateIndex
CREATE INDEX "styles_brandId_idx" ON "styles"("brandId");

-- CreateIndex
CREATE INDEX "styles_categoryId_idx" ON "styles"("categoryId");

-- CreateIndex
CREATE UNIQUE INDEX "colours_styleId_colourCode_key" ON "colours"("styleId", "colourCode");

-- CreateIndex
CREATE UNIQUE INDEX "sizes_label_key" ON "sizes"("label");

-- CreateIndex
CREATE UNIQUE INDEX "skus_skuCode_key" ON "skus"("skuCode");

-- CreateIndex
CREATE UNIQUE INDEX "skus_barcode_key" ON "skus"("barcode");

-- CreateIndex
CREATE INDEX "skus_styleId_idx" ON "skus"("styleId");

-- CreateIndex
CREATE UNIQUE INDEX "skus_styleId_colourId_sizeId_key" ON "skus"("styleId", "colourId", "sizeId");

-- CreateIndex
CREATE INDEX "product_media_styleId_idx" ON "product_media"("styleId");

-- CreateIndex
CREATE UNIQUE INDEX "suppliers_code_key" ON "suppliers"("code");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_skus_supplierId_skuId_key" ON "supplier_skus"("supplierId", "skuId");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_orders_poNumber_key" ON "purchase_orders"("poNumber");

-- CreateIndex
CREATE INDEX "purchase_orders_status_idx" ON "purchase_orders"("status");

-- CreateIndex
CREATE INDEX "purchase_orders_supplierId_idx" ON "purchase_orders"("supplierId");

-- CreateIndex
CREATE INDEX "purchase_order_lines_poId_idx" ON "purchase_order_lines"("poId");

-- CreateIndex
CREATE INDEX "purchase_order_approvals_poId_idx" ON "purchase_order_approvals"("poId");

-- CreateIndex
CREATE UNIQUE INDEX "goods_receipts_grnNumber_key" ON "goods_receipts"("grnNumber");

-- CreateIndex
CREATE INDEX "goods_receipts_poId_idx" ON "goods_receipts"("poId");

-- CreateIndex
CREATE INDEX "goods_receipt_lines_grnId_idx" ON "goods_receipt_lines"("grnId");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_transactions_idempotencyKey_key" ON "inventory_transactions"("idempotencyKey");

-- CreateIndex
CREATE INDEX "inventory_transactions_skuId_locationId_idx" ON "inventory_transactions"("skuId", "locationId");

-- CreateIndex
CREATE INDEX "inventory_transactions_type_idx" ON "inventory_transactions"("type");

-- CreateIndex
CREATE INDEX "inventory_transactions_referenceType_referenceId_idx" ON "inventory_transactions"("referenceType", "referenceId");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_reservations_idempotencyKey_key" ON "inventory_reservations"("idempotencyKey");

-- CreateIndex
CREATE INDEX "inventory_reservations_skuId_locationId_status_idx" ON "inventory_reservations"("skuId", "locationId", "status");

-- CreateIndex
CREATE INDEX "inventory_reservations_status_expiresAt_idx" ON "inventory_reservations"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "prices_styleId_effectiveFrom_effectiveTo_idx" ON "prices"("styleId", "effectiveFrom", "effectiveTo");

-- CreateIndex
CREATE UNIQUE INDEX "collections_slug_key" ON "collections"("slug");

-- CreateIndex
CREATE INDEX "merchandise_badges_styleId_idx" ON "merchandise_badges"("styleId");

-- AddForeignKey
ALTER TABLE "customer_refresh_tokens" ADD CONSTRAINT "customer_refresh_tokens_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_sessions" ADD CONSTRAINT "staff_sessions_staffUserId_fkey" FOREIGN KEY ("staffUserId") REFERENCES "staff_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "permissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_user_roles" ADD CONSTRAINT "staff_user_roles_staffUserId_fkey" FOREIGN KEY ("staffUserId") REFERENCES "staff_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_user_roles" ADD CONSTRAINT "staff_user_roles_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actorStaffId_fkey" FOREIGN KEY ("actorStaffId") REFERENCES "staff_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "categories" ADD CONSTRAINT "categories_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "styles" ADD CONSTRAINT "styles_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "brands"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "styles" ADD CONSTRAINT "styles_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "styles" ADD CONSTRAINT "styles_publishedByStaffId_fkey" FOREIGN KEY ("publishedByStaffId") REFERENCES "staff_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "colours" ADD CONSTRAINT "colours_styleId_fkey" FOREIGN KEY ("styleId") REFERENCES "styles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "size_chart_entries" ADD CONSTRAINT "size_chart_entries_sizeChartId_fkey" FOREIGN KEY ("sizeChartId") REFERENCES "size_charts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "skus" ADD CONSTRAINT "skus_styleId_fkey" FOREIGN KEY ("styleId") REFERENCES "styles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "skus" ADD CONSTRAINT "skus_colourId_fkey" FOREIGN KEY ("colourId") REFERENCES "colours"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "skus" ADD CONSTRAINT "skus_sizeId_fkey" FOREIGN KEY ("sizeId") REFERENCES "sizes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "skus" ADD CONSTRAINT "skus_sizeChartId_fkey" FOREIGN KEY ("sizeChartId") REFERENCES "size_charts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_media" ADD CONSTRAINT "product_media_styleId_fkey" FOREIGN KEY ("styleId") REFERENCES "styles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_media" ADD CONSTRAINT "product_media_colourId_fkey" FOREIGN KEY ("colourId") REFERENCES "colours"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_skus" ADD CONSTRAINT "supplier_skus_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_skus" ADD CONSTRAINT "supplier_skus_skuId_fkey" FOREIGN KEY ("skuId") REFERENCES "skus"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_skus" ADD CONSTRAINT "supplier_skus_styleId_fkey" FOREIGN KEY ("styleId") REFERENCES "styles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_submittedByStaffId_fkey" FOREIGN KEY ("submittedByStaffId") REFERENCES "staff_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_approvedByStaffId_fkey" FOREIGN KEY ("approvedByStaffId") REFERENCES "staff_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_poId_fkey" FOREIGN KEY ("poId") REFERENCES "purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_skuId_fkey" FOREIGN KEY ("skuId") REFERENCES "skus"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_approvals" ADD CONSTRAINT "purchase_order_approvals_poId_fkey" FOREIGN KEY ("poId") REFERENCES "purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_approvals" ADD CONSTRAINT "purchase_order_approvals_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "staff_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_poId_fkey" FOREIGN KEY ("poId") REFERENCES "purchase_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_receivedByStaffId_fkey" FOREIGN KEY ("receivedByStaffId") REFERENCES "staff_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_grnId_fkey" FOREIGN KEY ("grnId") REFERENCES "goods_receipts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_poLineId_fkey" FOREIGN KEY ("poLineId") REFERENCES "purchase_order_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_skuId_fkey" FOREIGN KEY ("skuId") REFERENCES "skus"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_transactions" ADD CONSTRAINT "inventory_transactions_skuId_fkey" FOREIGN KEY ("skuId") REFERENCES "skus"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_transactions" ADD CONSTRAINT "inventory_transactions_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_transactions" ADD CONSTRAINT "inventory_transactions_actorStaffId_fkey" FOREIGN KEY ("actorStaffId") REFERENCES "staff_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_transactions" ADD CONSTRAINT "inventory_transactions_coApproverStaffId_fkey" FOREIGN KEY ("coApproverStaffId") REFERENCES "staff_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_balances" ADD CONSTRAINT "inventory_balances_skuId_fkey" FOREIGN KEY ("skuId") REFERENCES "skus"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_balances" ADD CONSTRAINT "inventory_balances_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_reservations" ADD CONSTRAINT "inventory_reservations_skuId_fkey" FOREIGN KEY ("skuId") REFERENCES "skus"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_transfers" ADD CONSTRAINT "inventory_transfers_skuId_fkey" FOREIGN KEY ("skuId") REFERENCES "skus"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_transfers" ADD CONSTRAINT "inventory_transfers_fromLocationId_fkey" FOREIGN KEY ("fromLocationId") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_transfers" ADD CONSTRAINT "inventory_transfers_toLocationId_fkey" FOREIGN KEY ("toLocationId") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prices" ADD CONSTRAINT "prices_styleId_fkey" FOREIGN KEY ("styleId") REFERENCES "styles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prices" ADD CONSTRAINT "prices_colourId_fkey" FOREIGN KEY ("colourId") REFERENCES "colours"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collection_styles" ADD CONSTRAINT "collection_styles_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "collections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collection_styles" ADD CONSTRAINT "collection_styles_styleId_fkey" FOREIGN KEY ("styleId") REFERENCES "styles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "merchandise_badges" ADD CONSTRAINT "merchandise_badges_styleId_fkey" FOREIGN KEY ("styleId") REFERENCES "styles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
