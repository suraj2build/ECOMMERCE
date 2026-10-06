-- Cancel booking and rebook (order packages): the package keeps a marker that
-- its items were released to be packed and booked again, not cancelled.
ALTER TABLE "order_fulfilments" ADD COLUMN "releasedForRebook" BOOLEAN NOT NULL DEFAULT false;
