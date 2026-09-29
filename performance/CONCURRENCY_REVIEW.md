# Concurrency Proof Re-Run / Extension (M32 Performance/Scale, 6C)

## Method

Re-ran the complete backend integration suite (682 tests across 46
files) against real Postgres/Redis/Meilisearch - not a subset, and not
simulated concurrency: every genuine `Promise.all`-based concurrency
test already established across M06/M13/M14/M15/M17/M18/M19/M20/M21/
M22/M23/M24/M25/M26/M30 (oversell prevention, payment capture races,
shipment-creation idempotency, cancel-vs-pick lock ordering, refund
claim-before-external-call, return/exchange mutual exclusion,
address-book zero-row races, loyalty checkout double-spend, promotion
single-use-coupon races, campaign due-sweep races, channel-listing
publish/unpublish races, gift-card redemption races) re-ran together in
one pass, exactly as `acceptance/m33-e2e-certification.md`'s own
"cross-domain integrity holds under combined load" requirement and this
milestone's "concurrency proof re-run/extension" both call for.

## Result: one genuine failure found, investigated to root cause, fixed
## - not dismissed as a flake

**`exchange-fulfilment-xor-race.test.ts`'s 16-iteration test
(`a genuinely concurrent exchangeId-set and order_line-attach on the
SAME empty fulfilment converge to exactly one winner, never both,
repeated many times`) timed out at exactly the 30s default
`testTimeout`, in the full-suite run AND in three subsequent isolated
re-runs of that one file alone** (including one with every other
process this session had started - the dev API server, the storefront
production server - stopped first, to rule out this session's own
resource contention as the cause).

**Investigated with concrete evidence, per this project's binding
discipline against guessing "environmental":**

1. The file's OTHER two tests (8 iterations each, the identical race
   logic under each FIXED interleaving) passed reliably in every run,
   at ~15-16s each - i.e. ~2s/iteration.
2. 16 iterations x ~2s/iteration = ~32s, which lands right at, and
   sometimes past, the 30s timeout - a pure arithmetic budget shortfall
   for a genuinely 2x-heavier test case, not a hang or a real deadlock.
3. Root cause of the ~2s/iteration cost (higher than it would have been
   historically): this pass started a real, live Meilisearch instance
   for the first time in this sandbox's history (see
   `performance/SEARCH_REVIEW.md`). Each of this test's 32 style
   creations per full run (2 per `buildRaceFixture` call x 16
   iterations) now makes a REAL `indexStyle` round-trip to Meilisearch
   during publish, real latency this test never previously incurred
   when Meilisearch was always unreachable in this sandbox.
4. Fix applied: raised this ONE test's own timeout to 60s
   (`exchange-fulfilment-xor-race.test.ts`, the 16-iteration `it()`
   call) with an inline comment recording this exact reasoning. This
   widens a genuinely-too-tight budget for legitimately heavier,
   now-more-realistic work - it does **not** touch, weaken, or remove
   any assertion (`assertExactlyOneWinner`/`assertCommittedInvariant`
   are unchanged), and does not affect the other two tests in the file.
5. **Verified fixed, not just patched**: re-ran the file 2 more times
   after the change - both passed cleanly, with the 16-iteration test
   completing in 30.6s and 32.4s respectively (i.e. genuinely close to
   its old ceiling, confirming this was exactly the budget-shortfall
   diagnosis above, not a masked deeper issue).

This is the one place this M30-M33 phase's own testing surfaced a
genuine defect in test infrastructure (a too-tight timeout, now that a
previously-unreachable dependency is finally reachable) - not a
production correctness defect. The underlying database-level
concurrency invariant (`check_fulfilment_line_exclusivity`/
`check_exchange_fulfilment_exclusivity`, EXC-004's own independent-
review repair) is unaffected and re-proven correct by this same test,
now reliably.

## Negative scenario #2 (`acceptance/m32-performance-load.md`): sustained
## load on a single low-stock SKU

Already covered by the existing, re-run-and-passing M06 adversarial
suite (`test/integration/inventory-concurrency.test.ts`,
`holds the oversell invariant under 100-way concurrency`): 15 units of
real stock, 100 genuinely concurrent (`Promise.all`) reservation
attempts against the SAME SKU - exactly 15 succeed, exactly 85 are
correctly rejected, the ledger reconciles exactly, proven again in this
pass's own clean full-suite re-run. No new test was needed to satisfy
this negative scenario; this pass confirms the existing coverage still
holds at current schema/trigger state (post-EXC-004, post-gift-cards).

## Negative scenario #1: 2x target peak concurrency degrades gracefully

The M31 rate-limiting layer (`plugins/rate-limit.ts`,
`security/AUTH_SESSION_SECURITY.md`) is this system's designed answer to
this scenario for the routes most exposed to abusive concurrency (OTP,
staff login, checkout/payment) - a clear, typed 429 response with
`Retry-After` semantics, never a crash, timeout pile-up, or silent data
corruption. This pass's own `rate-limiting.test.ts` suite (M31, 8 tests,
re-confirmed green in this run) proves that response is correct and
identity-scoped rather than IP-collapsed. For the unthrottled public
read routes (PLP/PDP/search), this pass's own hot-path benchmarking
(`performance/HOT_PATH_BENCHMARKS.md`) already exercised them at 20
concurrent connections sustained for 10s with zero errors and stable
p50/p97.5 latency (no degradation curve, no connection failures) -
genuine evidence of graceful behavior at load, short of a dedicated 2x-
peak synthetic spike test against a production-topology environment,
which remains out of this single-container sandbox's reach and is not
claimed here.

## Full-suite result (this pass's clean, uncontended re-run)

679/682 passed on the first clean run; the 3 failures were the 2
search-index test-pollution artifacts (this pass's own concurrent
reindex - see `performance/SEARCH_REVIEW.md`, not a real bug, proven by
isolated re-run) and the 1 xor-race timeout above (real, now fixed).
See the final report for this pass's true final, uncontaminated
validation run.
