-- LR-006: scheduled sweep run history; channel attempts may be made by the scheduler (no staff actor).
-- CreateEnum
CREATE TYPE "MaintenanceJobOutcome" AS ENUM ('SUCCESS', 'FAILURE');

-- AlterTable
ALTER TABLE "channel_publication_attempts" ALTER COLUMN "actorStaffId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "maintenance_job_runs" (
    "id" TEXT NOT NULL,
    "job" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3) NOT NULL,
    "outcome" "MaintenanceJobOutcome" NOT NULL,
    "result" JSONB,
    "error" TEXT,

    CONSTRAINT "maintenance_job_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "maintenance_job_runs_job_startedAt_idx" ON "maintenance_job_runs"("job", "startedAt");

-- CreateIndex
CREATE INDEX "maintenance_job_runs_startedAt_idx" ON "maintenance_job_runs"("startedAt");

