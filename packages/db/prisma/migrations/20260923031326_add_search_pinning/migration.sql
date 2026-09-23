-- AlterTable
ALTER TABLE "styles" ADD COLUMN     "searchPinned" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "searchPinnedAt" TIMESTAMP(3);
