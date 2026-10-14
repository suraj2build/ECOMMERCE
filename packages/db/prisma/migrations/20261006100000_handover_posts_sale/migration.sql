-- AO-D5 option B (Product Owner, 2026-10-06): booking reserves the parcel;
-- the handover posts the sale, marks it shipped and sends the message.
-- Packages booked before this change keep their SHIPPED status and posted
-- sale; nothing is back-dated or re-posted.
ALTER TYPE "FulfilmentStatus" ADD VALUE 'BOOKED' BEFORE 'SHIPPED';
ALTER TYPE "FulfilmentStatus" ADD VALUE 'CANCELLED';
ALTER TYPE "ShipmentTrackingStatus" ADD VALUE 'CANCELLED';

ALTER TABLE "shipments"
  ADD COLUMN "bookingCancelledAt" TIMESTAMP(3),
  ADD COLUMN "bookingCancelledByStaffId" TEXT,
  ADD COLUMN "bookingCancellationReference" TEXT;
