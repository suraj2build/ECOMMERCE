# Instructions for Claude Code in this repository

This file is read automatically by Claude Code. It is binding operating
guidance for any Claude Code session working in this repository,
including future sessions that have no memory of this one.

## 0. Current project stage — READ FIRST

**Status as of 2026-10-06 (after `71230f9`): `CANCEL BOOKING AND REBOOK
FOR ORDER PACKAGES, PLAYWRIGHT ARTIFACTS ON CI FAILURE AND AN EXCHANGE
SCREEN NOTE BUILT ON claude/admin-ops-phase1 — AWAITING REVIEW; COURIER
(LR-008) STILL UNDECIDED.`** Instruction recorded verbatim in
`blueprint/DECISION_REGISTER.md` → AO. Record:
`docs/admin/ADMIN_OPS_PHASE1.md` ("Follow-up after `71230f9`").

- **Cancel booking and rebook.** A courier booking made by mistake is
  cancelled before collection and the order kept: no stock moves, the
  items return to "Picked, waiting for a package", and the new package's
  handover posts the sale once. Courier cancellation confirmed, a reason
  and `shipping:manage` are required. **Cancel booking and items** stays
  separate (`order:cancel`). Races with handover, carrier events and line
  cancellation are tested. `docs/admin/DISPATCH.md`.
- **CI artifacts.** A failed browser run uploads the HTML report, traces
  and screenshots. The cause of the earlier link-audit timeout is still
  unconfirmed.
- **AO-D8 (changing an allocated exchange item):** deferred by the
  Product Owner. The exchange page explains the recovery path (none in
  the system after receipt); options are recorded, nothing built.
- **Tests before push:** unit 90 + 21, integration 998/998 (65 files,
  none skipped), browser 92/92 with the load checks passing. One earlier
  browser run failed on a test-timing race (P1-07); the cause is in the
  record.
- **Retry follow-up (2026-10-07):** a same-key retry of a booking
  cancellation (order rebook or exchange replacement) returns the
  original result, now also when it arrives while the first request is
  still running (it used to get 409); a different request against a
  released package is refused. Integration 1000/1000, browser 92/92.
  Next: courier selection (LR-008), real integration, then an
  end-to-end UAT.

Not self-certified; no go-live claimed. Green CI does not establish
go-live readiness.

**Status as of 2026-10-06 (review of `a807ef6`): `WALKTHROUGH OF STAFF
SIGN-IN, REVOCATION, BOOKING, HANDOVER AND CANCELLATION RUN, ITS SCREEN
DEFECTS FIXED, AND A RECOVERY PATH FOR A MISTAKEN EXCHANGE REPLACEMENT
BOOKING BUILT ON claude/admin-ops-phase1 — AWAITING REVIEW; COURIER
(LR-008) STILL UNDECIDED.`** Record: `docs/admin/ADMIN_OPS_PHASE1.md`
("Follow-up after `a807ef6`") and `docs/admin/WALKTHROUGH_2026-10-06.md`.

- **Validation record corrected** (documentation-only commit `3656b9e`):
  the post-lockfile integration rerun was 989/989, none skipped.
- **Walkthrough.** Temporary-password sign-in, revocation on role change,
  reset, deactivation and own password change, booking (no stock moved),
  handover (one sale; a later carrier poll posted nothing) and booking
  cancellation (reservation released) all behaved as specified. Nine
  screen defects were fixed (W2-1..W2-9), for example a signed-out person
  now gets a "Sign in again" link instead of a Retry that could never
  work, and a shipped package no longer reads "Booked".
- **Replacement booked by mistake.** Staff cancel the replacement's
  booking from the exchange (`exchange:fulfil`); no stock moves, the
  exchange stays allocated, and a new package is booked; its handover
  posts the dispatch once. `docs/admin/DISPATCH.md`.
- **Also fixed (found by the browser runs):** a brief duplicate
  confirmation after cancelling a replacement booking, and the navigation
  menu editor asking to discard just-saved changes when switching menus
  straight after saving (now covered deterministically by AO-05).
- **Tests before push:** unit 90 + 21, integration 992/992 (65 files,
  none skipped), browser 91/91 with the load checks passing; earlier
  failed runs and their causes are in the record.
- **Reported, not built:** an order package booked by mistake can only be
  cancelled whole (no rebook path); changing an exchange's replacement
  item after allocation has no path.

Not self-certified; no go-live claimed. Green CI does not establish
go-live readiness.

**Status as of 2026-10-06: `AO-D5 OPTION B, AO-D6 METADATA REMOVAL AND
STAFF MANAGEMENT (AO-D7) BUILT ON claude/admin-ops-phase1 — AWAITING
REVIEW; COURIER (LR-008) STILL UNDECIDED.`** The Product Owner's
instruction of 2026-10-06 ("Proceed with AO-D5 option B, AO-D6 metadata
removal, and staff management option (a) …") is recorded verbatim in
`blueprint/DECISION_REGISTER.md` → AO. Record:
`docs/admin/ADMIN_OPS_PHASE1.md` ("Product Owner go-ahead, 2026-10-06").

- **AO-D5 option B.** Booking makes the package `BOOKED` and moves no
  stock. The courier handover (staff confirmation or the carrier's first
  movement, once) posts the sale, marks it shipped and sends the message
  after commit. Booked packages are cancelled whole by staff after the
  courier booking is cancelled. Packages booked earlier are not posted
  twice. `docs/admin/DISPATCH.md`.
- **AO-D6.** Public product and content images are re-encoded without
  EXIF/GPS/XMP, upright, with their colour profile. Return evidence is
  untouched.
- **AO-D7 staff management.** Staff page; temporary passwords shown once
  with a forced change; sessions end on reset, deactivation, role change
  and own password change; last Super Admin and approval owners
  protected. `docs/admin/STAFF.md`.

Not self-certified; no go-live claimed. Green CI does not establish
go-live readiness.

**Status as of 2026-10-05 (review after `6217031`): `APPROVAL SECRETS
CLEARED AFTER REFUSAL AND SENDER ADDRESS REQUIRED FOR COURIER BOOKING ON
claude/admin-ops-phase1 — AWAITING REVIEW; STAFF SCREEN, AO-D5 AND AO-D6
AWAIT THE PRODUCT OWNER.`** Record: `docs/admin/ADMIN_OPS_PHASE1.md`
("Review after `6217031`").

- **Approval passwords.** After a refused approval, the password and
  authenticator code are cleared and the reason is kept. They are also
  cleared on success, close and hide (PO approval, receiving sign-off,
  adjustments, pick shortfalls).
- **Courier booking.** Refused until the dispatching warehouse has a full
  address (address line, city, state, PIN code), before the courier is
  called; a replay of an existing booking still converges. The demo
  warehouse is left blank, not given an invented address.
- **Still open.**
  - The staff management screen: proposal in the record above; it needs
    a go-ahead and a reset-method choice.
  - AO-D5 option B and AO-D6, recommended again and still not approved.
  - The courier (LR-008).

Not self-certified; no go-live claimed.

**Status as of 2026-10-05 (walkthrough): `SOLO-OWNER DESKTOP WALKTHROUGH
RUN AND ITS SCREEN DEFECTS FIXED ON claude/admin-ops-phase1 — AWAITING
REVIEW; AO-D5/AO-D6 RECOMMENDED BUT NOT APPROVED.`** After CI passed on
`57f0f53`, the Product Owner asked for one desktop walkthrough (publish,
receive with owner approval, pick/pack/print, book/hand over/track,
failure cases) before more features. Record:
`docs/admin/WALKTHROUGH_2026-10-05.md`.

- **Fixed.** Next steps and states are now clear:
  - picked orders now appear on Pack & ship under "Picked, waiting for
    a package", and the page opens on work in progress;
  - only actions valid for the current status are offered on purchase
    orders, packages and order lines;
  - refused dialogs keep what was typed, and own-approval is disabled
    with the reason;
  - messages use plain words, and errors on long forms scroll into
    view;
  - readiness says "Not yet" when there is no stock;
  - documents warn when the warehouse address is missing;
  - pick and pack scans name the item;
  - the Overview shows approvals waiting for you and dispatch counts.
- **AO-D5 (option B) and AO-D6 (strip metadata)** were *recommended* by
  the Product Owner's reviewer, explicitly not approved. Both stay
  `DECISION_REQUIRED`, and nothing is built for them.
- **Reported, not built:** a staff management screen (W-23), and the
  delivery-area list (W-11, which comes with the courier, LR-008).

Next as asked, once approved: the handover change (AO-D5), the courier
(LR-008), then promotion templates, basket simulation and campaign
configuration. Not self-certified; no go-live claimed.

**Status as of 2026-10-05 (second admin review): `INDEPENDENT APPROVAL
QUEUE AND DISPATCH STAGES BUILT, CODE REVIEW FIXES APPLIED ON
claude/admin-ops-phase1 — AWAITING IMPLEMENTATION REVIEW; AO-D5 AND AO-D6
DECISION_REQUIRED.`** The Product Owner verified CI green on `3e1149a`
and named two incomplete controls plus a pre-merge code review. Record:
`docs/admin/ADMIN_OPS_PHASE1.md` ("Second review"), `docs/admin/APPROVALS.md`,
`docs/admin/DISPATCH.md`, `docs/admin/BOOKING_TO_HANDOVER_REVIEW.md`.

- **Approval requests.** Naming another approver for an adjustment,
  receipt QC sign-off or pick shortfall now queues a request; nothing is
  applied until that person approves it from their own login, and the
  action is re-checked then. Owner self-approval stays a separate,
  immediate path. The service refuses an independent approval given on
  someone else's behalf.
- **Dispatch stages.** The admin shows "Booked — awaiting collection" and
  "Handed over". **AO-D5 is partial:** the package still becomes SHIPPED
  and stock still leaves the ledger at booking. The consequences review
  recommends option B and needs the Product Owner's decision.
- **Code review fixes:** confirmation-limit race, nested password/code log
  redaction, shipped/delivered messages sent only after commit,
  simultaneous handover, handover list total, decode concurrency limit,
  rotated-photo dimensions. Open: authenticator code reuse within its
  window (existing sign-in behaviour); photo camera metadata (AO-D6).
- **Test record correction:** `3e1149a`'s final run was 950/950
  integration (64 files), 86 + 21 unit, 88/88 browser; the earlier
  944/1-failed run stays in the defect history.

Next as asked: the AO-D5 decision; a courier adapter once a courier is
chosen (LR-008, not chosen — nothing built speculatively); then promotion
templates, basket simulation and campaign configuration. Not
self-certified; no go-live claimed.

**Status as of 2026-10-05 (admin review follow-up): `ADMIN OPS PHASE 1
REVIEW ITEMS CLOSED AND NEXT DISPATCH STEPS BUILT ON
claude/admin-ops-phase1 — AWAITING IMPLEMENTATION REVIEW.`** The
Product Owner's review of `e88aab9` asked for three items to be closed
before acceptance, decided AO-D1..D5, and asked for barcode verification,
parcel weight/dimensions and dispatch documents next. Record:
`docs/admin/ADMIN_OPS_PHASE1.md` ("Review follow-up"),
`docs/admin/APPROVALS.md`, `docs/admin/DISPATCH.md`, and
`blueprint/DECISION_REGISTER.md` → "AO — Admin operations".

- **Green CI on the combined branch.** `main` was merged in. The home
  page now links only to published collections, the link audit uses the
  launch categories, and two AA contrast defects are fixed (C-3). The
  previously skipped bulk spec `search-deep-pages` could never pass (it
  wrote to the wrong search index); it now uses the test index and
  refuses the demo's.
- **Image validation.** Every upload is decoded in full (sharp/libvips).
  Corrupt, truncated, animated and oversized images are refused before
  anything is stored. The pixel limits are checked from the header
  before any pixel is decoded.
- **Import.** Each product is saved in one transaction under a
  per-product lock. Simultaneous imports run one after the other, an
  interrupted batch is safe to resend (search is repaired), and prices
  are append-only per colour.
- **AO-D4 approvals.** There is one policy for POs, stock adjustments,
  receiving QC sign-off and pick shortfalls. Owner self-approval is off
  by default; when on, it needs a named owner, a reason and a password,
  and every approval is recorded. The pick co-approver gap is closed,
  and receiving no longer accepts the receiver as their own sign-off.
- **AO-D1/D2/D3.** Unpublished products republish through the QA check.
  Shoe, belt and perfume attributes show in the product page's details.
  The Business & warehouse admin screen covers the legal entity, GST
  registrations, warehouse address and dispatch checks.
- **Dispatch (AO-D5 in part).** Barcode checks at pick and pack, parcel
  weight and dimensions sent with the booking, a printable packing slip
  and address label (not a courier label), and a courier-handover
  manifest. Handover is recorded separately from booking. **The stock
  SALE is still posted at booking**: moving it waits for the consequences
  review the Product Owner asked for. Scans and measurements are only
  required if the owner turns that on (B-2/B-3 are left to the owner).

Still open: a courier (LR-008) for real labels, pickup and cancellation;
moving the sale point (AO-D5 review); and the other items listed under
"Still open" below. Not self-certified; no go-live claimed.

**Status as of 2026-10-04 (admin): `DESKTOP-FIRST ADMIN OPERATIONS
PHASE 1 IMPLEMENTED ON claude/admin-ops-phase1 — AWAITING
IMPLEMENTATION REVIEW.`** Authorized by the Product Owner ("START BUILD —
DESKTOP-FIRST ADMIN OPERATIONS, PHASE 1"). Built on its own branch from
`1195f48` so the catalogue/image/storefront work continues separately;
not merged to `main` until reviewed. Full record:
`docs/admin/ADMIN_OPS_PHASE1.md`.

- Product workspace (Basics → Colours & sizes → Photos → Pricing →
  Readiness → Preview → Publish) with category product types (apparel,
  footwear, belt, fragrance), editing of existing products, and readiness
  that separates published / purchasable / in stock / channels.
- Photo upload, listing photo, colour, order, replace and remove; public
  product media store (production requires `PRODUCT_MEDIA_STORAGE=s3`).
- Spreadsheet import with dry run, change preview, batches of 500, safe
  retries; never touches stock.
- Visual footer-menu editor, draft banners, page editing, image library;
  Setup & health page; channel scope and pause in admin.
- Research only: `docs/admin/NEXT_PHASES_RESEARCH.md` (buying, dispatch
  incl. the booking-equals-shipped proposal, promotions, after-sales,
  solo-owner approval options). Shipping/inventory semantics unchanged.
- Open decisions AO-D1..D5 (republish, product-page attributes, business
  details screen, owner mode, dispatch handover) are listed there.

**Status as of 2026-10-04 (latest): `LAUNCH ASSORTMENT REPLACED THROUGHOUT
THE CATALOGUE AND STOREFRONT — AWAITING PRODUCT OWNER REVIEW ON THE LOCAL
DEMO.`** The Product Owner (Suraj) authorized replacing the earlier
festive/ethnicwear assortment with the approved Men's (daily wear,
premium shirts, business casual: Formal/Casual Shirts, Polo T-Shirts,
Denims, Casual Trousers/Chinos, Formal Trousers, Business Casual Shoes,
Business Casual Belts, Perfume) and Women's (daily/work/casual/partywear:
Tops, Tees, Everyday Kurtis, Denims, Dresses, Trousers, Shirts, Skirts,
Hotpants/Shorts) launch assortment, explicitly excluding ethnicwear/
ceremonial/weddingwear for men and sarees/lehengas/bridalwear/festive
ethnicwear for women (everyday kurtis stay).

- **Real catalogue, not mock arrays.** `scripts/generate-launch-assortment.mjs`
  authors 45 styles (23 men, 22 women) with real colour/size variants,
  category-appropriate non-apparel attributes (shoe sizes + closure type;
  belt size + material; fragrance volume + notes, modelled as
  Colour=fragrance/Size=volume rather than forcing clothing sizes onto
  accessories), a deliberate mix of available/low-stock/sold-out
  variants, and category-specific HSN/GST rates (apparel 12%, footwear/
  leather goods/fragrance 18%). `scripts/seed-demo.mjs` loads it through
  the real staff API exactly as before (categories/sizes via Prisma
  upsert, everything else via `POST` routes), now also attaching a style
  to more than one `Collection` (`additionalCollections`) so "Business
  Casual" genuinely spans suitable items across categories alongside
  each item's own primary collection. `packages/db/prisma/seed.ts`'s own
  baseline navigation-category reference data was updated to the same
  17-category taxonomy - it is not demo-only, so a fresh database of any
  kind now gets the approved categories, not the retired ones.
