-- M18 (specs/17-cancellation.md, approved 2026-09-22): "Cancellation
-- reason capture is optional (recommended, not mandatory)". The M15
-- constraint below (from 20260923160242_add_order_management)
-- predates that decision and required a non-null cancelledReason
-- whenever status = 'CANCELLED', which is stricter than the now-
-- approved spec. Replaced with a constraint that keeps every other
-- invariant (cancelledAt set iff CANCELLED; cancelledReason never set
-- on a non-cancelled line) while allowing cancelledReason to be null
-- on a cancelled line.

ALTER TABLE "order_lines" DROP CONSTRAINT "order_lines_cancelled_fields_check";

ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_cancelled_fields_check"
  CHECK (
    ("status" = 'CANCELLED' AND "cancelledAt" IS NOT NULL)
    OR ("status" != 'CANCELLED' AND "cancelledAt" IS NULL AND "cancelledReason" IS NULL)
  );
