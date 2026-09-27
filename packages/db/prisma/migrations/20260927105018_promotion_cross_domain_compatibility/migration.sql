-- AlterTable
ALTER TABLE "promotions" ADD COLUMN     "loyaltyCompatible" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "storeCreditCompatible" BOOLEAN NOT NULL DEFAULT true;