- **Storefront updated consistently.** Header nav/drawer, home hero and
  occasion banners, footer category links, the search overlay's Vibe &
  Occasion chips and suggested searches, and the collections page copy
  all point at the new categories/collections. Checked for leftover
  ethnic/festive copy repo-wide (bandhgala/saree/lehenga/chanderi/zari/
  sangeet/mehendi/wedding/ceremonial/festive/handloom/artisan-as-product-claim);
  a few true positives were fixed (trust-badge and empty-state copy that
  claimed handloom/artisan sourcing these mass-market styles don't have).
  "Atelier" branding (loyalty programme name, lighting-preview mode,
  gateway/footer copy) was deliberately left alone - it is generic
  luxury-brand vocabulary baked into the whole approved design, not an
  ethnicwear reference, and the brief asks to preserve brand presentation.
- **Images.** Generation is paused (approved models for the next stage:
  Aryan, Heena, Riya, Deeksha, Alisha). Every product/colour and CMS
  banner points at a neutral, clearly-labelled placeholder SVG under
  `apps/storefront/public/placeholders/` (`scripts/generate-placeholder-images.mjs`),
  never a mismatched garment photo. Media/banner URLs are ordinary
  admin-entered values, not hardcoded into page components, so the real
  photography pack can replace them without a code change.
- **Meilisearch test isolation (found during this pass).** A local
  integration-test run (`npm run test:integration`) and `npm run demo`
  shared one Meilisearch instance *and* one hardcoded index name
  (`styles`), so a local test run could delete/pollute the real demo's
  search results - confirmed by reading
  `test/integration/search-discovery.test.ts`, which calls
  `deleteAllDocuments()` on that exact index. Fixed by deriving the
  index name from `NODE_ENV` (`services/commerce-api/src/modules/search/index-service.ts`):
  `styles_test` whenever `NODE_ENV=test` (already guaranteed by
  `test/helpers/setup-env.ts` before any test file runs), `styles`
  otherwise. CI is unaffected (its Meilisearch container is ephemeral
  either way). Verified directly: after running the integration suite,
  Meilisearch has two separate indexes (`styles`, `styles_test`) and the
  demo's own search total was unchanged.
- **Verified locally** (this machine's Postgres/Redis/Meilisearch, not
  `npm run demo` itself - see below): categories/collections/products
  reachable and correctly gendered; apparel, footwear, belt and fragrance
  variants and their stock states (available/low-stock/sold-out) render
  correctly on PLP and PDP; add-to-bag, wishlist, "Complete Your Look"
  cross-sell, search (including the new Vibe & Occasion chips), Watch &
  Shop tag-to-product links, and a full guest COD checkout (address →
  payment → confirmation, order visible in admin with an issued invoice)
  all work end-to-end against the new catalogue; 98 integration tests
  across search/catalog/product/cart/checkout/tax pass with zero
  regressions.
- **`npm run demo` itself was not run as a black box** for this pass -
  this machine's native Postgres already occupies port 5432, which is
  also what `scripts/demo-local.mjs` hardcodes, and its "is Postgres
  already up" check would pass against the wrong (native) Postgres
  before failing on a missing role - a pre-existing environment
  conflict, not a product defect. Instead, the exact same sequence
  `demo-local.mjs` would run (migrate → seed RBAC/admin → start the API
  in `DEPLOYMENT_STAGE=preview` → run `scripts/seed-demo.mjs` → reindex
  search) was run by hand against this machine's own already-working
  demo Postgres, with the same generated secrets from `.demo/settings.json`.
  A clean machine running the documented `npm run demo` should rebuild
  automatically from the catalogue's bumped `version` field with no
  extra steps.

Still not done: no image-generation pass yet (placeholders only, by
design); no cloud/hosted UAT - "UAT" for this project is, and has only
ever been, the local demo (`docs/deployment/LOCAL_DEMO.md`); the
Playwright e2e suite was not re-run against this catalogue (two specs,
`search-deep-pages`/`record-completeness`, are documented as writing
thousands of temporary fixtures against whatever search index is live -
unsafe to run against the real demo catalogue without the same kind of
isolation this pass just gave the integration suite). Not self-certified;
no go-live claimed.

**Status as of 2026-10-04 (later): `APPROVED VANYA DESIGN RESTORED
IN THE STOREFRONT CODE — AWAITING PRODUCT OWNER VISUAL REVIEW ON THE
LOCAL DEMO.`** Nothing is publicly deployed; "live" in earlier reports
meant the locally running application. Visual acceptance needs the
Product Owner's review on a normal network (`npm run demo -- --rebuild`),
because this sandbox blocks the photographs and fonts. The Product Owner
paused launch work: the storefront had drifted from the approved AI Studio
design (`suraj2build/Stitch-Spark_Ai_Studio`).

- **Design port.** The design's own components (gateway, header, footer,
  home, product card, listing, product page, Watch & Shop, wishlist, bag
  drawer, quick add, size guide, search) are copied into
  `apps/storefront/src/vanya/` and changed only where they read data:
  `vanya/bridge/` maps the real APIs onto the design's types. Tailwind
  moved to 4.3.3 so the copied classes render as designed. The approved
  separate brand row above desktop navigation is kept.
- **Not faked.** Prototype data with no real source is left out or shown
  as real data: Fit-First filter, Digital Product Passport, ensemble
  discount, restock sign-ups, view counts, trending searches and chart,
  rewards earning rates, newsletter. See
  `docs/design/VANYA_VISUAL_PARITY.md` for every item.
- **LR-011 (decided, Product Owner).** An order removes the purchased
  quantities from the bag when it is created; failed or cancelled
  payments and retries leave the bag alone.
- **Also:** en-IN money everywhere on the shopper side; plural fixes;
  shopper copy; admin navigation is a drawer on phones; the demo loads
  the design's own catalogue and editorial photographs (preview data
  only) and resets itself when that catalogue changes.
- **Exchange copy.** The footer no longer claims "7-Day Exchanges": that
  number was the platform return window, which categories and products
  can override. It now reads "Size & Colour Exchanges" (EXC-002).
- **EXC-002 scope defect fixed.** The approved scope is a different size
  or colour of the same item, but the API accepted any priced SKU. It now
  refuses a different product from staff and shopper routes alike.
- **EXC-003 (decided by Suraj, 2026-10-04).** Exchanges use the return
  window with its category/product overrides and exclusions, measured from
  delivery. No code change was needed; tests now cover it.
- **CMS pages and footer menus (specs/28-admin.md, already authorized).**
  The storefront now renders published landing pages at `/pages/<slug>` as
  plain text, and the footer reads the `footer-about` and `footer-social`
  CMS menus (site paths and https links only). About pages and social links
  therefore go live from admin, with no code change once content exists.
- **Pending design features** (Notify me, newsletter for visitors,
  Fit-First, product passport, ensemble discount, rewards rates, trending,
  view counts) are grouped by the input each needs in
  `docs/design/VANYA_VISUAL_PARITY.md` → "Decision list".
- **Accessibility over exact colour.** Some of the design's small grey
  text and its two primaries were just under WCAG AA. They are darkened
  one tone (parity item C-3), and the existing axe tests stay strict. A
  sweep of every storefront page and overlay at 1440 and 390 px finds no
  serious or critical violations.

Still open: provider accounts, an alert webhook, S3, production hosting,
the LR-008 SMS/carrier choice. Not self-certified; no go-live claimed.

**Status as of 2026-10-04: `REVIEW FIXES, LR-009, CACHE PURGE AND
LOCAL DEMO IMPLEMENTED — AWAITING PRODUCT OWNER REVIEW AND INDEPENDENT
REVIEW.`** Product Owner directions of 2026-10-04:

- **Review fixes.** A review of `42a3656` found defects that are now
  fixed with tests:
  - scheduler: a failed lease release looked like a crash; runs mixed
    instance and database clocks;
  - consent: legacy records had no subject ID; a late withdrawal could
    reach checkouts made after consenting again; order creation could
    race a withdrawal;
  - the S3 check could pass on an unreadable ACL.
- **LR-009 (decided).** A COD order sends `cod_order_placed`, not a
  purchase. The purchase is sent when Finance records the cash
  collection after delivery (`payment:cod:collect`).
- **Cache.** Cached listings now follow catalogue changes and are purged
  by `POST /search/reindex`. Verified by reseeding the database under a
  warm storefront: the deleted product stayed listed with a 200 page
  until the reindex, then answered 404.
- **Review without hosting (LR-010, Product Owner).** No paid hosting
  until production; nothing was deployed. `npm run demo` runs the whole
  application locally with demo data, reachable from a phone on the same
  Wi-Fi (`docs/deployment/LOCAL_DEMO.md`). It uses the production build in
  `DEPLOYMENT_STAGE=preview`.
- **Fixed while preparing the demo:**
  - phones on a plain-http Wi-Fi address have no `crypto.randomUUID`, so
    checkout and other actions crashed (fallback added);
  - the size guide showed raw keys (`chestIn: 38`);
  - order confirmation showed an internal ID instead of the order number;
  - the preview banner was hidden on the home gateway.

- **Found, not changed:** the bag keeps its items after an order is
  placed. No spec decides this, so it is `LR-011`, `DECISION_REQUIRED`
  (recommended: remove the ordered items when the order is confirmed).
  *(Decided and implemented later the same day; see the entry above.)*

Still open: provider accounts, an alert webhook, S3, production hosting
(chosen at production), the LR-008 SMS/carrier choice and LR-011. Not
self-certified; no go-live claimed.

**Status as of 2026-10-03 (later): `LAUNCH-READINESS REVIEW RISKS
ADDRESSED — AWAITING INDEPENDENT REVIEW.`** The Product Owner's review
of the build above named six risks. Changes:

- **Scheduler.** A Postgres lease per job (`maintenance_job_states`)
  means one instance runs a job at a time. Intervals hold across
  instances, and a job whose instance died is recovered when the lease
  expires.
- **Alerts.** `MAINTENANCE_ALERT_WEBHOOK_URL` gets one alert per failure
  streak plus a recovery message; an undelivered alert is retried.
  Production refuses to start without it unless
  `MAINTENANCE_ALERT_LOG_ONLY=true`.
- **Consent.** Withdrawal reaches the server: a consent-subject ID links
  the browser to its checkouts, queued and retrying events become
  `WITHDRAWN`, and the dispatcher re-checks consent before sending.
- **Analytics.** Purchase events carry `payment_type` (`cod`/`prepaid`).
  Reversing unpaid COD orders is `LR-009`, `DECISION_REQUIRED`.
- **S3.** `scripts/verify-s3-bucket.mjs` checks a real bucket's private
  access; it has not been run against a real bucket because none exists.
- **Dependencies.** The production postcss advisory is fixed with an npm
  override (CSS byte-identical), and CI gates on high.

See `LR-003`/`LR-006`/`LR-009`, `security/DEPENDENCY_AUDIT.md` and
DEPLOYMENT.md. Not self-certified; no go-live claimed.

