# Acceptance walkthrough — 2026-10-16 — commit `cbdd2c0`

This closes the scoped mock-provider acceptance walkthrough authorized by
the Product Owner after PR #6 (`admin-ops-phase1` reconciliation) merged
into `main`. **Result: 24 passed, 1 blocked, 0 failed**, against commit
`cbdd2c0970a9a567c13dec1f2aa4621a72bb1d07`. No further general fix round
is needed on this walkthrough's account.

Accepted by the Product Owner as the reported scoped outcome, based on
`report.html` — **without independent inspection of these underlying
artifacts.** This is not a production certification.

## Provenance corrections (2026-10-16, after initial preservation)

Two corrections to how this record was first assembled, both recorded
here rather than silently fixed:

1. **The three scripts in `scripts/` are reconstructions, not preserved
   originals.** The git worktree they actually ran from was deleted
   (`git worktree remove --force`) before anyone thought to copy them
   out, so these copies were retyped afterward from the session's own
   conversation record, not recovered from disk. They have **not been
   re-executed** since reconstruction. Treat them as a faithful record
   of the logic that produced the results below, not as verified-working
   code — don't assume a fresh run would reproduce `evidence/` or
   `report.html` exactly until someone actually reruns them and checks.
   Each script's own header carries the same notice.
2. **`evidence/`, `screenshots/` and `video/` are the real, unmodified
   outputs of the actual run** — these were copied from disk before the
   worktree was deleted, not reconstructed. `CHECKSUMS.sha256` (SHA-256,
   generated the same day) lets anyone verify in the future that these
   62 files haven't been altered since: `shasum -a 256 -c CHECKSUMS.sha256`
   from this directory should report every line `OK`.

(A third, process-only correction from the same review: pushing a
commit built on a stale local `main` would have been rejected outright
by git as a non-fast-forward push, not silently accepted in a way that
dropped the PR #6 merge from history — rebasing onto the correct
`origin/main` before pushing was still the right fix, just not an
averted-disaster the way it was first described.)

## What this proves

Run against a real UI (customer storefront + staff admin console), on an
isolated stack (fresh Postgres database, mock shipping provider, COD
payment only — no real external calls), using real staff/customer API and
database checks to verify the ledger at each step, not just the screen.

1. **Booking moves no stock; handover posts it exactly once.** Confirmed
   twice: once on the main order's own `SALE` ledger (unchanged across
   "Book shipment with carrier," +1 exactly across "Confirm handover"),
   and again on a completed exchange's `EXCHANGE_DISPATCH` ledger (same
   pattern).
2. **Customer-side and admin-side payable amounts agree.** The customer's
   order-confirmation "Amount payable" (₹673, after a ₹200 coupon + 100
   loyalty points + ₹100 store credit stacked together) matched the
   admin order-detail page's own "Amount payable" exactly.
3. **The full customer/admin journey works end to end**: sign-in (real
   mobile OTP), a saved address, PDP gallery/size selection, bag,
   checkout with a coupon/loyalty/credit stacked together, a COD order,
   admin pick → pack → ready-to-ship → book → handover → deliver, and a
   customer-initiated exchange carried through QC, replacement pick,
   packing, booking, handover and delivery to `COMPLETED`.

## What remains open — read this precisely

**The blocked discounted exchange (`EXC-2026-000002`) remains unverified
through payment and completion.** Its replacement priced the same as the
original at catalogue rate, but the order's own ₹200 coupon had reduced
the *original line's* frozen value (`originalLineValue`) below the
replacement's full catalogue price (`replacementValue`), so the exchange
service correctly computed a `CUSTOMER_PAYS` settlement of ₹200, not
`EVEN`. Collecting that difference goes through the real Razorpay payment
provider. This codebase has no mock Razorpay implementation the way it
has a `MOCK` shipping carrier, and no Razorpay test credentials are
configured in this isolated stack, so the payment correctly failed safe
(`paymentStatus: FAILED`) with no network call and no fabricated success.

