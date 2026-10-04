-- LR-009: confirmed COD cash collection per order; recording it queues the COD purchase event.
-- CreateTable
CREATE TABLE "cod_collections" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "collectedAt" TIMESTAMP(3) NOT NULL,
    "reference" TEXT NOT NULL,
    "recordedByStaffId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cod_collections_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "cod_collections_orderId_key" ON "cod_collections"("orderId");

-- AddForeignKey
ALTER TABLE "cod_collections" ADD CONSTRAINT "cod_collections_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Collected cash is always a positive amount.
ALTER TABLE "cod_collections" ADD CONSTRAINT "cod_collections_amount_positive_check" CHECK ("amount" > 0);

-- LR-009: Finance records COD collections. An existing database gets the new
-- permission granted to the roles the seed grants it to, so an upgrade needs
-- no re-seed. A fresh database has no roles yet; the seed creates them.
INSERT INTO "permissions" ("id", "key")
VALUES (gen_random_uuid()::text, 'payment:cod:collect')
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "role_permissions" ("roleId", "permissionId")
SELECT r."id", p."id"
FROM "roles" r
JOIN "permissions" p ON p."key" = 'payment:cod:collect'
WHERE r."key" IN ('SUPER_ADMIN', 'FINANCE')
ON CONFLICT DO NOTHING;
