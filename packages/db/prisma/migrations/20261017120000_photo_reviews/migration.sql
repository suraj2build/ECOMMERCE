-- Photo reviews + "What Our Customers Say" homepage carousel (specs/36).
-- A photo auto-publishes with its review, same as review text - no new
-- publish-state machine. featuredOnHome/featuredSortOrder are staff-set
-- only (review:moderate); a photo existing never implies homepage
-- placement.
ALTER TABLE "reviews" ADD COLUMN "photoKey" TEXT,
ADD COLUMN "photoConsentAt" TIMESTAMP(3),
ADD COLUMN "featuredOnHome" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "featuredSortOrder" INTEGER;

CREATE INDEX "reviews_featuredOnHome_featuredSortOrder_idx" ON "reviews"("featuredOnHome", "featuredSortOrder");
