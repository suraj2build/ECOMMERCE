# M32 — Performance / Load Acceptance Criteria

**Spec(s):** cross-cutting, validates `blueprint/NON_FUNCTIONAL_REQUIREMENTS.md`
targets
**Status:** BLOCKED — sequence-blocked; requires M00–M31 substantially
complete to have a real system to load-test.

## Business acceptance

- [ ] The platform sustains the given operating scale (10,000–50,000
      SKUs, 1,000–10,000 orders/day) without fundamental redesign —
      this is the milestone that empirically proves that claim, rather
      than assuming it.

## Functional acceptance

- [ ] Load testing exercises: PLP/search browsing, PDP views, cart/
      checkout, payment (against a sandbox/mock provider), order
      placement, and the M06 last-unit concurrency scenario at
      realistic concurrency levels.
- [ ] NFR targets from `blueprint/NON_FUNCTIONAL_REQUIREMENTS.md`
      (`NFR-001`–`006`) are measured against real load and either
      confirmed or revised with a documented rationale.

## Negative scenarios / edge cases

1. Load test at 2× the target peak concurrency — system degrades
   gracefully (e.g., queues, backpressure, clear error responses), not
   catastrophically (crashes, data corruption, oversold inventory).
2. Sustained load specifically targeting a single low-stock SKU (worst
   case for the M06 concurrency guarantee) — zero overselling under
   load, not just under the single-scenario test in M06.

## Test requirements

- [ ] Automated load-test suite, run against a staging environment
      matching production topology.
- [ ] Results documented and NFR targets updated in
      `blueprint/NON_FUNCTIONAL_REQUIREMENTS.md` accordingly.

## Definition of Done

All boxes above checked, plus `acceptance/README.md`. This milestone
cannot start meaningfully until enough of the platform exists to load
— it is sequence-blocked, not decision-blocked.
