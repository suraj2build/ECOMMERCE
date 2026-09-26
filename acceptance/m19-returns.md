# M19 — Returns Acceptance Criteria

**Spec(s):** `specs/18-returns.md`
**Status:** M19 build complete 2026-09-25 (engineering scope) — see
`blueprint/DECISION_REGISTER.md` `RET-005`. Independent review of that
build found the mobile photo/evidence gap below required closing;
repaired 2026-09-26 (Post-Purchase Phase independent-review repair,
finding 2) — see `RET-005`'s repair addendum. Not self-declared
`VERIFIED`; independent re-review pending.

## Business acceptance

- [x] Default 7-day return window is enforced from delivery date,
      overridable per category/product via configuration
      (`RETURN_WINDOW_DEFAULT_DAYS`, `ReturnPolicy` style/category
      override rows — `returns.test.ts` tests #1–5).
- [x] Configured non-returnable categories (e.g., innerwear) correctly
      block return initiation (`returns.test.ts` test #4/5).
- [x] Return reason selection is mandatory — cannot submit a return
      without one (`returns.test.ts` test #6; storefront form requires
      it client-side too, server is authoritative).
- [x] Refund eligibility does not fire until QC passes
      (`ReturnLine.refundEligible` set only on `qcResult = PASS` —
      `returns.test.ts` tests #20–23).

## Functional acceptance

- [x] Self-service return initiation works from the customer's order
      history (`returns.spec.ts` browser E2E, and `returns.test.ts`
      test #11).
- [x] Reverse logistics pickup is scheduled via the carrier abstraction
      (or drop-off, where configured) (`returns.test.ts` tests #15–16,
      reusing `ShippingProvider.initiateReversePickup`).
- [x] Return disposition (restock/write-off/return-to-supplier) posts
      the correct inventory ledger transaction — never silent
      restocking without QC (`returns.test.ts` tests #20–23; INV-006
      gate).

## Negative scenarios / edge cases

1. [x] Attempt to return an item past the window → blocked with a clear
   reason shown (`returns.test.ts` test #3).
2. [x] Attempt to return a configured non-returnable category → blocked
   with a clear reason (`returns.test.ts` test #4).
3. [x] Submit a return without selecting a reason → blocked
   (`returns.test.ts` test #6).
4. [x] Return arrives but fails QC → does not restock as sellable
   (`returns.test.ts` tests #21–23); refund eligibility for a
   failed-QC return is a genuinely undecided business rule the
   approved spec never resolves — engineering default is `false`
   (no automatic financial consequence either way), documented as
   `RET-005` in `blueprint/DECISION_REGISTER.md` rather than guessed.

## Mobile behavior

- [x] Photo upload for return condition (if required by config) uses a
      mobile-camera-friendly flow. **Implemented 2026-09-26**
      (independent-review repair, finding 2): `ReturnPolicy.evidenceRequired`
      (config-driven, resolved through the SAME style > category >
      platform-default order as `windowDays`/`returnable`, never
      universally mandatory) drives whether the storefront presents the
      upload step as required or optional; the actual upload endpoint
      accepts a file regardless, so a CS-assisted upload always works.
      Storage: a new minimal provider abstraction
      (`modules/returns/evidence-storage.ts`) — no usable S3/MinIO
      client existed anywhere in this codebase before this repair (only
      ADR-0007's config/docker-compose scaffolding, never called), and
      no MinIO instance is reachable in CI/this sandbox to test against,
      so the actually-shipped, actually-tested provider is private
      local-disk storage (never registered as a static-served
      directory — no public URL for any object regardless of key),
      behind the SAME interface a future real S3 provider could
      implement without any `ReturnService` change. Security: ownership/
      RBAC-checked on every read (customer: clean 404 IDOR pattern;
      staff: `return:read`), server-generated opaque object keys (never
      a client filename/path), an allowlisted MIME type sniffed from the
      file's OWN magic bytes — never the client-declared Content-Type,
      closing "reject unsupported/executable payloads" against a
      renamed-executable upload — a bounded file size (config, plus a
      transport-level `@fastify/multipart` backstop), and a bounded
      file count per line. See `test/integration/returns.test.ts`
      "Return evidence upload" (12 tests: upload/list/download, PNG
      sniffing, executable rejection, oversized rejection, per-line
      cap, customer/staff IDOR on both the metadata and content routes,
      RBAC, unauthenticated rejection, evidenceRequired resolution,
      rejection once cancelled) and the mobile Playwright coverage
      below. See `RET-005` in `blueprint/DECISION_REGISTER.md` for the
      full design record.

## Test requirements

- [x] E2E: `acceptance/e2e-commerce-flows.md` FLOW 10 (COD return →
      store credit) is driven through a real browser end to end
      (`test/e2e-storefront/refunds.spec.ts`), which exercises the same
      return-initiation → warehouse receipt → QC → disposition pipeline
      FLOW 9 needs. FLOW 9's own PREPAID-refund leg and FLOW 16
      (partial return/refund) are proven at the integration layer
      instead (`test/integration/returns.test.ts`,
      `test/integration/refunds.test.ts`'s partial-refund test) — same
      precedent as this build's other milestones for any path needing
      a real Razorpay redirect, which no E2E spec in this repo drives.
      Return initiation/withdrawal itself is also directly browser-
      tested on desktop and mobile viewports
      (`test/e2e-storefront/returns.spec.ts`). The mobile-camera-
      friendly evidence upload (finding 2 repair) is itself driven
      through a real genuine-mobile-viewport (390×844) browser test —
      `test/e2e-storefront/returns.spec.ts` "uploads return-condition
      evidence via the mobile-camera-friendly upload control on a
      genuine mobile viewport", using Playwright's `setInputFiles`
      against the real `<input type="file" capture="environment">`
      control (the standard way to drive a camera-capture input in an
      automated test), asserting both the browser-visible outcome and
      the database-verified `ReturnEvidence` row.

## Definition of Done

All boxes above checked, plus `acceptance/README.md`.
