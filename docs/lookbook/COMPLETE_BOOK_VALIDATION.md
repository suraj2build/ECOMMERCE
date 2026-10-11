# Complete book validation - 11 October 2026

Feature branch: `feat/gender-lookbooks`, continuing the original lookbook commit `4c1ca75`. Validation applies to the complete women's issue and existing lookbook UI; it is not full commerce UAT.

## Final checks

- Storefront unit suite: **32/32**, 7 files. Six complete-issue tests cover page map, all outfit/product spread associations, bounded share page numbers, exact code/colour resolution beyond the first catalogue page, duplicates, ambiguous colours, cross-department refusals and catalogue outage.
- Storefront TypeScript: clean.
- Targeted ESLint: clean, zero warnings across changed TS/TSX and browser specs. The config file is intentionally excluded from the explicit lint list because repository ignore rules exclude configs.
- Storefront production build: succeeded. The compiled complete-issue route is dynamic; unseen published product IDs remain admitted by the existing build guard. Build-time API reads could not reach a real local commerce API; this is not an API connectivity check.
- Isolated browser suite: **8/8**. Tests cover separate hubs, filtering, department refusals, existing story shopping, changed stock, modal focus, every page/image/detail panel in the complete book, PDF response, reading-position restoration, exact two-piece SKU additions, mobile continuous reading, overview and photo zoom/Escape/focus restore. A regression check requires the cafe photo beside its own products and excludes the next look's photo.
- Presentation recording: **1/1**, approximately 25 seconds of test interaction, separate from the eight functional checks. All shopping data shown is a fixture.
- PDF: **32 pages**, internal contents/index links, linked reader actions, rendered and visually inspected on every page. Initial head-cutting chapter crops and oversized encoding were fixed before the final render. The distribution file is approximately 15 MiB; it is downloaded only on request.
- Media: 13 new optimized WebPs saved; all registered images and catalogue plates loaded in the full-page browser audit. Original generation prompts are recorded. No claim of 37 new photographs or certified model-sheet compliance is made.
- Git whitespace check: clean.

## Runs or reviews that did not pass

1. The initial browser attempt never opened a page because the environment lacked Playwright's video encoder executable. The installed system ffmpeg was made available at Playwright's expected runtime path; no product change.
2. The initial page/image audit failed on page 6 because hidden lazy detail images were inspected while their `details` panel was closed. The test now opens every detail panel before inspecting images; images still must load successfully.
3. Final screenshot review found a real desktop spread issue: physical odd/even pairing put one outfit's products beside the next outfit's photo. Semantic pairing now keeps each outfit and its products together, and chapters stand alone. Unit/browser regression assertions cover the fix. The final screenshots and video were regenerated afterwards.
4. A rerun could not start because a generated `.next/routes-manifest.json` was empty. Clean output regeneration then hit a transient `ENOTEMPTY` during Next export-directory cleanup; a subsequent production build succeeded, followed by all final browser checks. Source files were intact. No build cache is committed.
5. A broad lint filename glob included the intentionally ignored Playwright config, producing an ignored-file warning. The final explicit changed-file lint list passes with zero warnings.

## Not checked or changed

No actual desktop database is connected from this workspace. Exact references come from the existing launch catalogue and garment galleries; live database publication must be confirmed after pulling/rebuilding locally. No product records, quantities, prices, payments, dispatch or courier integration were changed. No API integration/full commerce load suite was run for these storefront/editorial changes. No deployment, merge into main, live inventory certification or CI result is asserted here.

See COMPLETE_BOOK.md for the team handoff, source manifest, product rules and PDF rebuild command.
