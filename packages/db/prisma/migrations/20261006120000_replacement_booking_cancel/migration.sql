-- An exchange replacement package whose courier booking was cancelled
-- before collection keeps the exchange it belonged to, and the
-- cancellation's idempotency key (AO-D5 option B follow-up).
ALTER TABLE "order_fulfilments" ADD COLUMN "cancelledExchangeId" TEXT,
ADD COLUMN "bookingCancelKey" TEXT;

CREATE UNIQUE INDEX "order_fulfilments_bookingCancelKey_key" ON "order_fulfilments"("bookingCancelKey");
CREATE INDEX "order_fulfilments_cancelledExchangeId_idx" ON "order_fulfilments"("cancelledExchangeId");

ALTER TABLE "order_fulfilments" ADD CONSTRAINT "order_fulfilments_cancelledExchangeId_fkey" FOREIGN KEY ("cancelledExchangeId") REFERENCES "exchanges"("id") ON DELETE SET NULL ON UPDATE CASCADE;
