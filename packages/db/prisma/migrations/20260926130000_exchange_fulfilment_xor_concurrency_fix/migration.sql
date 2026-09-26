-- EXC-004 concurrency repair (2026-09-26, final independent review).
--
-- The trigger pair added in migration 20260926120000 enforced the
-- OrderFulfilment source-exclusivity invariant (exchangeId XOR child
-- order_lines) using a PLAIN SELECT of the other side's row, with no
-- lock. Under READ COMMITTED (Postgres's default, and this project's
-- own), a plain SELECT reads a snapshot as of the start of its own
-- statement and does NOT block on, or wait for, a concurrent
-- transaction's uncommitted write to that same row - it simply does
-- not see it yet. That admits a genuine write-skew race:
--
--   Transaction A: UPDATE order_fulfilments SET "exchangeId" = X
--                  WHERE "id" = F
--                  -> trigger SELECTs order_lines WHERE
--                     "fulfilmentId" = F -> sees 0 (B not committed)
--   Transaction B (concurrent): UPDATE order_lines SET "fulfilmentId"
--                  = F WHERE "id" = L
--                  -> trigger SELECTs order_fulfilments."exchangeId"
--                     WHERE "id" = F -> sees NULL (A not committed)
--
-- Both triggers pass, both transactions commit, and the row F now
-- illegally carries BOTH a populated exchangeId AND a child
-- order_line - exactly the state this trigger pair exists to prevent.
-- Ordinary SELECTs are not themselves a shared serialization point;
-- this was a genuine gap in the original design, not merely a
-- theoretical one - closed here, not merely re-described.
--
-- Fix: give both directions a SHARED serialization point - the SAME
-- order_fulfilments row's own lock.
--
--  - An UPDATE (or INSERT) targeting order_fulfilments already
--    implicitly holds that row's lock for the rest of its own
--    transaction (Postgres locks a row as part of writing it, before
--    its BEFORE ROW trigger fires) - so
--    check_exchange_fulfilment_exclusivity (which fires ON that exact
--    statement) needs no change at all; it already runs holding the
--    lock this fix relies on.
--  - check_fulfilment_line_exclusivity (which fires on order_lines, a
--    DIFFERENT table, and therefore holds no lock on order_fulfilments
--    of its own accord) now explicitly does
--    `SELECT ... FOR UPDATE` on the target order_fulfilments row
--    BEFORE reading its exchangeId - acquiring the identical row lock
--    the other direction already holds for free.
--
-- With both directions gated on the SAME row lock, whichever
-- transaction reaches Postgres first (in either direction) forces the
-- other to block until it commits or rolls back, then re-read the
-- row's now-committed, true state through the very same lock - never
-- a blind, pre-commit snapshot. Whichever transaction wins commits
-- cleanly; the loser's trigger now correctly observes the winner's
-- change and raises its exception, rolling back. Proven under REAL
-- concurrent transactions (not sequential simulation), repeated many
-- times, in
-- services/commerce-api/test/integration/exchange-fulfilment-xor-race.test.ts.
--
-- No schema/column/index change - this migration only replaces the
-- trigger function's body (CREATE OR REPLACE FUNCTION reuses the
-- existing trigger, which references the function by name).
CREATE OR REPLACE FUNCTION check_fulfilment_line_exclusivity() RETURNS TRIGGER AS $$
DECLARE
  fulfilment_exchange_id TEXT;
BEGIN
  IF NEW."fulfilmentId" IS NOT NULL THEN
    SELECT "exchangeId" INTO fulfilment_exchange_id FROM "order_fulfilments" WHERE "id" = NEW."fulfilmentId" FOR UPDATE;
    IF fulfilment_exchange_id IS NOT NULL THEN
      RAISE EXCEPTION 'order_lines.fulfilmentId (%) cannot reference an exchange-anchored OrderFulfilment (exchangeId %)', NEW."fulfilmentId", fulfilment_exchange_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