**Status as of 2026-10-03: `VANYA DEMO AND LAUNCH-READINESS BUILD
IMPLEMENTED — AWAITING ACCOUNT CONFIGURATION, VENDOR DECISION AND
INDEPENDENT REVIEW.`** Authorized by the Product Owner ("START BUILD —
VANYA remaining demo and launch readiness", base `3228586`); decisions
`LR-001`..`LR-008` in `blueprint/DECISION_REGISTER.md`. Built: legal page
routes that show only approved CMS text (pending notice otherwise);
category/collection SEO, sitemap index without a product cap, runtime
`SITE_INDEXING` (previews never indexed), truthful ProductGroup structured
data; listing page validation by live result count (LR-007); consent-aware
GA4 + Meta Pixel + Conversions API with a durable `conversion_events`
outbox (purchase = confirmed order; COD at placement, prepaid after
capture); `GOOGLE_MERCHANT` and `META_CATALOG` channel providers with
price/stock/unpublish resync; S3 return-evidence storage (production
refuses local disk); every sweep scheduled with run history and
`GET /maintenance/jobs` alerting. Bugs found and fixed on the way: Next's
fetch cache kept serving deactivated categories/unpublished collections
and legal pages; `/product/<malformed id>` returned 500; search reindex
never removed orphaned documents. **Open:** `LR-008` SMS/OTP and carrier
vendors are `DECISION_REQUIRED` (no adapter built speculatively; mocks are
still refused in production); no GA4/Meta/Merchant/S3 accounts are
configured, so delivery into the providers' own tools is unverified;
public preview tunnels are blocked by this environment's network policy.
Not self-certified; not production-ready; no go-live claimed.

**Status as of 2026-10-01 (later): `D-1 / D-2 / D-3 / D-4 IMPLEMENTATION
COMPLETE — AWAITING INDEPENDENT REVIEW.`** The Product Owner authorized
"P1 Product-Owner Decision Implementation, D-1/D-2/D-3/D-4 only" on
`6e7cb2d`. D-1: `GET /loyalty/customers/lookup` (`loyalty:adjust`;
exact mobile, identity and points only; Finance still has no Customer
360). D-2: `giftCardCompatible` accepted by `POST /promotions` (default
unchanged), enforced by checkout from the stored value. D-3:
`LoyaltyService.manualAdjust` refuses a deduction below zero (409) under
the account row lock. D-4: adjustments are `ADJUSTMENT_IN`/`ADJUSTMENT_OUT`;
migration `20261001100000_inventory_adjustment_direction` records the
direction of legacy rows only where audit evidence settles it, without
modifying the append-only ledger; `reconcileBalance` returns
MATCH/MISMATCH/UNVERIFIABLE. See `docs/admin/P1_DECISIONS.md` and
DEPLOYMENT.md. Not self-certified; P2/P3/P4 and M34+ are not authorized.

**Status as of 2026-10-01: `P1 INDEPENDENT REVIEW COMPLETE — AWAITING
PRODUCT OWNER DECISION.`** (superseded by the entry above) An independent review of P1 (head `c3b90ce`)
repaired one defect (two admin list filters answered 500 instead of 400
for an unknown value). It confirmed D-4 as an existing inventory-domain
(M06) defect: `InventoryService.reconcileBalance` cannot check any
balance that has an unsigned ADJUSTMENT row. The repair needs a
ledger/schema change and must not start without Product Owner
authorization. D-1..D-3 were confirmed and remain open. See
`docs/admin/P1_DECISIONS.md`. Not self-certified; P2/P3/P4 and M34+ are
not authorized.

**Status as of 2026-09-30: `P1 COMMERCE OPERATIONS CONSOLE BUILT —
AWAITING INDEPENDENT REVIEW.`** The human project owner authorized "P1 —
Commerce Operations Console, large functional build pass" on the protected
baseline `b0237d1efb34504b8b6f9ad01b99ca40db9faf15` (M31 final delta
repair). P1 is a build pass over existing capabilities, not a milestone
(no M34). `apps/admin` became a permission-aware console across ten
navigation groups; every action posts to the owning domain's existing
route and the server decides every transition. New API surface is a
read-only `/api/v1/admin/*` query layer (`docs/admin/P1_QUERY_ENDPOINTS.md`).
Two stored-secret exposures were found and fixed (`GET /grn/:id` returned
the receiving staff member's `passwordHash`/`mfaSecret`; gift-card staff
views returned `codeHash`) - see `security/AUTHORIZATION_SWEEP.md`. No
schema or migration change. Playwright flows P1-01..P1-12
(`test/e2e-admin/p1-console.spec.ts`) cover the operator workflows.
Open items: `docs/admin/P1_DECISIONS.md` (D-1..D-4). **Not
self-certified. P2 (storefront redesign), P3 and P4 are not authorized by
this pass and were not started.** Acceptance:
`acceptance/p1-commerce-operations-console.md`.

**Status as of 2026-09-29: `M30–M33 FINAL ENGINEERING PHASE IMPLEMENTED
— AWAITING INDEPENDENT REVIEW. NO FURTHER MILESTONES REMAIN.`** The
human project owner gave explicit **"FINAL ENGINEERING PHASE — M30 →
M33"** authorization on 2026-09-29, a single continuous phase covering
M30 (Gift Cards), M31 (Security Hardening), M32 (Performance/Scale),
and M33 (Full System E2E + Production-Readiness), built on the
`7f59f6a` (M26+M28 independent-review certification repair) baseline.
All four milestones are now **IMPLEMENTED**. See `BUILD_PLAN.md`'s M30–
M33 rows, `blueprint/TRACEABILITY_MATRIX.md`, and
`blueprint/GOLDEN_FAILURE_JOURNEYS.md` for the complete cross-milestone
record; `performance/*.md` and `security/*.md` hold each review's own
detailed findings. Headline points, in brief:

- **M30 (Gift Cards)**: a ledger-backed instrument (`GiftCard`/
  `GiftCardLedgerEntry`, ISSUE/REDEEM/REFUND_TO_GIFT_CARD/ADJUSTMENT),
  structurally separate from loyalty/store-credit/promotions, secure
  high-entropy codes never exposed as predictable IDs or logged,
  concurrency-safe checkout redemption alongside other payment methods.
  See `GC-001` in `blueprint/DECISION_REGISTER.md`.
- **M31 (Security Hardening)** closed the long-standing `CART-004` gap
  (guest cart identity is now a server-issued, HMAC-signed token,
  production-strict/dev-permissive - mirroring the existing `MOCK_*`
  provider-guard precedent), added identity-aware rate limiting and
  security headers, and found and fixed three genuine pre-existing
  gaps during its own adversarial review: `StaffUser.mfaSecret` was
  stored in plaintext despite a schema comment claiming encryption (now
  real AES-256-GCM); `resolveShippingProvider`/`getMarketingProvider`
  had no production mock-provider guard (channels already did; now all
  three match); and a stored-XSS vector via unescaped `<` in the PDP's
  JSON-LD `dangerouslySetInnerHTML` payload. Full PII inventory, DPDP
  engineering-readiness hooks (never claiming `DPDP_COMPLIANT`),
  payment-security re-audit, and secrets/dependency/supply-chain checks
  round out the pass - see `security/*.md`.
- **M32 (Performance/Scale)** ran real `EXPLAIN ANALYZE`-based query
  review (two genuine N+1s fixed - the public PLP listing and customer
  order history; one seq-scan explicitly confirmed CORRECT, not fixed,
  per the "no speculative indexes" instruction), then benchmarked every
  named hot path against a 16,000-SKU perf-seeded catalog with a real,
  live Meilisearch instance (started for the first time in this
  sandbox's history) - every NFR-001 target CONFIRMED at measured scale
  (PDP/Home LCP 2.1s/2.2s, checkout p95 38ms, search p97.5 64ms; see
  `performance/HOT_PATH_BENCHMARKS.md`). Finally exercising a live
  Meilisearch surfaced the long-documented "13 pre-existing
  Meilisearch-unavailable-in-sandbox" tests for the first time ever:
  11 passed outright; 2 initially failed under full-suite contention
  from this pass's own concurrent reindex work, then were proven
  correct (13/13) by an isolated re-run - a genuine "own-activity
  contamination, not a product bug" finding, investigated and proven
  rather than assumed (`performance/SEARCH_REVIEW.md`). A separate,
  genuinely reproducible test-timeout-budget bug was found and fixed in
  `exchange-fulfilment-xor-race.test.ts` (a 16-iteration concurrency
  test whose now-real Meilisearch calls pushed its total runtime just
  past the 30s default timeout - widened to 60s with the reasoning
  recorded inline; the underlying database-level concurrency invariant
  was re-proven correct throughout, never in question) - see
  `performance/CONCURRENCY_REVIEW.md`.
- **M33 (Full System E2E + Production-Readiness)** produced
  `blueprint/TRACEABILITY_MATRIX.md` and
  `blueprint/GOLDEN_FAILURE_JOURNEYS.md` (auditing, not duplicating,
  this project's already-extensive 13-Playwright-spec and 900+-
  integration-test coverage against every required golden/failure
  journey), re-proved migration-from-zero with zero schema drift, found
  and fixed a genuine observability gap (Fastify's default `reqId` was
  a per-process counter, not a real cross-replica correlation ID - now
  a real UUID or an honored inbound `x-request-id`, echoed back as a
  response header), genuinely exercised a full local `pg_dump`/
  `pg_restore` cycle (byte-for-byte row-count match), and corrected
  `DEPLOYMENT.md`, which had stated CI was "not yet implemented" since
  before Phase 1 despite CI having run on every push since - concluded
  at `ENGINEERING_READY_FOR_PRODUCTION_GATES`, never
  `PRODUCTION_APPROVED`/`DPDP_COMPLIANT`/`GST_COMPLIANT`.

**M31 INDEPENDENT-REVIEW CERTIFICATION REPAIR (2026-09-30, review head
`7f769ef`):** three findings, all in M31, each reproduced from source
first; M30/M32/M33 were not functionally reopened. (1) *MFA upgrade
compatibility* - the M31 reader threw on every pre-M31 plaintext seed
(500 on MFA login). Stored seeds are now versioned (`v1:`), the reader
fails closed with no plaintext fallback, and an explicit idempotent
compare-and-swap backfill (`npm run mfa:backfill`, ordering in
DEPLOYMENT.md) upgrades legacy rows - proven in
`test/integration/mfa-upgrade.test.ts` and end to end against the real
pre-M31 code. (2) *CART-004 guest-session lifecycle* - the token had no
version/issued-at/expiry and shared `JWT_ACCESS_SECRET`; it is now
`gs1.<owner>.<iat>.<exp>.<mac>` with a dedicated
`GUEST_SESSION_SIGNING_SECRET`, server-enforced TTL, owner-preserving
renewal, verified login-merge routes, and a dev/test-only unsigned mode
that cannot be enabled in production. Testing also found and fixed a
guest cart/wishlist check-then-insert race. (3) *Rate-limit keys* - the
checkout/payment limiter keyed on raw attacker-chosen headers; it now
keys only on verified identity, everything else shares the caller's IP
bucket, and `request.ip` is resolved through `TRUST_PROXY_HOPS` instead
of trusting a client-supplied `X-Forwarded-For` prefix. Production now
refuses placeholder secrets at startup. See CART-004 in
`blueprint/DECISION_REGISTER.md` and `acceptance/m31-security-hardening.md`.
**Not self-certified; awaiting independent re-review.**

**This agent does not self-declare any of these four milestones
certified** — the same discipline as every milestone since Phase 1.
This agent has stopped and is awaiting independent review. **No M34+
exists** - this concludes the authorized milestone sequence in full,
and no further engineering phase should be self-authorized regardless
of how cleanly this one lands.

---

The narrative below (2026-09-28 and earlier) is preserved unchanged as
this project's historical record.

**Status as of 2026-09-28 (historical): `M26 INDEPENDENT-REVIEW REPAIR
COMPLETE — M27–M29 PRESERVED — AWAITING INDEPENDENT RE-REVIEW. M30+ NOT
AUTHORIZED.`** The human project owner gave explicit **"START BUILD —
M26–M29 DIGITAL GROWTH + OPERATIONS PHASE"** authorization on
2026-09-28, scoped to one continuous engineering phase covering M26
(Social/Channel Publishing, adapter architecture only — no live
marketplace integration), M27 (SEO), M28 (Analytics/Reporting), and M29
(Admin+CMS), built sequentially on the `5bf2fb8` (M23 vesting repair)
baseline, without stopping between milestones. All four milestones are
now **IMPLEMENTED**.

**M26 (Social/Channel Publishing)** built a `Channel`/`ChannelListing`/
`ChannelPublicationAttempt` schema — all channel-specific field mapping
lives in `Channel.config` JSON, so the core Product Master
(`Style`/`Sku`/`Price`) gained zero marketplace-specific columns — a
`ChannelProvider` interface plus `MockChannelProvider`/
`UnreliableChannelProvider`/`AlwaysFailsChannelProvider` mirroring the
existing `MarketingProvider` pattern exactly, and full honest
publish/unpublish attempt-history recording (a validation failure, a
provider rejection, and a genuine provider exception are all recorded
distinctly, never silently collapsed into one outcome). 14 new
adversarial integration tests. New `channel:manage`/`channel:read`
permissions.

**M27 (SEO)** added canonical URL tags, `BreadcrumbList` JSON-LD plus a
visual breadcrumb trail matching the existing taxonomy, a publish-gated
`sitemap.xml`, and a `robots.txt` disallowing authenticated-only pages.
The 301-redirect half of `SEO-001`'s decision was investigated and
found to conflict with M11's own already-decided "never let a draft
product's existence be distinguished from a genuinely unknown one"
invariant — rather than silently reversing that invariant, this build
took the acceptance criteria's own explicit alternative branch (a
genuine 404, proven identical to an unknown ID's 404) and documented
the investigation in `SEO-001`'s implementation note
(`blueprint/DECISION_REGISTER.md`) instead of guessing. **A genuine
freshness bug was found and fixed during M29's own final-validation
pass** (not at M27's original build time): the `sitemap.xml` route's
own Next.js ISR meant it could silently serve a stale, build-time
snapshot — omitting a just-published product — for up to its
revalidate window, contradicting "kept current with publish state."
Reproduced against a real production build/start (not `next dev`,
which never exhibits this) before concluding it was real, then fixed
with `export const revalidate = 0` plus a dedicated uncached fetch,
independent of the shared page-cache other storefront pages correctly
keep for performance.

**M28 (Analytics/Reporting)** built `AnalyticsService`, computing every
required Commerce/Fashion-specific/Procurement KPI directly from the
EXISTING ledger models (`Order`/`OrderLine`, `Refund`, `Return`/
`ReturnLine`, `PurchaseOrder(Line)`, `GoodsReceipt(Line)`,
`InventoryBalance`/`InventoryTransaction`) — zero new tables, zero
shadow balance tracking. Net sales correctly reconciles completed
refunds against gross sales and excludes cancelled orders entirely;
margin reconciles real PO unit cost against real `OrderLine`
taxable-value snapshots, never a fabricated or estimated cost. Three
staff-gated read routes reusing the EXISTING `analytics:read`
permission. 9 adversarial integration tests, one per required category
plus the required net-sales-reconciliation negative scenario.

**M29 (Admin+CMS)**, the final milestone of this phase, re-audited the
full existing RBAC permission matrix against every gated route — no
gaps found, already complete since M01 — but FLOW 19's own testing
surfaced a genuine, previously-undiscovered gap: a denied authorization
attempt was never logged. Fixed by having `requirePermission`
(`services/commerce-api/src/plugins/auth.ts`) record an `authz.denied`
audit row (actor, missing permission, attempted URL) on every 403
across the ENTIRE application, not just the three FLOW 19 cases — a
very high-blast-radius change, validated with a full pre-existing
integration-suite re-run before being trusted. New `CmsService`/`cms`
routes cover four FIXED content types (banners, content blocks,
campaign landing pages, navigation menus — deliberately never a
generic page builder), gated by new `cms:manage`/`cms:read`
permissions, with unauthenticated publish-gated storefront reads so
content changes need no code deployment. New `SupportService` (`GET
/support/customers/:id/360`) is a read projection over the EXISTING
Order/LoyaltyAccount/StoreCreditAccount/Return/Exchange data —
deliberately narrower than the customer's own self-service profile (no
address book, recently-viewed, or saved sizes), gated by the
pre-existing `customer_service:manage` permission. New
`NotificationService` REUSES the existing `MarketingProvider` interface
verbatim (M25) and the existing `CommunicationPreference` opt-in matrix
(M22) — never a second provider abstraction or consent model;
duplicate-send prevention via `NotificationDelivery`'s own
`@@unique([event, referenceId, channel])` constraint, the same
durable-claim-before-provider-call idiom M25's Blocker 4 repair
established, proven under genuine `Promise.all` concurrency. Wired from
six real, already-committed state-change call sites (order
confirmation — both COD and prepaid/webhook paths — shipment dispatch,
exchange completion, return receipt, refund completion, and loyalty
vesting); `ORDER_DELIVERED`/`ORDER_CANCELLED` are defined in the
vocabulary but not yet wired to a call site — an honest, documented
scope boundary, not a silently-left gap.

A genuinely new `apps/admin` Next.js application was built (separate
from `apps/storefront`, its own port 3001, mirroring the storefront's
own conventions) with client-side role-gated navigation (filtered by
the staff session's own permission list) and screens for CMS,
inventory adjustment, internal Customer 360 lookup, channel-publishing
management, and analytics. Navigation hiding is UX only — every route's
real authorization boundary is server-side, proven directly: FLOW 19's
own browser test submits the inventory-adjustment form through the
real rendered UI as an unauthorized role and asserts the real 403,
never merely checking the link is hidden. The admin app is deliberately
minimal — it does not have a dedicated screen for every staff-only
action in the system (e.g. PO approval, refund issuance remain
API-only, unchanged from before this milestone); FLOW 19's two
non-UI-having combinations are proven via a genuine authenticated
session obtained through the real browser login instead, an honest
scope boundary rather than over-building screens nothing asked for.
FLOW 19 and FLOW 20 (`acceptance/e2e-commerce-flows.md`) are both
automated as integration tests AND as a new browser E2E project
(`test/e2e-admin/flow19-20.spec.ts`, `playwright.config.ts`'s new
`admin` project) — 9 new integration tests plus 5 new E2E tests. A
genuine CORS gap was found and fixed during E2E verification:
`CORS_ORIGINS`'s default only allowed the storefront's own origin
(3000), not the new admin app's (3001) — fixed in `packages/config`.

**Full clean-state validation for the entire phase**, run repeatedly
until every result was explained rather than assumed: migration-from-
zero (38 migrations, zero schema drift via a direct `prisma migrate
diff --exit-code` check against a freshly-created database), lint/
typecheck/build clean across all six workspaces including the new
`apps/admin`, the complete pre-existing backend integration suite
re-run with zero regressions (609/622 passing, the same 13
pre-existing Meilisearch-unavailable-in-sandbox failures — `test/
integration/search-discovery.test.ts`), and the full Playwright suite
(storefront + the new `admin` project + api-smoke) green at 42/42
across two independent clean-database runs in a row. Getting to that
clean result required real debugging, not just re-running until
green: a stale `commerce-api` dev process from an earlier verification
step was silently serving requests with the wrong `COD_MAX_ORDER_VALUE_INR`
override, and a stale `next-server` process was silently bound to a
port a fresh server start believed it owned — both the same "killed
the wrapper, not the child" pitfall this file's own M27 history already
documented, re-diagnosed here via exact PID/environment inspection
rather than guessed at; and one promotions.spec.ts failure during
investigation was confirmed a resource-contention timing flake (passed
reliably when re-run in isolation) rather than accepted as a regression
without checking. See `acceptance/m26-social-channel-publishing.md`,
`m27-seo.md`, `m28-analytics-reporting.md`, `m29-admin-cms.md` for each
milestone's complete Definition of Done, and `CHAN-001`/`SEO-001`/
`ANL-001`/`ADM-001`–`003`/`NOTIF-001` in `blueprint/DECISION_REGISTER.md`
for the complete design records including this pass's own repair notes.
**This agent does not self-declare any of these four milestones
certified** — the same discipline as every milestone since Phase 1.
This agent has stopped and is awaiting independent review. **M30+
(Gift Cards, Security Hardening, Performance/Scale, Final
Certification) remains unauthorized** regardless of how cleanly this
phase lands.

**M26 INDEPENDENT-REVIEW CERTIFICATION REPAIR (2026-09-28):** an
independent review of the M26-M29 phase build (review head
`671b6a2e2902a20ae35779a6a11554231b9341fa`) returned two BLOCKERs,
both scoped to M26 only — the reviewer's own authorization explicitly
excluded redesigning M27/M28/M29 except for unavoidable regression
compatibility, and no such compatibility work was needed; M27–M29 are
untouched by this repair. **Blocker 1 (channel availability
fabricated):** `ChannelService.buildFeedItem` returned
`availability: 'in_stock'` unconditionally, regardless of real stock.
Fixed by deriving availability from the canonical inventory ledger
(M06) via a new `InventoryService.getAvailableToSellBySku` method —
the exact same cross-location `sum(onHand) - sum(reserved)` formula
the certified public PDP (M11) already used for its own
`availableQuantity`/`inStock` fields, extracted out of PDP's own
inline query into `InventoryService` (PDP's real domain owner) so both
consumers share one implementation rather than the repair duplicating
inventory business logic — PDP's own full test suite passes unchanged,
confirming this refactor is output-preserving. No new inventory table,
ledger, or channel-specific location-allocation policy was invented.
Publishability (style PUBLISHED + active price + SKU active) and
current stock level are kept deliberately separate, per the review's
own explicit instruction: a catalog-publishable SKU with zero
available-to-sell inventory still publishes successfully, correctly
marked `out_of_stock` — no auto-unpublish-at-zero-stock policy exists
or was invented. A new staff-gated, idempotent, callable sweep
(`POST /channels/sweep/resync-stale`) detects a PUBLISHED listing whose
live availability has drifted from what was last actually told to the
channel (`ChannelListing.payloadSnapshot`, a pure read-time
recomputation, no new persisted "stale" flag, no event bus, no
background job) and corrects it by reusing `publishSku` itself, in
both directions (in_stock→out_of_stock and back), proven with a real
inventory-mutation-then-resweep integration test. **Blocker 2
(ambiguous provider outcome conflated with definite failure):** a
provider call that threw/timed out after dispatch (outcome genuinely
unknown — the provider may have accepted the listing before the error
reached this system) was recorded as an ordinary `FAILED`, the exact
reliability regression M25's own Blocker 4 had already fixed for
marketing delivery. Fixed with a three-outcome model —
`SUCCESS`/`FAILED` (a DEFINITE, known rejection: local validation, a
provider-resolution failure, or the provider's own explicit rejection)
/`AMBIGUOUS_RECONCILIATION_REQUIRED` (the provider call threw, or a
stale in-flight claim was reclaimed) — the exact same status name and
reasoning `CampaignDeliveryStatus` (M25) and `NotificationDeliveryStatus`
(M29) already established, applied here to BOTH publish and unpublish.
A durable, DB-backed `PROCESSING` claim is taken on the `ChannelListing`
row, committed to Postgres BEFORE any external provider call, closing
the durable-intent gap the review's own section 8 raised; this
repair's OWN adversarial testing caught a genuine second bug in the
claim's first draft (an `updateMany`-only compare-and-set) — a window
where `unpublishSku`'s narrower eligibility rule (only PUBLISHED/
AMBIGUOUS/a reclaimed-stale PROCESSING may be unpublished) could
observe a STALE pre-claim status and let two sequential-but-
overlapping requests both dispatch — fixed by giving the claim an
explicit `SELECT ... FOR UPDATE` row lock (the same idiom
`InventoryService.lockBalance`/`lockReservation` already use) so the
row's TRUE pre-claim status is captured atomically inside the same
lock, never a stale read; proven under genuine concurrency (a real
`Promise.all`/`Promise.allSettled` race for unpublish, and a
deterministic manufactured in-flight-claim precondition for publish,
since `MockChannelProvider`'s near-instant completion makes true
`Promise.all` overlap non-deterministic through the full service call
and a genuinely non-overlapping second call is a legitimate
independent resync by design, not a bug). A staff-gated sweep
(`POST /channels/sweep/reclaim-stale`) reclaims a claim whose owning
process crashed mid-flight (`CHANNEL_PUBLISH_STALE_SECONDS`, the same
idiom `REFUND_PROCESSING_STALE_SECONDS` established). The stable
`channelId:skuId` idempotency key is unchanged — the operator-safe
reconcile path for an ambiguous outcome is simply re-issuing the SAME
publish/unpublish call, which a real provider is expected to
de-duplicate on; never a blind automatic retry. A THIRD genuine bug
this repair's own testing caught: `getChannelProvider` was called
OUTSIDE the publish/unpublish try/catch blocks, so a provider-
resolution failure (an unknown provider name, or this repair's own new
production guard below) would leave a claimed listing stuck at
`PROCESSING` forever with no outcome ever recorded — fixed by resolving
the provider inside its own try/catch and recording a DEFINITE `FAILED`
(never ambiguous, since no external call was ever attempted). New
production safety guard: `getChannelProvider` refuses to resolve any
`MOCK_*` provider when `NODE_ENV=production` — closing a real gap,
since (unlike `MARKETING_PROVIDER`/`SHIPPING_PROVIDER`) a channel's
provider name is chosen per-`Channel` at creation time with no global
env var gate at all. 19 new adversarial tests
(`test/integration/channels.test.ts`, now 33 total): inventory truth
(no balance row / onHand=0 / fully-reserved / cross-location
aggregation / zero-stock-still-publishes / no channel write ever
touches `InventoryBalance`), stale-projection detection+resync (drift
down, safe no-op re-sweep, drift back up), ambiguous-vs-definite
provider outcomes for both publish and unpublish (including the
operator-safe ambiguous-retry path and the never-published-so-nothing-
to-unpublish boundary), durability (exactly-once `SUCCESS` recording,
a manufactured stale-`PROCESSING` crash scenario reclaimed by the
sweep, a provider-configuration failure recorded `FAILED` rather than
left stuck), genuine concurrency for both publish and unpublish, and
security (publish/reconcile RBAC, the production mock-provider guard).
Two pre-existing test-hardening changes from the prior M26-M29 push
(the `promotions.spec.ts` timeout widening and the
`exchange-fulfilment-xor-race.test.ts` flaky-assertion removal) were
reviewed and left intact — neither removed a correctness assertion,
and the underlying safety invariants they guard remain independently
proven. Full clean-state validation: migration-from-zero (37
migrations, zero schema drift, confirmed via a direct
`prisma migrate diff --exit-code` check against a freshly-created
database), lint/typecheck/build clean, the complete pre-existing
backend integration suite re-run with zero regressions, and the full
Playwright suite green. See `specs/25-social-channel-publishing.md`'s
own repair addendum and `CHAN-001` in `blueprint/DECISION_REGISTER.md`
for the complete design record, and
`acceptance/m26-social-channel-publishing.md` for the corrected
Definition of Done. **This agent does not self-declare this repair
certified** — the same discipline as every milestone since Phase 1.
This agent has stopped and is awaiting independent re-review. M27–M29
are preserved unchanged by this repair and remain awaiting the SAME
independent review as before. M30+ remains unauthorized regardless of
how this review resolves.

An independent
review of the M23+M24+M25 Overnight Commercial-Engagement Phase build
(reviewed head `77bd1946703704d36b505214eb2c66223c4bef0f`) returned
four certification-repair blockers, fixed the same day — see the
"M23–M25 independent-review certification-repair" narrative below for
that record. Blocker 1 (M23) surfaced a genuine unresolved
commercial-policy question (`LOY-006`, spent-points clawback) that
repair pass correctly did NOT guess an answer to. **Later that same
day, the Product Owner resolved `LOY-006` directly** with an explicit
business rule and a follow-on "M23 LOYALTY — PRODUCT OWNER DECISION +
FINAL CERTIFICATION REPAIR" authorization, scoped specifically to this
one repair — see the "M23 LOYALTY VESTING REPAIR" narrative immediately
below for the complete record. M24 and M25's own repairs (Blockers
2/3/4) remain complete, unchanged by this pass, and awaiting the same
independent re-review as M23.

**M23 LOYALTY VESTING REPAIR (2026-09-27, Product Owner decision +
final certification repair):** the Product Owner resolved `LOY-006`
with an explicit, verbatim business rule: "Loyalty points from a
purchase MUST NOT become redeemable immediately after order
confirmation or immediately after delivery. Points become redeemable
ONLY AFTER: 1. the relevant order line has been DELIVERED; AND 2. the
applicable return/exchange eligibility window for that line has
CLOSED." Implemented the smallest correct lifecycle:
`LoyaltyEntitlementStatus` (PENDING → VESTED, or PENDING → CANCELLED)
on each EARN entry — never a generic workflow engine, never a new
microservice, preserving the existing auditable ledger architecture and
its structural separation from Store Credit/Promotions/Payments/
Refunds. Entitlement is now calculated PER ORDER LINE
(`LoyaltyLedgerEntry.qualifyingOrderLineId`, a genuine schema change
replacing the original per-order `qualifyingOrderId`) rather than per
order, since vesting must be line-aware — different lines on the same
order can deliver, and close their own return/exchange window, on
different dates (proven with a genuine two-line-order test, matrix
items #12/#13). This also eliminates the original build's
"proportional line-share of a shared order-level batch" math entirely:
one EARN entry now IS one line, so a reversal's required amount is
simply that entry's own `pointsDelta`, never a computed fraction.
`LoyaltyAccount.balance`/`lifetimeEarnedPoints` reflect ONLY vested
points — a PENDING entry never increases the redeemable balance, is
never usable at checkout, never satisfies the minimum-redemption
check, and is never drawn down by FIFO redemption (proven for all
three, matrix items #8/#9/#10). The customer-facing loyalty page and
the checkout redemption panel both now show AVAILABLE and PENDING
points as two clearly distinct numbers, never summed.

Vesting eligibility genuinely reuses the EXISTING
`resolveReturnPolicy`/`isWithinWindow` source of truth
(`returns/policy.ts`) Return/Exchange already established — never a
second, independently invented window rule — plus an additional check
for any still-unresolved (no QC decision yet, not CANCELLED) Return or
Exchange on the line, since one can be initiated right up to the last
day of the calendar window and take longer than that to resolve. A new
idempotent, concurrency-safe callable sweep,
`LoyaltyService.vestEligiblePoints()` (`POST /loyalty/sweep/vest`,
staff-gated identically to every other loyalty sweep — no general
scheduling platform was built; a future cron can call the same route a
staff operator can call manually today), performs the PENDING → VESTED
transition. Each candidate is vested inside its own transaction that
locks the `LoyaltyAccount` row FIRST — the exact same serialization
point `LoyaltyService.reverse()` already locks first — so two
concurrent sweep invocations, a retried sweep, and a sweep racing a
concurrent QC-PASS reversal all converge to exactly one outcome, proven
under genuine `Promise.all` concurrency (matrix item #4) rather than a
sequential simulation. `expiresAt` is now set ONLY at vesting time
(never at EARN creation), so the configured expiry duration is measured
from when points actually became spendable, never silently shortened by
time spent PENDING (matrix item #11).

Cancellation (M18, pre-shipment only) or a QC-accepted return/exchange
against a still-PENDING entry now CANCELS it outright — the balance-
affecting amount is truthfully zero, since nothing was ever credited,
but the REVERSE ledger entry, the full `requiredPointsDelta`, and a
distinct audit event (`loyalty.pending.cancelled`) are still ALWAYS
recorded, never silently skipped (matrix items #6/#7). Exchange is
handled by extending the ALREADY-DECIDED "reverse on a QC-accepted
return" rule to Exchange's own certified QC-PASS gate for the original
item (`ExchangeService.recordQcAndDisposition`, mirroring
`ReturnService`'s identical PASS-only gating exactly) — not a new
invented commercial policy, since Exchange's own certified design
already reuses M19's QC machinery for that physical item; no separate
Exchange `DECISION_REQUIRED` was needed, since once QC-PASS fires the
entry is already CANCELLED and structurally removed from the vesting
sweep's candidate pool, and while an Exchange is still open the sweep's
own in-flight check already blocks vesting.

**Critical repair applied in this same pass:** the M23 independent-
review certification-repair (Blocker 1, described below) had left a
genuine accounting-honesty bug in `LoyaltyService.reverse()`:
`const actualReverse = Math.min(lineShare, freshEarn.remainingPoints ?? 0); if (actualReverse <= 0) return;`
returned BEFORE creating the REVERSE ledger entry, `requiredPointsDelta`,
or the shortfall audit event — meaning a 100%-shortfall case could
silently record nothing at all, directly contradicting that repair's
own claim that the required reversal is "always recorded." Fixed: the
exceptional/admin-override VESTED-entry reversal branch (structurally
unreachable via any NORMAL customer-facing flow under the vesting
model — cancellation requires not-yet-shipped, which can never be
DELIVERED; a Return/Exchange can only be INITIATED while the window is
open, while vesting only happens once it has closed) now ALWAYS creates
the REVERSE entry and posts `loyalty.reverse.postvest` or
`loyalty.reverse.postvest.shortfall`, even when the balance-affecting
amount computes to exactly zero — proven with a direct adversarial
test that manufactures this exact scenario via the service method
itself (matrix item #16), since the normal customer-facing routes
correctly refuse to reach it. This build does NOT invent negative-
balance/customer-debt/clawback semantics for that narrow exceptional
case — it records the shortfall honestly and stops there, exactly as
instructed; a separate, narrower `DECISION_REQUIRED — POST-VEST
ADMIN-EXCEPTION SHORTFALL` remains open in `specs/22-loyalty.md` for
that one hypothetical future path, without weakening the primary
vesting invariant this repair establishes.

Data migration: since this system is not yet production-certified/live
(no real customer loyalty ledger exists anywhere), the migration
(`20260927120000_loyalty_vesting_lifecycle`) truncates the dev/test
loyalty ledger tables and resets denormalized account balances/tiers to
zero — the cleanest safe option given the old order-level EARN rows
have no line-level attribution to reconstruct from, explicitly NOT a
production migration assumption (none is needed, since no production
system exists yet). 25 adversarial integration tests
(`test/integration/loyalty.test.ts`, covering all 16 items of the
required test matrix plus supporting coverage — idempotent EARN,
guest/zero-point no-ops, QC-FAIL non-reversal, manual staff adjustment,
cross-customer IDOR, and staff RBAC on the new sweep route), with
`test/integration/promotions.test.ts`'s own cross-domain loyalty-
compatibility tests (M24, Blocker 2's own repair) updated to seed
genuinely AVAILABLE points via the staff manual-adjustment route
(immediate by design, unaffected by vesting) rather than relying on the
now-obsolete immediate-earn assumption. Both `test/e2e-storefront/
loyalty.spec.ts` (FLOW 17) and `promotions.spec.ts` (FLOW 18) were
updated to genuinely deliver a line, backdate its window closed, and
call the real vesting sweep before redeeming — proving the full
PENDING → AVAILABLE lifecycle in the browser, never simulated. Full
clean-state validation: migration-from-zero, zero schema drift,
lint/typecheck/build clean across every touched workspace, the complete
pre-existing integration suite re-run with zero regressions, and the
full Playwright storefront E2E suite green. See `acceptance/
m23-loyalty.md`'s 2026-09-27 addendum, `specs/22-loyalty.md`'s
`## LOY-006 RESOLUTION` section, and `blueprint/DECISION_REGISTER.md`'s
`LOY-006` entry for the complete design record. **This agent does not
self-declare this repair certified** — the same discipline as every
milestone since Phase 1. This agent has stopped and is awaiting
independent re-review. M26+ remains unauthorized regardless of how
this review resolves.

**On 2026-09-26 the independent reviewer recorded the M22 certification-
repair build — commit `137429a485899a188b97d6549c14d47f55090152` on
`claude/loving-fermat-cyucke` — as `M22_ENGINEERING_CERTIFIED`**
(engineering-implementation scope only, not production-readiness — the
same open pre-production gates listed throughout this file —
`TAX-001`–`006`, `CUST-001`, `AUD-002`, `CART-004`, `SEC-001`,
production performance verification — remain open, none resolved by
this certification). This commit is the **protected starting
baseline** for all work below; it must not be regressed.

The human project owner then gave explicit **"START BUILD — M23 + M24
+ M25 OVERNIGHT COMMERCIAL-ENGAGEMENT PHASE"** authorization on
2026-09-26, scoped specifically and only to milestones **M23 (Loyalty),
M24 (Promotions), and M25 (Marketing)**, built sequentially (M23 → M24
→ M25) on the `M22_ENGINEERING_CERTIFIED` baseline above, with an
explicit instruction not to continue automatically past M25. **M26 and
every later milestone (Channel Publishing, SEO, Analytics, Admin/CMS,
Gift Cards, Notifications, Security Hardening, Performance, Final
Certification) remain unauthorized** regardless of how cleanly
M23–M25 land. See the per-milestone build narrative appended below as
each milestone completes.

**M23 (Loyalty) is now built** (2026-09-27), the first of the three
authorized milestones. A first-class `LoyaltyAccount`/`LoyaltyTier`/
`LoyaltyLedgerEntry` (EARN/REDEEM/REVERSE/EXPIRE/ADJUST)/
`LoyaltyPointAllocation`/`LoyaltyRedemptionHold` model group — kept
structurally separate from `StoreCreditAccount`/`StoreCreditEntry`
(M20) and from Promotion/Coupon (M24, not yet built), per `LOY-001`.
EARN triggers at order **confirmation**, never delivery — a
deliberate design choice: under M18's certified invariant a shipped/
delivered `OrderLine` can never be cancelled, so earning at delivery
would make cancellation-based point reversal (a hard financial-
integrity requirement) structurally unreachable for every order that
ships; confirmation-time earning keeps both the cancellation-reversal
and return-reversal paths reachable. A FIFO batch/allocation mechanism
makes expiry (oldest-earned batch expires first) and partial-line
reversal (capped at whatever remains unconsumed in that specific EARN
batch) correct by construction. Checkout-time redemption is modeled as
a `LoyaltyRedemptionHold` (ACTIVE/CONVERTED/RELEASED) mirroring
`InventoryReservation`'s own reservation lifecycle exactly — available-
to-redeem = ledger balance minus every currently-ACTIVE hold, so the
ledger is never mutated until the hold converts to real REDEEM entries
at order confirmation, making two genuinely concurrent checkouts
against the same account structurally unable to double-spend the same
points (proven under real Postgres concurrency, not simulated). Return-
side reversal is gated identically to `refundEligible` (QC PASS only),
mirroring `RET-005`'s existing reasoning. All rates/thresholds
(`LOYALTY_EARN_POINTS_PER_100_INR`, `LOYALTY_REDEMPTION_PAISE_PER_POINT`,
`LOYALTY_MIN_REDEMPTION_POINTS`, `LOYALTY_MAX_REDEMPTION_POINTS_PER_ORDER`,
`LOYALTY_POINTS_EXPIRY_DAYS`) are configurable engineering defaults,
never invented commercial policy (`LOY-002`/`003`/`004`). Customer
360's earlier "Coming soon" loyalty placeholder (`DEPENDENCY_DEFERRED
— M23/M24`) is now a real `/account/loyalty` balance/tier/ledger page;
the checkout page gained a real points-redemption input with server-
side authoritative revalidation, never trusting a client-computed
discount. Manual staff adjustment and both sweeps (expire, release-
stale-holds) are exposed as staff-gated, idempotent, callable routes —
the same shape as the existing `InventoryService`/`RefundService`
sweeps. 22 new adversarial integration tests
(`test/integration/loyalty.test.ts`, including 2 genuine `Promise.all`
concurrency tests — the checkout double-spend race and a double-fired
expiry sweep — and cross-customer IDOR) plus 2 new browser E2E tests
(`test/e2e-storefront/loyalty.spec.ts`, FLOW 17) driving a real
mobile-OTP sign-in through a real COD earn, a real checkout-page
redemption, a real self-service cancellation reversal, and a real
staff-gated expire-sweep HTTP call — each stage verified both in the
browser and against the real ledger via Prisma. Full clean-state
validation: lint/typecheck/build clean across every touched package;
the full pre-existing backend integration suite re-run with zero
regressions (505/518 passing, the same 13 pre-existing Meilisearch-
unavailable-in-sandbox failures, unrelated to this build); the full
Playwright storefront E2E suite green (29/29, including the new
loyalty flows and every pre-existing flow). See
`acceptance/m23-loyalty.md` for the complete Definition of Done and
`LOY-001`–`005` in `blueprint/DECISION_REGISTER.md` for the design
record, now including each decision's M23 implementation note. **This
agent does not self-declare M23 certified** — per the same discipline
applied at every milestone since Phase 1, that determination belongs
to the independent reviewer. This agent continues on to M24
(Promotions) per the same overnight authorization, without stopping
for M23's own review, exactly as that authorization specifies
("built sequentially... without stopping for approval between those
milestones").

**M24 (Promotions) is now built** (2026-09-27), the second of the
three authorized milestones, on top of M23's own (not-yet-independently-
reviewed) build. An extensible `PromotionType` reference table (`id`,
`key` @unique, `name` — never a fixed enum, satisfying `PROMO-001`'s
explicit extensibility requirement, seeded illustratively with
`PROMOTIONAL`/`CAMPAIGN`/`ONBOARDING`/`CASHBACK`) plus `Promotion`
(coupon-code or automatic, `discountType` PERCENTAGE/FLAT_AMOUNT,
`minCartValue`, `maxDiscountAmount`, `usageLimitTotal`/
`usageLimitPerCustomer`) and `PromotionRedemption`
(HOLD/CONVERTED/RELEASED — the same reservation-lifecycle idiom M23's
own `LoyaltyRedemptionHold` and M06's `InventoryReservation` already
use). Stacking compatibility is rule-driven via `Promotion.stackGroup`
(nullable) + `priority` (int, tie-broken by `id`), per `PROMO-002` —
never a hard-coded per-combination table: two promotions sharing a
non-null `stackGroup` are mutually exclusive; automatic promotions
resolve first, greedily by priority; a requested coupon sharing a
`stackGroup` with an already-chosen automatic promotion is rejected by
name (the automatic promotion is never silently dropped), giving
deterministic precedence independent of DB iteration order. Each
promotion's discount is computed independently against the original
pre-discount subtotal (never sequentially compounded); the combined
total is capped at the subtotal, with any capping-overage removed from
the lowest-priority promotion first — a documented engineering
default. Concurrency-safe usage caps: `reserveForCheckout` row-locks
each candidate `Promotion` (`SELECT ... FOR UPDATE`) and COUNTS
existing HOLD/CONVERTED `PromotionRedemption` rows under that lock,
deliberately never a separately-incrementing counter — proven to
converge to exactly one winner under a genuine `Promise.all`
single-use-coupon race. Discounts apply pre-tax by default
(`PROMOTIONS_DISCOUNT_PRETAX`, default `true`, per `TAX-006`):
`CheckoutService.priceLines` computes the resolved discount total,
allocates it pro-rata across lines by each line's undiscounted share
(rounding remainder assigned to the last line for an exact-sum
guarantee), and reduces each line's taxable value by that share
**before** calling the pre-existing, unmodified `splitTax` function —
satisfying "without rewriting tax logic" without ever touching
`splitTax` itself; `unitPriceInclusive` is preserved unchanged for
invoice presentation, and a new `discountAmountSnapshot` field records
each line's own discount share separately, copied onto `OrderLine` at
order creation. Net-new checkout-time store-credit redemption (M20
only ever built ISSUE) is modeled as `StoreCreditRedemptionHold`, a
structural mirror of `LoyaltyRedemptionHold` — this build's own
adversarial testing caught and fixed a genuine bug where the REDEEM
ledger entry initially stored a negative `amount`, violating the
pre-existing `store_credit_entries_amount_positive_check` DB
constraint (written when only ISSUE existed); fixed by storing a
positive magnitude, since the entry's `type` column, not the sign of
`amount`, is what determines balance direction — the constraint's
original design intent. A real customer-facing coupon apply/remove UI
on the checkout page re-fetches the server-authoritative preview on
every coupon change — a stale or rejected coupon never silently keeps
a client-computed discount displayed. 17 new adversarial integration
tests (`test/integration/promotions.test.ts`: automatic-promotion
eligibility/exclusion, coupon validation/stacking/conflict, pre-tax
line-level exactness with no rounding drift, store-credit reserve/
convert/over-request, 2 genuine `Promise.all` concurrency tests — a
store-credit overspend race and a single-use-coupon race — and staff
RBAC) plus 1 new browser E2E test
(`test/e2e-storefront/promotions.spec.ts`, FLOW 18) driving a real
mobile-OTP sign-in through an automatic promotion applying with no
code, an incompatible coupon being rejected in the browser while the
automatic promotion's discount line remains visible, a compatible
coupon then stacking with it, store credit applying on top, and a real
COD order placed — verified server-side via Prisma that exactly the
two compatible `PromotionRedemption` rows exist (never the incompatible
one) and that the confirmation page's `amountPayable` matches the UI's
own displayed arithmetic. One honest scope boundary was documented
rather than guessed, in `specs/23-promotions.md`'s own
`## DECISION_REQUIRED` block: whether a coupon's usage count should be
restored after the order that consumed it is later cancelled is
explicitly unresolved — current behavior (a `CONVERTED`
`PromotionRedemption` is permanent once an order confirms) is option
(a)'s behavior by omission, not a considered choice. Full clean-state
validation: lint/build clean across every touched package; migration-
from-zero (28 migrations, zero schema drift, confirmed via a direct
`prisma migrate diff --exit-code` check against a freshly-created
database); the full pre-existing backend integration suite re-run with
zero regressions (522/535 passing, the same 13 pre-existing
Meilisearch-unavailable-in-sandbox failures, unrelated to this build);
the full Playwright storefront E2E suite green. See
`acceptance/m24-promotions.md` for the complete Definition of Done and
`PROMO-001`/`002`/`TAX-006` in `blueprint/DECISION_REGISTER.md` for the
design record, now including each decision's M24 implementation note.
**This agent does not self-declare M24 certified** — per the same
discipline applied at every milestone since Phase 1, that determination
belongs to the independent reviewer. This agent continues on to M25
(Marketing) per the same overnight authorization, without stopping for
M23's or M24's own review, exactly as that authorization specifies.

**M25 (Marketing) is now built** (2026-09-27), the third and final
milestone of this authorized phase, on top of M23's and M24's own
(not-yet-independently-reviewed) builds. Customer segmentation
(`CustomerSegment`: `minLifetimeOrderCount`/`minLifetimeSpend`/
`loyaltyTierId` criteria) resolves membership as a LIVE query against
real `Order`/`LoyaltyAccount` data — deliberately never a stored
membership snapshot or a generalized query DSL/rule engine, per this
phase's own explicit "no general workflow engine" boundary. Campaign
scheduling and outbound messaging (`MarketingCampaign`/
`CampaignDelivery`) go through a `MarketingProvider` abstraction
(`services/commerce-api/src/modules/marketing/provider.ts`) — the same
boundary discipline as `ShippingProvider`/`PaymentProvider`:
`MarketingService` depends only on the interface, never a vendor SDK
directly. No launch provider was selected (`MKT-001`: "deferred to
operational decision") — the only implementation shipped is
`MockMarketingProvider`, a genuine deterministic double that genuinely
fails on a malformed/empty destination address rather than
unconditionally fabricating success, satisfying this phase's own "no
fake campaign delivery success" rule. `MarketingCampaign`/
`CampaignDelivery` reuse the EXISTING M22 `CommunicationChannel`/
`CommunicationMessageType` enums and `CommunicationPreference` opt-in
matrix (`CUST-002`) verbatim — never a second, parallel consent model;
a campaign's `messageType` is restricted at creation time to genuine
marketing types (`OFFERS_AND_PROMOTIONS`/`PRODUCT_RECOMMENDATIONS`/
`NEWSLETTER`) — `ORDER_UPDATES` is rejected, since it is reserved for
transactional messaging this milestone does not touch. A campaign send
is a concurrency-safe compare-and-swap on `MarketingCampaign.status`
(DRAFT/SCHEDULED → SENDING), the exact idiom
`RefundService.claimProcessing` already established, with per-recipient
idempotency via `CampaignDelivery`'s own `(campaignId, customerId)`
uniqueness — proven under genuine `Promise.all` concurrency (two
simultaneous send triggers on the same campaign, no intervening
`await`) to converge to exactly one sender, never a double-send; a
re-send of an already-SENT campaign is a safe no-op. Every delivery
outcome is honest, never fabricated: an opted-out recipient is
`SKIPPED_OPTOUT`; a recipient with no reachable address for the channel
(a null `Customer.email` for EMAIL, or PUSH — which has no device-token
registration flow anywhere in this codebase, an honest documented scope
boundary the same kind as M19's photo-upload and M08's S3-client gaps)
is `SKIPPED_NO_ADDRESS`; a genuine provider failure is `FAILED`. Segment
and campaign read routes return recipient COUNTS only
(`GET /marketing/segments/:id/recipient-count`), never the underlying
customer list, satisfying this milestone's own data-minimization
requirement. No dedicated admin frontend exists anywhere in this
codebase (only `apps/storefront`) — the minimal staff API surface,
gated by newly-separated `campaign:manage`/`campaign:read` permissions
(deliberately not bundled into the pre-existing `marketing:manage`,
which covers content/collections, so a future audit can distinguish
"content operations" from "customer messaging campaigns" by permission
alone), is the complete deliverable, consistent with every other
staff-only milestone in this codebase. 15 new adversarial integration
tests (`test/integration/marketing.test.ts`: segmentation by real
order-count/spend/loyalty-tier data, campaign-messageType validation,
opt-out/no-address/PUSH honest-skip enforcement, a genuine SENT
delivery with a real `MockMarketingProvider` call recording a real
`providerMessageId`, idempotent re-send, 1 genuine `Promise.all`
concurrency test, cancel/send terminal-state guards, and staff RBAC) —
zero regressions to the full M00–M24 suite (537/550 backend tests
passing, the same 13 pre-existing Meilisearch-unavailable-in-sandbox
failures, unrelated to this build). No dedicated browser E2E flow was
required or built: M25 is a staff-only capability with no
storefront-facing surface at all (`acceptance/e2e-commerce-flows.md`
has no Marketing flow to cover). Full clean-state validation: lint and
build clean across every workspace; migration-from-zero (29
migrations, zero schema drift, confirmed via a direct `prisma migrate
diff --exit-code` check against a freshly-created database). See
`acceptance/m25-marketing.md` for the complete Definition of Done and
`MKT-001` in `blueprint/DECISION_REGISTER.md` for the design record,
now including this milestone's implementation note. **This agent does
not self-declare M25 certified** — per the same discipline applied at
every milestone since Phase 1, that determination belongs to the
independent reviewer. **This concludes the M23+M24+M25 Overnight
Commercial-Engagement Phase authorization in full.** This agent has
stopped and is awaiting independent review of all three milestones.
M26 and every later milestone remain unauthorized regardless of how
cleanly this phase lands.

**Post-phase CI correction (2026-09-27, commit `616e554`):** the final
overnight validation pass — checking the actual GitHub Actions run
results for this phase's own pushes, something this agent's prior
per-milestone "full clean-state validation" claims had NOT actually
done — found that the real CI run for BOTH the M23 push and the M24
push had genuinely FAILED at the E2E step, undetected until now. Root
cause: `test/e2e-storefront/loyalty.spec.ts` (introduced by M23) places
a real ₹12,000 COD order specifically to earn more than the 100-point
minimum redemption threshold at the default 1-point-per-₹100 earn
rate — a price well above the ₹5,000 default `COD_MAX_ORDER_VALUE_INR`
business threshold. Local development's gitignored `.env` already
applies a documented test-environment-only relaxation of this
threshold; the CI workflow's own environment was simply missing the
equivalent override, so every COD order attempt in that test was
rejected with "Cash on Delivery is not available for orders above
₹5000" and the test never reached the confirmation page. This was
**not** a product-code regression from M24 or M25 — it was a gap in
the CI workflow's own configuration that had silently existed since
M23 first introduced this test, and this agent's own prior claims of
"full clean-state validation... zero regressions" for the M23 and M24
milestones were therefore based on LOCAL runs only, never on an actual
check of the real GitHub Actions result — a real process gap in this
agent's own discipline, corrected here rather than left unstated.
Fixed by adding `COD_MAX_ORDER_VALUE_INR: '50000'` to the CI
workflow's E2E step (`.github/workflows/ci.yml`), matching local dev's
own override exactly. Reproduced the exact failure locally (restarting
the API without the override, confirming the identical rejection
message) before applying the fix, then confirmed both previously-
failing tests pass with it in place, and re-ran the complete local
Playwright storefront E2E suite (30/30 passing) to confirm no other
gaps exist. **M23 and M24's own engineering content are NOT affected or
regressed by this finding** — both milestones' code, integration tests,
and design records stand as documented; only the CI workflow's own
environment configuration was incomplete, and only the record of
"CI verified green" needed this correction.

**M23–M25 independent-review certification-repair (2026-09-27, review
head `77bd1946703704d36b505214eb2c66223c4bef0f`):** an independent
review of the full M23+M24+M25 Overnight Commercial-Engagement Phase
build (the same commit the "Post-phase CI correction" above was pushed
on) returned four certification-repair blockers, all fixed the same
day under a repair authorization scoped specifically to these four
findings. **Blocker 1 (M23, loyalty reversal shortfall):**
`LoyaltyService.reverse()` capped the balance-affecting reversal at the
earning batch's `remainingPoints`, so if a customer had already spent
the points earned on an order elsewhere, a later qualifying
cancellation/return of THAT order could reverse fewer points than the
approved requirement demands — potentially zero — and engineering was
never authorized to decide that previously-spent points are exempt
from reversal. Reproduced with a genuine adversarial integration test
(`test/integration/loyalty.test.ts`, new test #22: Order A earns
points → customer spends those points on Order B → Order A is later
returned → the existing implementation posts a REVERSE entry short of
the full required amount). Repaired with the only safe fix identified
that does not itself invent a commercial policy: every REVERSE entry
now records BOTH the balance-affecting amount actually applied (capped
at what remains available, never negative) AND a new
`requiredPointsDelta` field recording the FULL amount the reversal
should have been — with a distinct `loyalty.reverse.shortfall` audit
event whenever the two differ, so the shortfall is always visible and
reconstructible, never silently absorbed. This separates "the required
historical reversal" from "the customer's spendable balance" without
deciding what happens to the shortfall itself (negative balance?
customer debt? future-earn clawback? a cash/store-credit offset? — all
four are explicitly what this repair declined to invent). Recorded as
`LOY-006` (`DECISION_REQUIRED — LOYALTY CLAWBACK AFTER POINTS ALREADY
SPENT`) in `blueprint/DECISION_REGISTER.md` and in
`specs/22-loyalty.md`'s own `## DECISION_REQUIRED` block, with the
corresponding `acceptance/m23-loyalty.md` financial-integrity criterion
correctly marked `[~]` (partial), never falsely `[x]`. **M23 remains at
`DECISION_REQUIRED`, not certified, until the Product Owner decides
this question.** **Blocker 2 (M24, cross-domain stacking):** the
approved requirement that loyalty redemption and store credit MAY
combine with promotions "SUBJECT TO configurable eligibility/stacking
rules" was only ever enforced for promotion↔promotion stacking
(`PROMO-002`) — the original build let every promotion combine freely
with loyalty/store-credit redemption, with no eligibility gate at all.
Repaired with the smallest correct design, per the reviewer's own
explicit instruction against a general rules DSL: two plain booleans,
`Promotion.loyaltyCompatible`/`storeCreditCompatible` (both
`@default(true)`, preserving every existing promotion's free-
combination behavior), enforced server-side in
`CheckoutService.startCheckout` immediately after pricing resolves the
applied promotions and before any inventory reservation begins — an
incompatible combination is rejected by name, never silently dropped,
the same precedent `PROMO-002`'s own promotion↔promotion conflict
handling already established. 7 new adversarial tests
(`test/integration/promotions.test.ts` tests #18–#24: compatible/
incompatible × automatic-promotion/coupon × loyalty/store-credit, plus
one real checkout combining a coupon, a compatible automatic
promotion, real loyalty redemption, AND real store credit together
with deterministic server-authoritative totals), and FLOW 18
(`test/e2e-storefront/promotions.spec.ts`) now genuinely proves loyalty
redemption stacking with a promotion for the first time — the original
FLOW 18 never actually exercised loyalty at all, a real gap this repair
closed by adding a genuine separate COD purchase that earns real
points before the main scenario. **Blocker 3 (M25, scheduling was not
actually implemented):** the original build persisted
`MarketingCampaign.scheduledAt` at creation but left every campaign in
`DRAFT` regardless, and the only send path was the manual staff
`POST .../send` route, which claimed any `DRAFT`/`SCHEDULED` campaign
immediately regardless of `scheduledAt` — there was no genuine
due-campaign execution mechanism at all, so `acceptance/
m25-marketing.md`'s "campaign scheduling works" checkbox had been
checked on a capability that did not exist, a real documentation-
honesty gap this repair corrects rather than leaves standing. Repaired:
`createCampaign` now sets `status: 'SCHEDULED'` (not `DRAFT`) whenever
a `scheduledAt` is supplied; a new `MarketingService.processDueCampaigns()`
(`POST /marketing/sweep/send-due`, staff-gated, the same shape as the
existing `POST /loyalty/sweep/expire`) is a plain callable sweep
function — never a general job platform — that claims and sends ONLY
campaigns where `status = SCHEDULED AND scheduledAt <= now`, literally
that condition and nothing broader; a `DRAFT` campaign or a not-yet-due
`SCHEDULED` campaign is never touched by it. The pre-existing manual
send route is unchanged and remains a separate, explicit immediate-send
operation that does not redefine what the automatic sweep itself picks
up. 7 new controlled-time/concurrency tests
(`test/integration/marketing.test.ts` tests #16–#22): a future campaign
is never sent early; the inclusive `scheduledAt <= now` boundary is
proven, not just the obviously-past-due case; a `DRAFT` campaign is
never touched by the sweep; a cancelled scheduled campaign is never
sent by it; two genuinely concurrent due-sweep invocations racing the
SAME due campaign converge to exactly one sender
(`Promise.all`, real Postgres row-level CAS); and a customer opted-in
at schedule time who opts out before the due time is correctly
suppressed — proving preference is checked at SEND time, never
snapshotted at schedule time, the one thing the original build already
had right. **Blocker 4 (M25, per-recipient dispatch crash-then-
duplicate-send gap):** the original per-recipient flow checked no
`CampaignDelivery` row existed, called the provider, THEN created the
delivery row — leaving a genuine distributed-systems hole where a
process crash between a provider's acceptance of a message and the
row's insert would let a later reclaim call the provider again for the
same recipient, a real duplicate-dispatch risk the campaign-level
`SENDING` compare-and-swap alone does not close. Repaired with a
durable per-recipient claim taken BEFORE the external provider call:
`dispatchToRecipient` now `create()`s a `PENDING` `CampaignDelivery` row
first — its own `@@unique([campaignId, customerId])` constraint is what
makes the claim atomic under real concurrency (a concurrent worker's
own `create()` for the same recipient fails with a unique-constraint
violation and safely no-ops) — only then calls the provider, then
records the real outcome. A stale `PENDING` claim (the crash scenario),
or a provider call that itself throws/times out, is recorded as a new
honest terminal state, `AMBIGUOUS_RECONCILIATION_REQUIRED` — never
silently retried, since this codebase's provider abstraction does not
guarantee the idempotent-retry contract a blind resend would need, and
never conflated with a provider's own genuine, definite `FAILED`
rejection (proven distinguishable via a new `AlwaysFailsMarketingProvider`
test double, since the existing `MockMarketingProvider` can never
itself reach `FAILED` for a valid-looking address). This build does
NOT claim universal exactly-once delivery — it claims the honest,
correct, weaker thing: no INTENTIONAL duplicate dispatch, and every
genuinely unknown outcome is labeled as such rather than guessed. 5 new
adversarial tests (`test/integration/marketing.test.ts` tests #23–#27):
two workers racing to durably claim the same recipient converge to
exactly one winner; a fresh non-stale `PENDING` claim is never
redispatched; a stale `PENDING` claim is reclaimed as ambiguous WITHOUT
a second provider call (proven by the `providerMessageId` staying
null); a provider's definite rejection is recorded `FAILED`; and a
provider call that throws is recorded ambiguous and never auto-
resolved or redispatched by a later send. See `LOY-006` and the Blocker
2/3/4 repair notes under `PROMO-002`/`MKT-001` in
`blueprint/DECISION_REGISTER.md` for the complete per-blocker design
records, and `acceptance/m23-loyalty.md`/`m24-promotions.md`/
`m25-marketing.md` for the corrected Definitions of Done. Full
clean-state validation: migration-from-zero (32 migrations, zero
schema drift), lint/typecheck/build clean across every touched
workspace, the full pre-existing integration suite re-run with zero
regressions, and the full Playwright storefront E2E suite (including
the updated FLOW 18) green. **This agent does not self-declare any of
these four repairs certified** — the same discipline as every
milestone since Phase 1. **M23 remains at `DECISION_REQUIRED`
(`LOY-006`) pending an explicit Product Owner decision; M24 and M25's
own repairs are complete and awaiting independent re-review.** M26 and
every later milestone remain unauthorized regardless of how this
re-review or the pending Product Owner decision resolves.

**On 2026-09-26 the independent reviewer recorded the repaired
Post-Purchase Phase build — commit
`13876a5f98cf3fb7a671ad2ca86d3e62edcd1a24` on
`claude/loving-fermat-cyucke` — as `POST_PURCHASE_PHASE_ENGINEERING_CERTIFIED`**,
covering M19 (Returns), M20 (Refunds & Store Credit), M21 (Exchanges),
the EXC-004 Option-2 fulfilment-integration repair, and the EXC-004
concurrency (write-skew) repair — engineering-implementation scope
only, not production-readiness (the same open pre-production gates
listed throughout this file — `TAX-001`–`005`, `CUST-001`, `AUD-002`,
`CART-004`, `SEC-001`, production performance verification — remain
open, none resolved by this certification). This commit is the
**protected starting baseline** for all work below; it must not be
regressed. The full history of the Post-Purchase Phase build, its
five-finding independent-review repair, the EXC-004 Option 2 fulfilment
decision/repair, and the EXC-004 concurrency repair is preserved
unchanged in the historical narrative later in this section — this
certification recording does not rewrite any of it.

The human project owner then gave explicit **"START BUILD — M22
CUSTOMER 360"** authorization on 2026-09-26, scoped specifically and
only to milestone **M22** (Customer Profile / account self-service —
`specs/21-customer-profile.md`), building on the
`POST_PURCHASE_PHASE_ENGINEERING_CERTIFIED` baseline above, with an
explicit instruction not to continue automatically into M23+. The
authorization explicitly excludes building M23 (Loyalty) or M24
(Promotions/Coupons) functionality inside M22 — those sections of the
customer account must be represented honestly as
`DEPENDENCY_DEFERRED — M23/M24` (an honest "not yet enabled" state,
never fabricated balances or coupon lists) until their own milestones
are separately authorized and built. **M23 and every later milestone
remain unauthorized** regardless of how cleanly M22 lands.

**M22 (Customer 360) is now built.** It genuinely reuses certified
domains rather than duplicating them: order history/detail, shipment
tracking, and wishlist all link directly to the EXISTING M12/M15/M17
storefront routes and pages (`/orders`, `/orders/[id]`, `/wishlist`) —
zero new backend code for those three; store-credit balance/history
reuses the EXISTING M20 `GET /storefront/store-credit` route verbatim.
Net-new work: a `CustomerAddress` model (the IND-003 address shape)
with exactly one default per customer enforced by a partial unique
index — never just an application-level check — proven under genuine
concurrency for both a simultaneous set-default race and a concurrent
delete-of-default-vs-set-default race (both converge to exactly one
default via a shared `FOR UPDATE` lock on the customer's whole address
set, the same row-lock-as-serialization-point idiom this codebase has
used since `StoreCreditService.lockOrCreateAccount`); a bounded,
deduplicated `RecentlyViewedProduct` log (configurable
`RECENTLY_VIEWED_MAX_ITEMS`, explicitly **product-behavior storage
bounding, not the still-`UNDER_REVIEW` `CUST-001` legal retention
policy**); `CustomerSavedSize` ("My Sizes") scoped by top-level
`Category` — the only genuine FK-based scoping signal available, since
neither `Category` nor `Size` carries a gender/department field;
a `CommunicationPreference` matrix granular per channel (SMS/WhatsApp/
Email/Push) × per message type (CUST-002), with `ORDER_UPDATES` as the
one transactional message type in the vocabulary, defaulting to
opted-in (see the 2026-09-26 certification-repair paragraph below for
why it is NOT rejected from opt-out); a new `listMyReviews` read surface over the EXISTING
M11 `Review` model (no duplicate storage); and `AuditLog.actorCustomerId`,
closing a genuine pre-existing gap this build's own investigation
found (`actorType: CUSTOMER` had no column recording WHICH customer
acted). **Loyalty (M23) and Promotions/Coupons (M24) are explicitly
`DEPENDENCY_DEFERRED — M23/M24`** in both the API and the account UI —
a disabled, honest "Coming soon" navigation item, never a fabricated
balance or coupon list, exactly as this authorization required. Every
new customer-facing route is `requireCustomerAuth`-only (never a guest
fallback, never a customerId read from anywhere but the verified JWT),
with cross-customer IDOR proven negatively for every new resource type.
26 new adversarial integration tests
(`test/integration/customer-profile.test.ts`, including 6 genuine
`Promise.all` concurrency tests — never `await A; await B;`; see the
2026-09-26 certification-repair paragraph below for the further tests
added during repair) plus 4 new
browser E2E tests (`test/e2e-storefront/account.spec.ts`) driving a
REAL mobile-OTP sign-in through the browser: since this codebase's OTP
verification only ever stores a plain SHA-256 hash of the 6-digit code
(no plaintext backdoor exists or was invented here), the E2E test
brute-forces the genuine hash space (10^6 SHA-256 hashes, well under a
second) to recover the actual code the server generated, then drives
the SAME production verification path a real customer uses — never a
token-injection shortcut. This proves profile edit + reload
persistence, full address CRUD + default handling, a real-PDP-visit
recently-viewed dedupe/bound check, My Sizes, a real review submission
via the existing M11 flow, the real M20 store-credit ledger, the
communication-preference matrix persisting exactly as set, order-
history/wishlist nav reuse, a genuine mobile-viewport render check, and
cross-customer IDOR. This build's own clean-state validation caught and
fixed two genuine bugs, not worked around: the storefront's CORS plugin
never allowed the `PUT` method (`services/commerce-api/src/plugins/cors.ts`)
— the first storefront routes to need it (My Sizes, communication
preferences) — which surfaced as an opaque browser "Failed to fetch"
with no HTTP-level error; and the E2E OTP-sign-in helper read the
`OtpCode` row before the async `POST /otp/request` had actually
committed, a genuine race that only surfaced under full-suite parallel
load, fixed by waiting for the UI's own OTP-entry step first. Full
clean-state suite (migration-from-zero — 26 migrations, zero schema
drift — lint, typecheck, build, unit, full integration suite against
real Postgres/Redis — 477/490 passing, the only 13 failures being the
pre-existing, environment-only Meilisearch-unavailable-in-sandbox
limitation, unrelated to this build — full Playwright E2E including
mobile) green, zero regressions to the entire M00–M21 baseline. See
`acceptance/m22-customer-360.md` for the complete Definition of Done.

**Independent-review certification-repair (2026-09-26, commit
`a27dfed` reviewed):** an independent review of the above build
returned four findings, none disputing the milestone's overall shape,
all requiring repair before certification. **Finding 1** (PII in audit
payloads): `CustomerProfileService` recorded raw PII — the customer's
actual email; an address's actual city/pincode/recipient — in
`AuditLog.oldValue`/`newValue`. Repaired: every M22 audit event now
records only non-sensitive change metadata (`changedFields`,
`isDefault`/`wasDefault` flags, category/size IDs), never a PII value,
while `actorCustomerId`/`entityId`/`action` still give full
traceability — proven by new tests that assert the raw PII strings
never appear in a persisted `AuditLog` row. **Finding 2** (recently-
viewed had no time retention): only the `RECENTLY_VIEWED_MAX_ITEMS`
count bound existed, though the original M22 instruction required BOTH
count and time bounding. Repaired: a new, separately-configurable
`RECENTLY_VIEWED_RETENTION_DAYS` (default 90) bounds the log by time
too — expired rows are pruned on write and filtered on read, still
explicitly product-behavior storage bounding, not a `CUST-001`/
`AUD-002` retention determination. **Finding 3** (`ORDER_UPDATES`
non-opt-outable rule was invented): the original build rejected
`optedIn=false` for `ORDER_UPDATES` with an HTTP 400, self-declaring it
as settled policy the approved spec never actually authorized —
`CUST-002` requires per-channel × per-message-type granularity, not a
non-opt-outable message type. Repaired: the 400 rejection is removed;
`ORDER_UPDATES` remains in the vocabulary and still defaults to
opted-in, but the customer can now set any value for it, same as every
other message type — downstream notification-delivery enforcement for
legally-required transactional messages remains a separate, undecided
policy question. **Finding 4** (zero-address concurrency race): the
address-book's row-set lock had no row to lock for a brand-new
customer with zero addresses — reproduced for real with a genuine
`Promise.all` race (two concurrent first-address creates both observed
`existingCount === 0`, both attempted `isDefault = true`, one hit the
partial unique index and surfaced as a raw 500). Repaired by locking
the customer's own row (always exists) as the single shared
serialization point across create/update/set-default/delete, replacing
the address-row-set lock entirely — this repair's own adversarial
testing then found and fixed a second, related bug this same change
exposed: `atomicSetDefault`'s single-statement form could itself
transiently self-conflict against the partial unique index, since
PostgreSQL does not guarantee row-processing order within one
multi-row UPDATE; fixed by splitting it into an order-independent
"clear old, then set new" pair of statements, both still covered by
the one customer-row lock. Combined repair: 12 new adversarial tests
(3 zero/first-address concurrency races, 2 PII-absence tests, 1
retention-window test, plus the corrected `ORDER_UPDATES` test) —
`test/integration/customer-profile.test.ts` now 38 tests total, plus
an updated `test/e2e-storefront/account.spec.ts`. Full clean-state
suite green (lint, typecheck, build, unit, full integration suite —
483/496 passing, the only 13 failures the same pre-existing
Meilisearch-unavailable-in-sandbox limitation — migration-from-zero,
zero schema drift, full Playwright E2E including mobile), zero
regressions to the entire M00–M21 baseline. See
`acceptance/m22-customer-360.md`'s "Independent-review
certification-repair" section for the complete record.

**This agent does not self-declare M22 (or this repair) certified** —
per the same discipline applied at every milestone since Phase 1, that
determination belongs to the independent reviewer. This agent has
stopped and is awaiting independent re-review before any M23+ work.

M19
(Returns), M20 (Refunds & Store Credit), and M21 (Exchanges) were all
implemented and adversarially tested sequentially, with per-milestone
validation and commit, exactly as authorized (commits `9e7b7f2`,
`e716fd3`, `ba46b39` on `claude/loving-fermat-cyucke`). M19 built a
self-contained `Return`/`ReturnLine`/`ReturnPickup` state machine,
genuinely reusing M17's own reverse-pickup pattern for the logistics
leg and enforcing INV-006's QC-gated disposition rule; this build's own
clean-state validation caught and fixed a genuine pre-existing bug in
`InventoryService.reconcileBalance` (the SALE replay case never
decremented `reserved`, only `onHand`, undetected until M19's own
receipt→QC→disposition lifecycle first exercised a reconciliation
check after a genuine SALE). M20 settles the durable refund handoffs
M18 (`Order.refundRequired`) and M19 (`ReturnLine.refundEligible`)
deliberately left unexecuted — one `Refund` row per `OrderLine` (never
per-order, so partial refunds are correct by construction), PREPAID via
the M14 `RazorpayPaymentProvider.refund()` method (fully implemented in
M14 but never called until this build wired it up), COD via a new
`StoreCreditAccount`/`StoreCreditEntry` ledger kept structurally
separate from loyalty (which does not exist in this codebase); this
build's own adversarial concurrency tests caught and fixed two genuine
races — concurrent refund-processing on the same order line each
independently attempting credit-note issuance before either committed,
and two different order lines refunded concurrently for the same
guest/customer racing on first-ever `StoreCreditAccount` creation (the
first fix attempt tried to catch-and-recover mid-transaction, which is
invalid in Postgres since a failed statement aborts the whole
transaction; properly fixed by retrying the whole transaction once on
that specific race). M21 built a first-class `Exchange` entity —
genuinely reusing M19's own eligibility/reverse-logistics/QC machinery
(a shared `resolveReturnPolicy` extracted into
`modules/returns/policy.ts`) rather than duplicating it, with
settlement direction derived once, at request time, from the
replacement's price difference alone; a `CUSTOMER_PAYS` settlement
collects the difference through a NEW, fully separate dispatch branch
in `PaymentService.handleRazorpayWebhook` that never touches M14's own
independently-reviewed `applyOutcome`/`applyCaptureOutcome` capture-
atomicity guarantees for real checkout payments. This build's own
testing caught a genuine cross-domain gap — nothing previously stopped
an order line from having both an active Return and an active Exchange
simultaneously — fixed with a mutual-exclusion check added to both
`ReturnService` and `ExchangeService` (a cancelled record on either
side does not permanently block the other, since it represents nothing
having actually happened). Two scope boundaries were documented rather
than guessed or silently skipped: M19's mobile photo/evidence capture
for return condition was not built (no photo-upload flow exists
anywhere in this codebase), and M21's physical forward fulfilment
(pick/pack/ship/tracking) of an allocated replacement item is
explicitly out of this pass — `Exchange.replacementAllocatedAt` marks
inventory commitment only, the actual warehouse shipment of that unit
is a manual/follow-on process not tracked by this build. Combined: 70
new adversarial integration tests (31 for M19, 20 for M20, 19 for M21)
plus 3 new browser E2E tests, with zero regressions to the entire
M00–M18 baseline confirmed across every regression run performed
throughout this phase. See `RET-005`, `REF-005`, and `EXC-004` in
`blueprint/DECISION_REGISTER.md` for the complete design record of each
milestone, and `acceptance/m19-returns.md`, `m20-refunds-store-credit.md`,
`m21-exchanges.md` for each milestone's Definition of Done.
**This agent does not self-declare M19/M20/M21 certified** — per the
same discipline applied at every milestone since Phase 1, that
determination belongs to the independent reviewer. This agent has
stopped and is awaiting independent review before any M22+ work.

**An independent review of that Post-Purchase Phase build (starting from
review head `73de2cf17c0e73a205efbddf8250f6f288602913`) returned five
findings — none BLOCKER-labeled outright, but all requiring repair —
fixed 2026-09-26 under a separate, explicitly scoped repair
authorization.** **Finding 1** (M21): the 14-day `EXCHANGE_REPLACEMENT_HOLD_DAYS`
default had been recorded as an engineering default, which the original
build instruction explicitly prohibited — corrected to record it as
what it actually is, an explicit Product Owner decision made during
this repair review; the expiry-to-`REPLACEMENT_UNAVAILABLE` behavior
itself was already correct and unchanged. **Finding 2** (M19): mobile
condition-photo/evidence upload, left honestly unbuilt at the original
build, is now implemented — config-driven (`ReturnPolicy.evidenceRequired`,
never universally mandatory), a new minimal private-object-storage
abstraction (no usable S3/MinIO client existed anywhere in this
codebase before this repair, and none is reachable in CI/this sandbox
to test against, so the shipped, tested provider is local-disk, behind
an interface a real S3 provider can later implement unchanged),
magic-byte MIME sniffing that never trusts the client-declared
Content-Type (closing "reject executable payloads" against the vector
that actually matters), and full ownership/RBAC/IDOR coverage — proven
with a genuine mobile-viewport Playwright test using `setInputFiles`
against a real `capture="environment"` input. **Finding 3** (M21, the
substantive one): independent review correctly rejected the original
build's `status = COMPLETED` the moment a replacement was allocated —
reaching a firm inventory allocation is not the same thing as the
replacement reaching the customer. Repaired with a new intermediate
`REPLACEMENT_ALLOCATED` status and a new, separately-permissioned
(`exchange:fulfil`) explicit staff confirmation
(`markReplacementFulfilled`) as the ONLY path to `COMPLETED`. Whether/
how to integrate the replacement's actual physical fulfilment with
M16/M17's certified `PickTask`/`OrderFulfilment`/`Shipment` pipeline —
which is hard-anchored to a real, invoiced `OrderLine`, something an
Exchange deliberately never creates a second one of — is NOT resolved
by this repair: it is recorded as an open **`DECISION_REQUIRED —
EXCHANGE REPLACEMENT FULFILMENT MODEL`** with three concrete
architecture options in `EXC-004` (`blueprint/DECISION_REGISTER.md`),
for the Product Owner to decide in a future, separately-authorized
pass. **Finding 4** (M20): a deeper refund-concurrency recheck found
that `RefundService.settle()` had no in-flight claim before calling the
external Razorpay/store-credit operation at all — two genuinely
concurrent `settle()` calls both proceeded straight to the external
call, relying entirely on THAT system's own idempotency rather than any
protection this system provided. Fixed with a genuine database-level
`PROCESSING` compare-and-swap claimed before any external call (the
exact idiom a prior schema comment had argued against, for reasons that
turned out to be backwards) plus age-based stale-claim recovery
mirroring `PaymentService.expireStalePayments`; the repair explicitly
documents, rather than papers over, the residual and genuinely
time-bounded limit of Razorpay's own idempotency-key contract, which no
application code can strengthen further. **Finding 5** (M19/M21): the
Return/Exchange cross-domain mutual-exclusion check added at the
original build was only an application-level check-then-insert, not a
real concurrency guard — two genuinely concurrent transactions could
each read "no conflict" before either committed, since `return_lines`/
`exchanges` carry independent unique constraints that don't block each
other. Fixed by row-locking the shared `OrderLine` (`SELECT ... FOR
UPDATE`) as the first statement of both `ReturnService.performInitiate`
and `ExchangeService.performInitiate`, proven with a genuinely
concurrent (`Promise.all`-fired) adversarial test, not a sequential
simulation. Combined repair: 3 new integration tests (M21 real-
concurrency + fulfilment-state-distinction), 12 new integration tests
(M19 evidence upload), 4 new integration tests (M20 concurrency
recheck), and 2 new/updated browser E2E tests — 68 integration tests
across the three files (43 M19, 23 M20, 22 M21) and the full storefront
E2E suite, zero regressions to the entire M00–M18 baseline, confirmed
across repeated runs (concurrency-sensitive suites run twice) and a
full migration-from-zero clean-state proof. See `RET-005`, `REF-005`,
and `EXC-004`'s own 2026-09-26 repair addenda in
`blueprint/DECISION_REGISTER.md` for the complete per-finding design
record. **This agent does not self-declare this repair certified** —
the same discipline as every milestone since Phase 1. This agent has
stopped and is awaiting independent re-review; `EXC-004`'s
`DECISION_REQUIRED` is explicitly flagged for the Product Owner's
attention, not silently left for a future agent to rediscover. M22+
remains unauthorized regardless of how this re-review resolves.

**On 2026-09-26 the Product Owner resolved `EXC-004`'s
`DECISION_REQUIRED` with an explicit architecture decision: "SELECT
OPTION 2."** Exchange replacement physical fulfilment now genuinely
reuses M16/M17's certified `PickTask`/`OrderFulfilment`/`Shipment`
pipeline, generalized to a polymorphic fulfilment source, rather than
creating a second `Order`, fabricating a replacement `OrderLine`, or
building a parallel exchange-only pipeline — implemented the same day
under a separate, explicitly scoped repair authorization bounded to
this one decision. `PickTask.orderLineId` is now nullable alongside a
new nullable `exchangeId` (`@unique`), with a same-row XOR CHECK
constraint (`pick_tasks_source_xor_check`) — a genuine per-row
guarantee. `OrderFulfilment` gained a nullable `exchangeId` (`@unique`)
whose exclusivity against its child `order_lines` is a real CROSS-TABLE
invariant no CHECK constraint can express — enforced instead by a
trigger pair (`check_fulfilment_line_exclusivity` on `order_lines`,
`check_exchange_fulfilment_exclusivity` on `order_fulfilments`), the
"equally strong relational design" the Product Owner's own instruction
explicitly permitted as the alternative to a raw CHECK, and the correct
SQL tool for this exact cross-table case — a deliberate, documented
deviation from this codebase's usual pure-CHECK-constraint convention,
not a shortcut.

**2026-09-26 concurrency correction (final independent review,
migration `20260926130000`):** the trigger pair as originally written
read the OTHER side's row via a plain SELECT, no lock — under READ
COMMITTED that is not itself a serialization point, so two genuinely
concurrent transactions (one setting a fulfilment's `exchangeId`, the
other attaching an `order_lines` row to that SAME fulfilment) could
each read the other's pre-commit state and both pass, a real
write-skew race that could violate the very invariant this trigger
pair exists to enforce — a genuine gap, not a theoretical one. Fixed
by giving both directions a SHARED serialization point: the SAME
`order_fulfilments` row's own lock. An UPDATE/INSERT targeting
`order_fulfilments` already holds that row's lock for the rest of its
own transaction before its BEFORE ROW trigger ever fires, so
`check_exchange_fulfilment_exclusivity` needed no change;
`check_fulfilment_line_exclusivity` now explicitly
`SELECT ... FOR UPDATE`s the target fulfilment row before reading its
`exchangeId`, acquiring that identical lock. Proven with a genuine
two-connection concurrent-transaction test
(`test/integration/exchange-fulfilment-xor-race.test.ts`) that first
reproduced the write-skew against the unfixed trigger (both sides
committed, invariant violated), then proved the fixed trigger converges
to exactly one winner every time, run repeatedly and in both
interleavings. `Shipment` needed zero schema change at all (1:1 with
`OrderFulfilment`, so its source is entirely derived). Inventory-ledger
semantics for the replacement's physical dispatch were defined
explicitly rather than reused from `SALE`: a new
`InventoryTxnType.EXCHANGE_DISPATCH`, posted by a new
`InventoryService.recordExchangeDispatch` (same combined onHand/reserved
decrement as `recordSale`, its own partial-unique-index exactly-once
guard) — deliberately never conflated with a genuine retail `SALE`,
since the replacement's price difference was already settled by
Exchange itself, not a second transaction. Any GST/invoice consequence
of this physical dispatch is explicitly flagged **TAX/COMPLIANCE
REVIEW REQUIRED** — not decided or guessed here.
`WarehouseService.createPickTaskForExchange`, called from
`ExchangeService.tryComplete`'s own reservation-conversion transaction,
auto-creates the replacement's `PickTask` the instant an exchange
reaches `REPLACEMENT_ALLOCATED` — the exact moment-of-parity with a
normal order's own ALLOCATED → PickTask creation; a pick shortfall/
exception on it routes to the already-existing
`ExchangeStatus.REPLACEMENT_UNAVAILABLE` rather than inventing a new
status, since both represent the identical fact. `OrderService`
gained `assignExchangeToFulfilment` (a new `POST /exchanges/:id/fulfilment`
route, gated by the EXISTING `exchange:fulfil` permission — no new
permission needed) and branches in `markFulfilmentShipped` (posts
`EXCHANGE_DISPATCH` instead of iterating child lines) and
`markFulfilmentDelivered` (flips `Exchange.status` to `COMPLETED`
automatically); pack/ready-to-ship/ship/deliver, and pick itself, all
reuse the EXISTING `/orders/fulfilments/:fulfilmentId/*` and
`/warehouse/pick-tasks/:id/pick` routes completely unchanged — no
parallel routes, no new base permissions. `ShippingService` needed
ZERO code changes: every method already operated generically on
`fulfilmentId`, and its one RTO branch already reconciles-for-a-human
exactly the rejection an exchange-anchored shipment's RTO produces, via
the SAME pre-existing multi-shipment fallback. `Exchange.status` now
reaches `COMPLETED` **automatically** the instant the replacement's own
shipment reaches DELIVERED — the normal happy path;
`markReplacementFulfilled` remains, demoted exactly as instructed to an
exception/recovery mechanism only, never the route a correctly-flowing
exchange takes. Every existing M16/M17 certified invariant (exactly-once
SALE, no overselling, row-lock concurrency, idempotent pick/pack/
shipment transitions, provider isolation, webhook dedup, split-shipment
behaviour, inventory-ledger authority, auditability, RBAC, IDOR/BOLA
protection) was preserved and re-proven unchanged — the entire
pre-existing `warehouse.test.ts`/`shipping.test.ts`/`exchanges.test.ts`
suites re-run green, byte-for-byte unmodified, zero regressions — plus
a new 16-point adversarial integration matrix
(`test/integration/exchange-fulfilment.test.ts`) proving the
generalized pipeline itself: normal OrderLine fulfilment unchanged; the
full pick→pack→ship→deliver→COMPLETED happy path (both via manual staff
routes and via real carrier tracking/webhook-driven delivery);
replacement cannot ship before allocation; no duplicate warehouse work;
concurrent pick/pack/shipment-creation; a duplicate `delivered` webhook
as a safe no-op; exactly-once `EXCHANGE_DISPATCH` with the original
order's own `SALE` row untouched; a pick exception correctly routing to
`REPLACEMENT_UNAVAILABLE`; a `QC_FAILED`/`CANCELLED` exchange never
getting a `PickTask` at all; RBAC/IDOR-BOLA (a role without
`exchange:fulfil`, or without the base `warehouse:pick`/`order:fulfil`
permissions, correctly rejected); idempotency-key replay; and two
unrelated exchanges on two different orders progressing independently
under real concurrency. Full clean-state validation: migration from
zero (two new migrations, `20260926120000_exchange_fulfilment_generalization`
and `20260926120100_exchange_dispatch_unique_index` — split across two
files deliberately, since Postgres forbids using a newly-added enum
value in the same transaction that added it), zero schema drift, clean
seed, lint, typecheck, build, unit tests, the complete integration
suite against real Postgres/Redis, and the full Playwright E2E suite
(including mobile) — all green, zero regressions to the entire
M00–M21 baseline. See `EXC-004`'s "OPTION 2 SELECTED BY PRODUCT OWNER"
addendum in `blueprint/DECISION_REGISTER.md` for the complete design
record. **This agent does not self-declare this repair certified** —
the same discipline as every milestone since Phase 1. This agent has
stopped and is awaiting independent review. M22+ remains unauthorized
regardless of how this review resolves.

**A final independent review of that Option 2 build (review head
`56f7fbe722d63b744b82068cfc7a79b6112384bf`) returned one blocker: the
`OrderFulfilment` source-exclusivity trigger pair enforced its
invariant with a PLAIN SELECT of the other side's row, no lock — under
READ COMMITTED that is not itself a serialization point, so two
genuinely concurrent transactions (one setting a fulfilment's
`exchangeId`, the other attaching an `order_lines` row to that SAME
fulfilment) could each read the other's pre-commit state and both
pass, a genuine write-skew race that could leave the committed
database in an illegal state where a fulfilment carried BOTH a
populated `exchangeId` AND a child `order_lines` row.** Fixed
2026-09-26 (migration `20260926130000_exchange_fulfilment_xor_concurrency_fix`)
by giving both directions a SHARED serialization point: the SAME
`order_fulfilments` row's own lock. An UPDATE/INSERT targeting
`order_fulfilments` already holds that row's lock for the rest of its
own transaction before its BEFORE ROW trigger ever fires, so
`check_exchange_fulfilment_exclusivity` needed no change;
`check_fulfilment_line_exclusivity` (which fires on `order_lines`, a
different table with no lock of its own on the fulfilment row) now
explicitly `SELECT ... FOR UPDATE`s the target fulfilment row before
reading its `exchangeId`, acquiring that identical lock — whichever
transaction reaches Postgres first in either direction now forces the
other to block, then correctly observe the winner's committed change
and cleanly reject, rather than both racing to a blind pre-commit
snapshot. Proven with a genuine two-connection concurrent-transaction
test (`test/integration/exchange-fulfilment-xor-race.test.ts`) that
was first run against the UNFIXED trigger to confirm it actually
reproduces the write-skew (both sides committed, invariant violated),
then against the fixed trigger to confirm it converges to exactly one
winner every time — run repeatedly, in both interleavings, with zero
flakiness. No other part of the Option 2 design changed: the Product
Owner's architecture decision stands, `EXCHANGE_DISPATCH` semantics are
unchanged, the normal `OrderLine` `SALE` invariant is unchanged, and
`TAX/COMPLIANCE REVIEW REQUIRED` remains open for exchange-dispatch
tax-document consequences — see `EXC-004`'s own concurrency-correction
addendum in `blueprint/DECISION_REGISTER.md` for the complete record.
**This agent does not self-declare this repair certified.** This agent
has stopped and is awaiting final independent review. M22+ remains
unauthorized regardless of how this review resolves.

M17 (Shipping /
Tracking) was implemented and adversarially tested (carrier-adapter
substitution, shipment-creation idempotency/concurrency/crash-retry,
webhook dedup/resume, illegal-transition rejection, redelivery-
exhaustion → automatic RTO, the exactly-one-SALE invariant, polling-
fallback graceful degradation, split-shipment independent tracking,
IDOR), CI-green at commit
`495dcfcede60e922ec251a17fd3dcbd2ea362047`. An independent review of
that build found **one BLOCKER**: `POST /webhooks/shipping/:provider`
declared a per-provider URL but never actually used `:provider` —
every webhook was authenticated/parsed by whichever provider
`SHIPPING_PROVIDER` happened to be globally configured, regardless of
the URL, breaking provider isolation once more than one provider
identity (or an in-flight shipment from an earlier provider) existed.
Fixed at commit `413f2dc`: `ShippingService.handleCarrierWebhook` now
resolves the SPECIFIC provider named in the URL for signature
verification, event parsing, shipment lookup, and event dedup/
recording — never a silent fallback to the globally configured
default; an unknown/unconfigured provider name fails safely (400). A
second registered test identity, `MOCK_SECONDARY`, was added
specifically to prove genuine per-request provider dispatch/isolation
(6 adversarial tests, `test/integration/shipping.test.ts` "Webhook
provider dispatch (independent-review repair)") — deliberately not a
real carrier. CI then caught a second, genuine (not flaky) concurrency
bug in the pre-existing `createShipment` idempotency path — two
concurrent requests with different idempotency keys could race such
that a late-arriving request read a stale fulfilment snapshot and
falsely rejected instead of converging to the already-created
shipment; fixed at commit `6e28e2b` by checking for an existing
Shipment row before the status validation. Full clean-state suite
green (lint, typecheck, build, unit, integration — zero regressions:
326 passing backend tests across 27 files — migration-from-zero,
seed), confirmed on GitHub Actions run
[36109033095](https://github.com/suraj2build/ECOMMERCE/actions/runs/36109033095).
**On 2026-09-25 the human project owner recorded this repaired
state — commit `6e28e2bd3116c49641016f7a7ed5dd61427a5819` — as
`M17_ENGINEERING_CERTIFIED`** (engineering-implementation scope; not
production-readiness — `TAX-001`–`005`, `CUST-001`, `AUD-002`,
`CART-004`, `SEC-001`, production performance verification, and
qualified privacy/DPDP and tax/GST review all remain open
pre-production gates, none resolved by this certification) and gave
explicit **"START BUILD — M18 CANCELLATION"** authorization, scoped
specifically and only to milestone **M18**, building on the
`M17_ENGINEERING_CERTIFIED` baseline, again with an explicit
instruction not to continue automatically into M19+. M18 was
implemented and adversarially tested (partial/full/all-lines
cancellation, the shipment eligibility boundary, durable idempotency
including two-different-keys-racing-the-same-line convergence,
concurrency against pick/pack/ready-to-ship/shipment-creation/ship,
inventory-ledger exactness, warehouse-work invalidation, prepaid/COD
financial branching, split-fulfilment isolation, customer/guest IDOR,
staff RBAC/audit, and immutable-price credit-note integration),
CI-equivalent clean-state suite green with zero regressions to the
entire M00–M17 baseline. This build's own clean-state validation
caught and fixed a genuine cancel-vs-pick deadlock (an inverted lock
order against `WarehouseService.recordPickOutcome`) — investigated to
its true root cause rather than dismissed as a flake, per this file's
own binding discipline. Two honest scope boundaries were documented
rather than guessed, both in `CAN-004` (`blueprint/DECISION_REGISTER.md`)
and `acceptance/m18-cancellation.md`: partial cancellation is
implemented as cancelling a subset of lines (no sub-quantity
cancellation within one multi-unit line — the schema has no
infrastructure for it), and the loyalty-points-reversal acceptance
criterion is N/A (no loyalty ledger exists anywhere in this codebase;
M23 remains unauthorized and unbuilt). The captured-payment (PREPAID)
credit-note integration reuses the existing M08 `InvoiceService`
engine and is engineering-integration scope only — `TAX-005` remains
`UNDER_REVIEW` and is not resolved or claimed compliant by this build.
**On 2026-09-25 the human project owner recorded this state —
commit `4a616b3cefa8e4e1879dd8c62b293682ea6bc206` — as
`M18_ENGINEERING_CERTIFIED`** (engineering-implementation scope; not
production-readiness — the same open pre-production gates listed above
remain open, none resolved by this certification) and gave explicit
**"START BUILD — POST-PURCHASE PHASE"** authorization, a single bounded
pass covering **M19 (Returns), M20 (Refunds & Store Credit), and M21
(Exchanges) only**, to be worked sequentially with per-milestone
validation, without stopping for approval between those three
milestones — **M22 and everything after M21 remains unauthorized**.
See `acceptance/m18-cancellation.md` for M18's Definition of Done and
`CAN-004` in `blueprint/DECISION_REGISTER.md` for its state-machine/
lock-ordering/data-model design record; both are preserved unchanged by
this certification recording, including the cancel-vs-pick deadlock
history, the sub-quantity-cancellation scope boundary, the loyalty N/A
boundary, and the `TAX-005` limitation.

The full history of M17's original build, its independent-review
blocker, and the two repairs is preserved above and in
`blueprint/DECISION_REGISTER.md`'s `SHIP-005` entry and is not
rewritten by this M17_ENGINEERING_CERTIFIED recording — see that
history for the complete narrative.

Phase 1 (M00–M07) completed an
expanded engineering certification pass and was accepted by the human
project owner as **`PHASE_1_CERTIFIED`** at commit
`240debca8179df0b05db07216cfce64d0b10d0ae`. On 2026-09-23 the human
project owner gave explicit **"START BUILD — PHASE 2"** authorization,
scoped specifically to milestones **M08 through M15** (Tax & Invoicing
Foundation through Order Management), again with an explicit
instruction to **stop after M15 certification** for independent
review rather than self-authorizing M16+. On 2026-09-23 all of
M08–M15 were implemented and confirmed CI-green; an independent
reviewer then examined that build and returned nine numbered findings
(three BLOCKER, two BLOCKER/HIGH, one HIGH, three lower-severity),
fixed on 2026-09-24 under a separate certification-repair
authorization. A further independent re-review of that repaired state
returned two more findings (Blocker 1: same-request credit-note
over-credit; Blocker 2: payment-event dedup could suppress recovery
of a genuinely-failed webhook event), fixed the same day under a
second, explicitly scoped final certification-repair-pass
authorization — see `acceptance/m08-tax-invoicing-foundation.md` and
`acceptance/m14-payment.md` for those two fixes' detail, and the
per-finding commits on `claude/loving-fermat-cyucke` for the full
nine-finding history. **On 2026-09-24 the human project owner
recorded that repaired state — commit
`e1143994cd103e5fdabae9a779fbda56428a2164` — as `PHASE_2_CERTIFIED`**
(engineering-implementation scope for M08–M15; this is **not** the
same as production-readiness — `TAX-001`–`005`, GST/HSN statutory
verification, production performance verification, `CART-004`,
data-retention/privacy decisions, and the full pre-production
security/privacy program tracked at `SEC-001` all remain open
pre-production gates, listed in full in
`blueprint/DECISION_REGISTER.md`). The human project owner then gave
explicit **"START BUILD — M16"** authorization, scoped specifically
and only to milestone **M16** (Warehouse & Fulfilment), again with an
explicit instruction not to continue automatically into M17+. M16 is
now implemented, adversarially tested (concurrency, idempotency,
IDOR/BOLA, transactional rollback — see
`test/integration/warehouse.test.ts` and
`acceptance/m16-warehouse-fulfilment.md`), and the full clean-state
suite (lint, typecheck, build, unit, integration — the complete
pre-existing M00–M15 suite included, zero regressions — migration-
from-zero, seed, Playwright E2E) is green. **This agent does not
self-declare M16 certified** — per the M16 build instruction's own
stop condition, that determination belongs to the independent
reviewer. This agent has stopped and is awaiting independent human
review before any M17+ work.

**M00–M07 remain the certified, protected baseline; M08–M15 are now
`PHASE_2_CERTIFIED` (engineering-implementation scope).** All later
work MUST NOT regress either: the STYLE→COLOUR→SIZE→SKU hierarchy,
the inventory ledger, reservation atomicity/oversell prevention, GRN
atomicity, pricing invariants, RBAC, audit history, idempotency,
database constraints, clean-clone reproducibility, CI, and every
M08–M15 financial-integrity/concurrency invariant (credit-note
over-credit prevention, payment-event durability, capture/expiry
reconciliation, order-invoice recovery). Every Phase 1 and Phase 2
test remains mandatory and must stay green — M16's own build kept all
of them green throughout.

**This authorization does NOT extend beyond M29.**
Decision/spec/milestone readiness (`blueprint/READINESS.md` Layers
1–3) remains a separate thing from implementation authorization
(Layer 4):

- **M30 and every later milestone remain unauthorized.** No
  application code for M30+ (Gift Cards, Security Hardening,
  Performance/Scale, Final Production Certification) should be added
  until the human project owner gives a new, separate, explicit
  **START BUILD** authorization for that phase — neither the Phase 2
  authorization, nor the M16/M17/M18 authorizations, nor the
  Post-Purchase Phase (M19–M21) authorization, nor the M22
  authorization, nor the M23/M24/M25 Overnight Commercial-Engagement
  Phase authorization, nor the M26–M29 Digital Growth + Operations
  Phase authorization carries forward automatically, regardless of how
  cleanly M08–M29 land.
- Do **not** interpret "M29 shipped cleanly" as authorization for the
  next milestone. Authorization must be explicit and human-given for
  each milestone/phase.
- **M26 (Social/Channel Publishing), M27 (SEO), M28 (Analytics/
  Reporting), and M29 (Admin+CMS) were explicitly authorized on
  2026-09-28** as a single bounded "Digital Growth + Operations Phase"
  pass, scoped only to those four milestones, worked sequentially
  (M26 → M27 → M28 → M29) building on the `5bf2fb8` (M23 vesting
  repair) baseline, without stopping between milestones. **M30 and
  everything after M29 remains unauthorized.** See §0 above and the
  per-milestone acceptance docs (`acceptance/m26-social-channel-publishing.md`,
  `m27-seo.md`, `m28-analytics-reporting.md`, `m29-admin-cms.md`) for
  each milestone's Definition of Done and `CHAN-001`/`SEO-001`/
  `ANL-001`/`ADM-001`–`003`/`NOTIF-001` in `blueprint/DECISION_REGISTER.md`
  for the design records. An independent review of this phase returned
  two certification-repair blockers, both scoped to M26 only (channel
  availability truth, ambiguous-provider-outcome handling), fixed the
  same day under a repair authorization that explicitly did NOT extend
  to M30+ or to redesigning M27/M28/M29 — see §0's own M26 repair
  narrative for the complete record. M27–M29 are unchanged by that
  repair and remain awaiting the same independent review as M26.
- **M23 (Loyalty), M24 (Promotions), and M25 (Marketing) were
  explicitly authorized on 2026-09-26** as a single bounded
  "Overnight Commercial-Engagement Phase" pass, scoped only to those
  three milestones, worked sequentially (M23 → M24 → M25) with
  per-milestone validation and commit, building on the
  `M22_ENGINEERING_CERTIFIED` baseline at commit
  `137429a485899a188b97d6549c14d47f55090152`, without stopping for
  approval between those three milestones. **M26 and everything after
  M25 remains unauthorized.** See §0 above and the per-milestone
  acceptance docs (`acceptance/m23-loyalty.md`,
  `acceptance/m24-promotions.md`, `acceptance/m25-marketing.md`) for
  each milestone's Definition of Done. An independent review of this
  phase returned four certification-repair blockers; a follow-on
  **"M23 LOYALTY — PRODUCT OWNER DECISION + FINAL CERTIFICATION
  REPAIR"** authorization on 2026-09-27, scoped specifically to
  resolving `LOY-006` and its resulting vesting-lifecycle repair,
  explicitly did NOT authorize M26+, modifying M24/M25 behavior beyond
  what a regression test required, or any other scope expansion — see
  §0's "M23 LOYALTY VESTING REPAIR" narrative for the complete record.
- **M22 (Customer 360) was explicitly authorized on 2026-09-26**,
  scoped only to that milestone, building on the
  `POST_PURCHASE_PHASE_ENGINEERING_CERTIFIED` baseline at commit
  `13876a5f98cf3fb7a671ad2ca86d3e62edcd1a24`, with an explicit
  instruction that M23 (Loyalty) and M24 (Promotions/Coupons)
  functionality must NOT be built inside M22 — those account sections
  must be represented honestly as `DEPENDENCY_DEFERRED — M23/M24`
  rather than fabricated. See §0 above and
  `acceptance/m22-customer-360.md` for the Definition of Done.
- The Post-Purchase Phase (M19 Returns, M20 Refunds & Store Credit,
  M21 Exchanges) was explicitly authorized on 2026-09-25 as a single
  bounded pass, scoped only to those three milestones, building on the
  `M18_ENGINEERING_CERTIFIED` baseline at commit
  `4a616b3cefa8e4e1879dd8c62b293682ea6bc206`, worked sequentially with
  per-milestone validation and no self-authorized continuation into
  M22+. All three milestones were implemented, adversarially tested,
  and committed as authorized (see §0 above). An independent review of
  that build returned five findings (none BLOCKER, all requiring
  repair); repaired 2026-09-26 under a separate, explicitly scoped
  repair authorization — see §0's repair narrative above. This repair
  authorization likewise does NOT extend to M22+, and its own one
  remaining open item (`EXC-004`'s `DECISION_REQUIRED — EXCHANGE
  REPLACEMENT FULFILMENT MODEL`) requires a separate, explicit Product
  Owner decision before any future pass may resolve it — an engineering
  agent must not guess an answer to it. See
  `acceptance/m19-returns.md`, `acceptance/m20-refunds-store-credit.md`,
  `acceptance/m21-exchanges.md` for the Definitions of Done, and
  `RET-005`/`REF-005`/`EXC-004` in `blueprint/DECISION_REGISTER.md` for
  the full design records, now including each one's 2026-09-26 repair
  addendum.
- M16 (Warehouse & Fulfilment) was explicitly authorized on
  2026-09-24, scoped only to that milestone, building on the
  `PHASE_2_CERTIFIED` baseline at commit
  `e1143994cd103e5fdabae9a779fbda56428a2164`. It was independently
  reviewed and certified `M16_ENGINEERING_CERTIFIED` at commit
  `97c575c9052148c5a48df82feffde8cf496cf97e` (see §0 above). See
  `WH-003` in `blueprint/DECISION_REGISTER.md` for the full state-
  machine/data-model design record and
  `acceptance/m16-warehouse-fulfilment.md` for the Definition of Done.
- M17 (Shipping / Tracking) was explicitly authorized on 2026-09-24,
  scoped only to that milestone, building on the
  `M16_ENGINEERING_CERTIFIED` baseline above. It was independently
  reviewed (one BLOCKER, fixed), CI caught a further genuine
  concurrency bug (fixed), and was then certified
  `M17_ENGINEERING_CERTIFIED` at commit
  `6e28e2bd3116c49641016f7a7ed5dd61427a5819` (see §0 above). See
  `SHIP-005` in `blueprint/DECISION_REGISTER.md` for the state-
  machine/data-model design record and
  `acceptance/m17-shipping-tracking.md` for the Definition of Done.
- M18 (Cancellation) was explicitly authorized on 2026-09-25, scoped
  only to that milestone, building on the `M17_ENGINEERING_CERTIFIED`
  baseline above. It was implemented, adversarially tested (including a
  genuine cancel-vs-pick deadlock caught and fixed by this build's own
  clean-state validation), full clean-state suite green with zero
  regressions to the entire M00–M17 baseline — see §0 above. See
  `CAN-004` in `blueprint/DECISION_REGISTER.md` for the state-machine/
  lock-ordering/data-model design record and
  `acceptance/m18-cancellation.md` for the Definition of Done.
- M08 is explicitly authorized to proceed now as a **configurable
  compliance architecture** — GST registrations, HSN/rate reference
  data, and e-invoice applicability are all engineering-configurable,
  never hard-coded, and the system must fail safely when that
  configuration is absent. This is *not* the same as resolving the
  underlying compliance/legal questions (`TAX-001`–`005` in
  `blueprint/DECISION_REGISTER.md`) — those still require a qualified
  professional's verification before real GSTIN/rate/HSN values are
  entered as production configuration, and must never be guessed by
  an engineering agent. Data-retention policy
  (`specs/21-customer-profile.md`, `specs/30-audit-compliance.md`)
  remains `UNDER_REVIEW` for the same reason.
- M09 must begin with the mandatory Medusa v2 integration spike
  required by `docs/decisions/0017-medusa-custom-domain-ownership-boundary.md`
  before other M09 work proceeds. If the spike shows the ownership
  model is not technically workable, stop and raise
  `DECISION_REQUIRED` rather than quietly changing ownership.
  **Historical note (2026-09-24, Phase 2 independent-certification
  repair, finding #4):** the spike was carried out and found the split
  workable, but M09-M15 were then actually built entirely on the
  custom platform - Medusa was never bootstrapped, and
  Cart/Checkout/Payment/Order are custom `services/commerce-api`
  domains like every other row in the ownership table.
  `docs/decisions/0019-custom-platform-sole-commerce-system-of-record.md`
  supersedes ADR-0003/0016/0017 and is now the live ownership decision;
  treat it, not ADR-0017, as authoritative for any future work touching
  this question.

If you are unsure whether implementation is authorized for a given
milestone, **stop and ask** rather than proceeding.

## 1. Your role

You are the **Principal Engineering Agent** for this project (see
`AGENTS.md` for the full multi-agent model). Concretely:

- You implement **approved** specifications from `/specs`.
- You never silently convert a `DRAFT` or unresolved business question
  into an implemented rule. If something is unresolved, mark it
  `DECISION_REQUIRED` in the relevant spec and stop — do not guess.
- You keep GitHub as the **permanent source of truth**. Anything
  architecturally important that was only discussed in chat must be
  written into a doc/spec/ADR before it's considered real.
- You follow the milestone sequence in `BUILD_PLAN.md`. Do not skip
  ahead to a later milestone because it seems easy or related.

## 2. Reading order for a fresh session

1. `README.md`
2. `PRODUCT.md`
3. `ARCHITECTURE.md`
4. `docs/decisions/` (ADRs) — especially any with status `APPROVED`
5. `blueprint/DECISION_REGISTER.md` — authoritative business-decision
   status (105 DECIDED / 7 UNDER_REVIEW / 0 OPEN as of 2026-09-22)
6. `blueprint/READINESS.md` — current per-milestone readiness and the
   decision-readiness-vs-implementation-authorization hierarchy
7. `BUILD_PLAN.md` — milestone sequence and current status
8. The specific `specs/NN-*.md` file relevant to the task at hand
9. `TESTING.md` and `acceptance/README.md` (plus the relevant
   `acceptance/mNN-*.md`) — Definition of Done
10. `SECURITY.md` — safety boundaries on what you may do autonomously

## 3. Document status system

Every spec in `/specs` carries a status:

`DRAFT` -> `UNDER_REVIEW` -> `APPROVED` -> `IMPLEMENTING` -> `IMPLEMENTED` -> `VERIFIED`

Rules:

- You may only **implement** a spec whose status is `APPROVED` or
  later, and only within a milestone that `BUILD_PLAN.md` says is
  unblocked and active.
- When you begin implementing an approved spec, update its status to
  `IMPLEMENTING`. When implementation is complete and passes the
  Definition of Done, update it to `IMPLEMENTED`. `VERIFIED` is set
  after independent/human verification — do not set this yourself.
- You may freely edit `DRAFT` specs to improve clarity, but you may
  not mark your own draft `APPROVED` — that requires human/product
  owner sign-off (see `AGENTS.md`).

## 4. Handling unresolved business decisions

If an important business rule is not yet specified:

1. Do **not** invent it, even if the answer "seems obvious."
2. Add a clearly marked block to the relevant spec:

   ```
   ## DECISION_REQUIRED

   Question: <the specific unresolved question>
   Why it matters: <what breaks or gets built wrong if guessed>
   Options considered (if any): <...>
   ```

3. Stop work on the parts of the task that depend on that decision.
   Continue only on parts that don't depend on it, if any.

## 5. The future autonomous development loop

Once implementation is authorized, the intended loop per milestone is:

```
READ APPROVED SPEC
  -> REVIEW ACCEPTANCE CRITERIA
  -> PLAN
  -> IMPLEMENT
  -> RUN
  -> TEST
  -> DIAGNOSE FAILURES
  -> FIX
  -> RETEST
  -> REVIEW
  -> COMMIT
  -> UPDATE BUILD STATUS
  -> NEXT APPROVED MILESTONE
```

This loop is **documented but not active**. Do not start executing it
until the human project owner explicitly authorizes implementation
start with **START BUILD** — Product Blueprint V2 itself is already
complete (see §0); that alone is not the authorization.

## 6. Safety boundaries

See `SECURITY.md` for the full policy. Summary: editing source,
branching, writing/running tests, non-production migrations, local
dev databases, builds, and local/sandbox E2E are within an
authorized engineering agent's normal autonomy. Production deployment,
destructive production migrations, deleting production data, changing
production credentials/secrets, and other irreversible production
operations always require explicit human approval, regardless of how
confident the agent is.

## 7. Definition of Done

Do not report a milestone complete because code exists. See
`acceptance/README.md` for the full Definition of Done checklist that
must be satisfied first.

## 8. Repository conventions

- Secrets are never committed. Use environment-variable templates
  (e.g. `.env.example`) once those exist — never real credentials.
- Keep specs, ADRs, and build status **up to date as you work** —
  these are not write-once documents.
- Prefer small, reviewable commits with clear messages over large
  unreviewable ones, once implementation begins.
