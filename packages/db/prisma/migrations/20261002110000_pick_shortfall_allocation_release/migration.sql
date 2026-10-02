-- P1 inventory hardening (2026-10-02): preserve the original reservation
-- quantity while tracking committed allocation units explicitly released by
-- warehouse short-pick/exception handling or later cancellation.
--
-- Existing rows default to zero. This is deliberately correct for historical
-- pre-hardening pick exceptions: those code paths reduced onHand but did NOT
-- release reserved quantity, so their reservation still retained its full
-- allocation. No historical quantity is guessed or rewritten.

ALTER TABLE "inventory_reservations"
  ADD COLUMN "allocationReleasedQuantity" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "inventory_reservations"
  ADD CONSTRAINT "inventory_reservations_allocation_released_bounds"
  CHECK (
    "allocationReleasedQuantity" >= 0
    AND "allocationReleasedQuantity" <= "quantity"
  );
