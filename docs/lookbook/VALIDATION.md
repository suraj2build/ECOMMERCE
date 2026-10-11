# Lookbook validation — 2026-10-11

Base: main e8c87cbbd7a7a08c2497e670388a6e1e1f673136. Feature branch: feat/gender-lookbooks.

## Completed

| Check | Result |
| --- | --- |
| Storefront unit tests | 26/26 in six files, including five new content-boundary tests |
| Storefront typecheck | Passed |
| Targeted ESLint, zero warnings | Passed for implementation and assertion tests |
| Production storefront build | Passed, including both dynamic Lookbook routes |
| Chromium browser preview checks | 5/5 on the final product code |

Browser checks use a deliberately isolated mock catalogue, not production/demo stock. They verify both hubs at desktop/mobile sizes with loaded images and no horizontal overflow; occasion filtering; cross-department 404; explicit size selection and exact colour SKU submission to the existing cart client; stock disappearing between panel load and add; keyboard Escape and focus restoration.

Screenshots show actual rendered feature pages. The shopping screenshot/video shows **fixture data**, clearly named as such. A separate presentation recording is not included in the five-test count.

## Earlier checks that did not pass

- Targeted lint found two backdrop accessibility issues; changed the backdrop to a labelled button and reran successfully.
- Browser setup could not download Chromium from its CDN and initially lacked the video encoder path. A scratch-only Chromium binary was obtained through npm and the installed ffmpeg used. No repository dependency/lockfile was changed.
- Starting the application in a separate command made it unreachable inside the browser test network. Both servers are now started by the isolated Playwright config.
- The first fixture-backed run returned an object where the existing wishlist API expects an array. Corrected the test fixture; no product change was needed. Expanded the fixture's product fields so Next product-link prefetches also render cleanly.
- Test-fixture lint flagged a console log; removed it and reran.

## Not claimed

No full commerce integration suite, payment/provider sandbox UAT, courier UAT, CI result, deployment or go-live is claimed for this branch. No real style/colour mapping was verified. The user's separate localhost site was not modified by these local repository changes. The separate admin-ops branch was not merged.

## Reproduce

Build `apps/storefront`, then run:

`npx playwright test --config test/lookbook-preview/playwright.config.ts`

The config owns ports 3000 and 4000; stop other local services on those ports first. A normally installed Playwright Chromium works, or set `PLAYWRIGHT_CHROMIUM_EXECUTABLE` to a compatible local binary. Use `LOOKBOOK_RECORD_PREVIEW=1` for the separate presentation recording. Videos/screenshots go to the ignored `lookbook-test-results` folder.
