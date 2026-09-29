-- AlterTable
ALTER TABLE "channel_listings" ADD COLUMN     "currentOperationId" TEXT;

-- AlterTable
ALTER TABLE "channel_publication_attempts" ADD COLUMN     "operationId" TEXT;
