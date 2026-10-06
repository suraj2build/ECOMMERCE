# Dependency audit (updated 2026-10-03)

CI gate (`.github/workflows/ci.yml`): `npm audit --omit=dev --audit-level=high`
fails the build on any HIGH or CRITICAL advisory in a production
dependency. A full-tree audit is printed for visibility and does not fail
the build.

## Production dependencies: 0 findings

`npm audit --omit=dev` reports **0 vulnerabilities** (all severities).

### Fixed: postcss under Next.js (HIGH)

- **Finding.** Next.js 15.5.26 pins its own copy of `postcss@8.4.31`. Four
  advisories apply to it, all fixed in `postcss >= 8.5.23`. Next.js uses it
  at build time to process the application's own CSS.
- **Upgrade options.** No Next.js 15.5.x release fixes it; 15.5.27 still pins
  8.4.31. Next.js 16.3.8 ships postcss 8.5.23, but that is a major framework
  upgrade (App Router, caching and middleware changes) with its own review
  and regression cost.
- **Fix taken.** An npm override in the root `package.json`
  (`"overrides": { "next": { "postcss": "8.5.28" } }`) makes Next.js resolve
  the hoisted, patched postcss 8.5.28. Nothing in the 8.4 → 8.5 line removes
  an API that Next uses.
- **Evidence.**
  - `npm ls postcss` shows a single postcss 8.5.28.
  - Production builds of the storefront and admin produced CSS that is
    byte-identical to the pre-override builds (same SHA-256 for each
    emitted stylesheet).
  - The full CI suite runs on the change (build, unit, integration,
    Playwright E2E, load gates).
- **Follow-up.** Remove the override when the project moves to a Next.js
  release that ships a patched postcss itself. The Next 16 upgrade is a
  separate, reviewable change, not a launch prerequisite for this
  advisory.

## Dev-only tooling: accepted for now, not shipped

The remaining full-tree findings are confined to test, lint and build
tooling. None of it is present in a running deployment, and none of it
processes untrusted input in CI.

| Package chain | Severity | Exposure | Fix available |
|---|---|---|---|
| vitest 2 → vite/esbuild/@vitest/mocker | critical/high | Vitest UI and Vite dev server only. Neither is started; tests run headless. | vitest 5 (major) |
| eslint-config-next 15 → @next/eslint-plugin-next → fast-glob | high | Lint only | eslint-config-next 16 (pairs with Next 16) |
| tailwindcss 3 → chokidar/micromatch/braces | high | Build-time CSS from the project's own sources; ReDoS needs attacker-controlled glob patterns | tailwindcss 4 (major rewrite of config and CSS) |
| autocannon 8 → hyperid/uuid | moderate | Load-test harness only | autocannon 2 is not an upgrade; no fixed release on the 8.x line |

**Recommended order.** Upgrade vitest to 5 next, because it removes the only
critical finding and stays contained to tests. The Next 16, eslint-config-next 16
and Tailwind 4 upgrades belong together in one later UI-platform upgrade.
Visual regression review of the approved VANYA UI is part of that upgrade.

## 2026-10-06: source-map-js (GHSA-68fv-2mgg-jv7q)

CI's production audit (`npm audit --omit=dev --audit-level=high`) failed
on `b2c1a58` with a newly published high-severity advisory:
`source-map-js` 1.0.0 - 1.2.1 allows an event-loop denial of service
through indexed source-map section offsets. It reaches production
dependencies through `postcss` (overridden to 8.5.28 for Next) and
`@tailwindcss/node`; both use it at build time on the project's own CSS.
No package file had changed, so the base commit would fail the same way.

Fixed by moving the lockfile to `source-map-js` 1.2.2, the patched release
(a 3-line `package-lock.json` change; no `package.json` change). The
production audit then reports 0 vulnerabilities. Builds, unit,
integration and browser suites were rerun on the new lockfile.
