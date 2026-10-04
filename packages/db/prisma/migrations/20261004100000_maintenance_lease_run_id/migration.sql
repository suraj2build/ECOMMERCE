-- LR-006 review: a lease records the id of its run, so a run that was recorded but whose release failed is not mistaken for a crash.
-- AlterTable
ALTER TABLE "maintenance_job_states" ADD COLUMN     "currentRunId" TEXT;