**The second order's exchange (`EXC-2026-000003`) proves the
EVEN-settlement path only — it does not replace the missing payment
test.** It is a different order, with a different settlement direction,
exercising a different code path (no payment-collection step at all).
Whether a `CUSTOMER_PAYS` exchange can actually collect its price
difference and reach `COMPLETED` is still an open question, to be
answered by a real Razorpay sandbox run, not inferred from this result.

## Release gates still open

1. Razorpay sandbox payment and recovery validation.
2. Real courier sandbox booking, tracking, cancellation and
   duplicate-event validation.
3. Production release decision.

## Contents of this directory

| Path | What it is |
|---|---|
| `report.html` | The full report — results table, ledger-check tables, references, and the screenshot gallery. Open directly in a browser. |
| `scripts/walkthrough-phase1-2.cjs` | **Reconstructed, not re-run** (see Provenance corrections above). Documents customer sign-in → saved address → PDP → bag → checkout (coupon + loyalty + store credit) → COD order → admin pick/pack/ready/BOOK/HANDOVER/deliver. Screenshots 01–37. |
| `scripts/walkthrough-phase3-exchange-blocked.cjs` | **Reconstructed, not re-run.** Documents the discounted order's exchange request → admin receive/QC → correctly computed `CUSTOMER_PAYS`, blocked there. Screenshots 38–45. |
| `scripts/walkthrough-phase3-exchange-completed.cjs` | **Reconstructed, not re-run.** Documents a supplementary discount-free order, fulfilled, then exchanged (EVEN settlement) through to `COMPLETED`. Screenshots 46–59. |
| `evidence/walkthrough-facts.json` | Original, unmodified. Raw identifiers and figures captured during the run (order/exchange IDs and numbers, SKU IDs, SALE/EXCHANGE_DISPATCH counts at each checkpoint, payable amounts). |
| `evidence/walkthrough-results-final.json` | Original, unmodified. The complete stage-by-stage expected-vs-actual log with PASS/BLOCKED/FAIL status for all 25 recorded checks. |
| `screenshots/` | Original, unmodified. All 59 numbered PNG screenshots referenced by `report.html`. |
| `video/vanya-acceptance-walkthrough.mp4` | Original, unmodified. The concatenated walkthrough video (~40s), covering all phases. |
| `CHECKSUMS.sha256` | SHA-256 manifest for the 62 original files above (evidence + screenshots + video) — run `shasum -a 256 -c CHECKSUMS.sha256` from this directory to verify none have changed. |

## Running it again

These scripts are reconstructions (see Provenance corrections above),
not re-verified against a live stack. Before relying on them, rerun and
confirm they still reproduce the results in `evidence/` and
`report.html`. They assume a dedicated, isolated stack already running
— never point them at the live demo. The original run used:

- API on `http://127.0.0.1:4077`, `NODE_ENV=test`, `SHIPPING_PROVIDER`
  left at its `MOCK` default, no Razorpay credentials set (so COD is the
  only usable payment method).
- Storefront on `http://127.0.0.1:3077`, admin console on
  `http://127.0.0.1:3078`, both built with `NEXT_PUBLIC_API_URL` pointed
  at the API above.
- A fresh database, migrated and seeded (`npm run db:seed`), with the
  demo catalogue loaded via `scripts/seed-demo.mjs`, search reindexed,
  a serviceable PIN code (110011) and the demo warehouse's return
  address set via the staff API, and a `WALKTHRU200` coupon created via
  the staff promotions API (all one-time setup, documented inline in
  `scripts/walkthrough-phase1-2.cjs`'s header comment).

Run `walkthrough-phase1-2.cjs` first, then
`walkthrough-phase3-exchange-blocked.cjs` (reads its
`evidence/walkthrough-facts.json`/`walkthrough-results-*.json` — point
`DATABASE_URL`/output paths at wherever you're running from), then
`walkthrough-phase3-exchange-completed.cjs`. Each writes its own
screenshots/video segments and chains its JSON output into the next.
