-- Staff management (AO-D7): temporary passwords that must be changed, and
-- a per-user cut-off that invalidates every earlier session.
ALTER TABLE "staff_users" ADD COLUMN "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "passwordChangedAt" TIMESTAMP(3),
ADD COLUMN "sessionsRevokedAt" TIMESTAMP(3);
