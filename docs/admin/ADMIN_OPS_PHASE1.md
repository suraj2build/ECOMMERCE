# Desktop-First Admin Operations — Phase 1

Status: **IMPLEMENTED - AWAITING PRODUCT OWNER AND IMPLEMENTATION REVIEW** (authorized by the Product Owner, Suraj, 2026-10-04:
"START BUILD — DESKTOP-FIRST ADMIN OPERATIONS, PHASE 1").

## The instruction, in brief

Make the admin practical for one owner running the business end to end.
Desktop is the primary workspace; on a phone the owner should be able to
track progress and take selected actions. "Ease" means connected workflows,
configuration the owner can understand, fewer repeated entries, clear
validation and reliable recovery.

Authorized Phase 1 scope:

1. **Guided product onboarding**: Basics → Variants → Photos → Pricing →
   Readiness → Preview → Publish. It supports resumable drafts and editing
   existing products, and uses category-appropriate attributes (apparel,
   shoes, belts, perfume) for the approved assortment.
2. **Product media management**: upload from the computer; thumbnails, cover
   image, colour assignment and ordering; safe replacement and removal;
   server-side validation. Public product media stays separate from private
   return evidence.
3. **Bulk product import**: Template → Upload → Column mapping → Validation →
   Change preview → Import → Results/error download. Identifiers are stable,
   blank cells are never treated as "clear this field", work runs in
   bounded batches, retries are safe and inventory is never touched.
4. **Visual storefront configuration**: a navigation menu editor with
   pickers, validation, ordering, preview and save feedback, clearly
   showing which placements the storefront actually reads. Banner and
   page media selection and preview improve; draft and published content
   are clearly separated; raw HTML is never rendered.
5. **Setup and health view**: every operational area shows configured /
   incomplete / test failed / unavailable, what is missing, the operational
   impact and the next action. It separates business settings (edited in
   admin) from deployment settings (set on the server). Channel publishing
   scope can be set in admin.
6. **Desktop UX**: workflow navigation, breadcrumbs, next actions,
   searchable and paginated lists, plain-language states, entered data kept
   after recoverable errors, no UUIDs, JSON or engine internals in owner
   flows. Server permissions stay authoritative.

Research only (no implementation in Phase 1): buying/receiving, dispatch,
promotions/campaigns and after-sales/money gap mapping; the dispatch
sale-posting finding; solo-owner approval options. See
[`NEXT_PHASES_RESEARCH.md`](NEXT_PHASES_RESEARCH.md).

Boundaries: no invented discount rates, shipping promises, tax rules,
carrier choices, approval exceptions or budgets. No paid advertising,
customer messaging or production deployment. The approved storefront
appearance and ongoing image work are preserved. Shipping/inventory
semantics (the sale-posting point) do not change in Phase 1, and
production mock-provider guards stay intact.

## Baseline

- The instruction named `7f5e90cf` (launch assortment) as the last
  reviewed HEAD. The working branch `claude/loving-fermat-cyucke` had
  moved on to `1195f48` (local demo port fix and an isolated local e2e
  runner, both by the Product Owner), which contains `7f5e90cf`.
- Phase 1 is built on its own branch, `claude/admin-ops-phase1`, cut from
  `1195f48`. This keeps it separate from the catalogue, image and storefront
  work continuing on `claude/loving-fermat-cyucke`. It is not merged to
  `main` until the implementation review is complete.

## What existed before Phase 1 (inspected, not assumed)

| Area | Existing | Gap closed in Phase 1 |
|---|---|---|
| Product master | Create style, add colour, generate SKU matrix, add media by URL, lifecycle transitions (`DRAFT → READY_FOR_ENRICHMENT → READY_FOR_QA → PUBLISHED`), QA completeness gate | No way to edit a style, colour or SKU after creation; media could not be removed, reordered or uploaded; SKU codes embedded part of an internal size ID |
| Category attributes | `Style` columns (fabric, fit, …) plus `customAttributes` JSON; categories had no product type | Category product type (apparel/footwear/belt/fragrance) drives which attributes and sizes the owner is offered |
| Media storage | Private return-evidence storage (local disk or S3) | A separate public product-media store using the same S3 client, served through the storefront origin |
| Bulk import | `POST /products/styles/bulk`: styles only, up to 1,000 per request, create-only | Full catalogue import (style, colour, SKU, price, image URL) with dry run, change preview, batches and retries |
| Navigation menus | `PUT /cms/navigation-menus/:key` with free-form items, edited as JSON | Visual editor; server-side link validation; consumed placements labelled |
| Landing pages / banners | Create, publish and unpublish pages; banners are live on creation | Page editing; banners can be saved as drafts; image picking with preview |
| Channels | Created by API with `config.publishAll`; no update route; `isActive` not enforced by the automatic sweep | Owner sets the publishing scope and pauses a channel in admin; a paused channel is skipped |
| Setup visibility | None | Setup & health page |

## Changed workflows

### 1. Product workspace (Merchandise → Products → a product)

One page per product with a step bar: **Basics → Colours & sizes → Photos →
Pricing → Readiness → Preview → Publish**. It opens at the first step that
still needs work (`?step=` links straight to a step); every step saves on
its own, so the owner can stop and come back.

- **New product** keeps what was typed in the browser until it is saved
  ("Restored what you typed last time", with "Start again"). Required
  fields are checked inline before anything is sent; server errors are
  shown in plain words and the form keeps its values.
- **Category decides the questions.** Each category has a product type
  (Apparel, Footwear, Belt, Fragrance; set per category, seeded for the
  launch categories). Apparel asks for fabric, fit and measurements;
  footwear for material, closure and shoe sizes; belts for material,
  buckle and lengths; perfume for fragrance name, concentration, notes
  and volume. Suggested sizes follow the type; "Show all sizes" and "Add
  to size list" cover the rest. The approved Men/Women assortment is shown
  as a reminder on the Basics step, not enforced.
- **Editing an existing product**: name, description, attributes, HSN,
  department, season; colours (rename, hex, delete when unused); SKUs
  (barcode with duplicate check, on/off); size chart. Archived products
  are read-only.
- **Readiness** separates *published*, *purchasable* (published + an
  active price + an active SKU), *in stock* (units available to sell,
  sizes in stock) and *channel status*. Each missing requirement links
  to the step or screen that fixes it; stock links to Receiving and
  Inventory, which own stock - the workspace never changes stock.
- **Publish** walks the existing lifecycle (being prepared → checked →
  published) through the existing routes and server QA gate; unpublish
  and archive show what will happen first.
- **Products list**: photo thumbnails, search, category / department /
  status filters, full pagination.

### 2. Photos

Upload from the computer (drag and drop or "Choose photos to upload",
several at once, with progress). JPEG, PNG and WebP up to 10 MiB; the
server checks the file's actual bytes, not the name or declared type.
Each photo can be made the **listing photo** (one per product, enforced
by a database index), assigned to a colour, given alt text, moved
earlier/later, **replaced** (the new file is stored before the record
changes, so a failed upload leaves the old photo in place) or
**removed** with confirmation. The last photo of a published product
cannot be removed. Every change refreshes search and the storefront
cache. Photos are public and stored apart from private return evidence
(DEPLOYMENT.md, "Product photos and content images").

### 3. Import products (Products → Import from a spreadsheet)

Template download → upload CSV → map columns (auto-matched by header) →
**Check file** (a dry run that saves nothing) → change preview (to create
/ to update / unchanged / problems, per row) → **Import** → results with
a downloadable problems file.

- One row per size. Matching is by **style code**, then **colour code**
  (or colour name), then **size**; the SKU is found by style + colour +
  size. Re-importing the same file changes nothing.
- A **blank cell means "leave as it is"**, never "clear it".
- A style with any problem row is skipped whole, so a product is never
  half-imported; other styles go ahead.
- Rows are sent in batches of at most 500, grouped by style, under one
  import run. Each batch's result is recorded; re-running a batch
  replaces its result. There is no row ceiling for the file as a whole.
- **Each product is saved in one database transaction** (style, colours,
  sizes, prices, image links and their audit entries together), so a
  failure or crash part-way leaves that product exactly as it was, while
  the other products in the batch are kept. *(Added in the review
  follow-up; before it, a product's parts were saved by separate calls.)*
- **Simultaneous imports of one product run one after the other**: the
  transaction takes a lock on the style code, then re-checks the product
  against what is now saved, so the second import sees the first's work
  (its rows come back "unchanged") instead of failing on, or duplicating,
  a colour, SKU or price. Different products import in parallel.
- **Prices are appended, never edited or deleted.** A row whose price
  equals the price the product (or that colour) sells at now adds nothing;
  a different price adds a new row that takes effect immediately, and the
  old one stays in the history. A colour is compared with its own price,
  else the all-colour price. While a markdown is running, the base price
  still changes and the row notes that shoppers see the markdown until it
  ends.
- **An interrupted batch is safe to send again.** If the connection drops
  after the products were saved but before the result was recorded, the
  retry finds them saved ("unchanged"), records the result, and re-indexes
  every existing product in the batch so search catches up too.
- New products are created as drafts. Import never publishes, never
  touches stock and never reserves anything; a stock column is refused
  with an explanation. There is no "undo": fixing a mistake means
  importing a corrected file (stated on the screen).
- The old `POST /products/styles/bulk` is unchanged.

### 4. Storefront content

- **Navigation menus**: choose a menu by name; add, edit, remove and
  reorder links; each link points to a content page, category,
  collection, a site path or an https address (checked on the screen and
  by the server). The screen says which menus the storefront shows
  (`footer-about`, `footer-social`) and that `main-nav` does **not**
  change the header, which is fixed in the approved design. Preview and
  save confirmation included.
- **Banners**: grouped by the storefront placement that shows them, with
  what each placement uses (first live banner or all, title, link).
  Banners can be saved as drafts; "Make live" / "Switch off"; reorder;
  image upload or library pick with preview.
- **Content pages**: edit title, description, top image and sections;
  publish/unpublish with confirmation; pages stay plain text (no HTML is
  rendered).

### 5. Setup & health (Setup & health, `org:manage`)

One card per area: business details, warehouse / pickup location,
product reference data, stock, photo storage, payments, courier,
customer messages, shipping/returns policies, storefront content and
publishing channels. Each shows **Configured / Incomplete / Test failed /
Unavailable**, what is missing, the impact and the next action, and
whether it is changed in admin or on the server. No secret value is ever
returned. Payments, courier and messages are never shown as connected
just because settings exist (no live connection test exists for them).
"Run storage test" really writes, reads and deletes a probe file.

**Channels**: each channel's scope ("Every product that can be bought" /
"Only products I send by hand") and Pause/Resume are set in admin. A
paused channel is skipped by every automatic sync and refuses manual
publishing.

## Tests

| Kind | File | Covers |
|---|---|---|
| Integration (22) | `services/commerce-api/test/integration/admin-ops-products.test.ts` | Style/colour/SKU editing rules, blank-vs-null, archived refusal, barcode duplicates, sizes and product types, readiness states, upload validation (decoded images, corrupt/truncated files, dimension and pixel limits, spoofed type, size, ownership), republish after unpublish (AO-D1), shoe/belt/perfume attributes on the product page (AO-D2), cover uniqueness, replace keeps the old file on failure, removal rules, public serving only while referenced, search refresh, permissions |
| Integration (16) | `.../admin-ops-import.test.ts` | Dry run writes nothing, create/update/unchanged, blank cells, duplicate rows, bad references and barcodes, style skipped whole, batches and retry, no inventory changes, out-of-range batch refused, permissions; whole-product rollback on a mid-product failure, simultaneous imports of the same product, interrupted batch then retry, price history appended only on a real change |
| Integration (12) | `.../admin-ops-config.test.ts` | Menu link validation, placements, draft banners, page edits, content images, channel scope and pause, setup statuses without secrets, storage test, permissions; business details, GST registrations and warehouse addresses from admin (AO-D3) |
| Integration (21) | `.../approvals.test.ts` | One approval policy (AO-D4) across purchase orders, adjustments, receiving and picking: self-approval refused while the policy is off, owner approval with reason and confirmation, wrong password and lock-out (including a simultaneous burst), non-owner refused, approver without the permission refused, approval log; approval requests: queued not applied, only the named approver decides, simultaneous approvals apply once, reject/withdraw, re-validation at approval, database rules |
| Integration (13) | `.../dispatch.test.ts` | Pick and pack scans, parcel measurements sent with the booking, required-check settings, documents, handover by staff and by carrier event, sale still posted at booking, permissions; dispatch stage and filters, simultaneous handover, list total, shipped message only after commit |
| Unit (4) | `test/unit/image-validation.test.ts`, `logger-redaction.test.ts` | Rotated-photo dimensions, decode concurrency limit, password and code redaction in logs |
| Browser (8) | `test/e2e-admin/admin-ops-phase1.spec.ts` | AO-01 shoe and perfume profiles; AO-02 draft restore, inline errors, edit reaching the storefront; AO-03 upload/cover/reorder/replace/remove with a bad file refused and the cover in storefront search; AO-04 import dry run, problem rows, import, retry with a corrected file, no stock; AO-05 menu editor reaching the storefront footer; AO-06 draft banner made live; AO-07 setup page, storage test, channel scope and pause; AO-08 readiness and preview |
| Browser (1) | `test/e2e-admin/approvals.spec.ts` | AO-09 owner approval turned on, used on an own purchase order, listed in the log |
| Browser (new) | `test/e2e-admin/p1-console.spec.ts` AO-11 | Approval queue: request, nothing moves, the approver approves from their own login, stock moves, requester sees the outcome |
| Browser (new) | `test/e2e-admin/p1-console.spec.ts` AO-10 | Pick scan (wrong item refused), pack scans with parcel measurements, packing slip and label, booking, courier handover |
| Browser (updated) | `test/e2e-admin/p1-console.spec.ts` P1-01 | Product creation now goes through the workspace and checks the storefront product page, price and photo |

The menu test and `test/e2e-storefront/cms-pages.spec.ts` both rewrite the
footer menus; they take a shared database lock
(`test/e2e-storefront/footer-menu-lock.ts`) so they never interleave,
while everything else still runs in parallel.

Desktop walkthrough screenshots (1440 px, from the browser tests):
`docs/admin/screenshots/phase1/`.

### Defects the browser tests found (fixed before push)

- The admin could not display uploaded photos: every API response carried
  `Cross-Origin-Resource-Policy: same-origin`, so the browser blocked the
  admin (another origin) from showing them. The two public image routes
  now send `cross-origin`; every other response keeps `same-origin`
  (asserted in the integration tests; AO-03 checks the photo really
  renders).
- "Photo replaced." was never shown (only errors were rendered).
- Renaming a product remounted the Basics form and dropped "Saved.".
- The channel scope choice ignored the click until the server answered.
- The admin project had been made to depend on the storefront project, so
  one storefront failure silently skipped every admin test. Replaced by a
  lock around the two tests that edit the footer menus.

### Verification (local, isolated database, search index and storage)

- Integration: the three Admin Ops suites plus the existing CMS, channel,
  product, catalogue and security-header suites pass.
- Browser: 80 passed, including all 30 admin tests (8 new). Read-load and
  checkout-contention load gates pass.
- *(Fixed in the review follow-up, 2026-10-05; see below.)* 4 storefront tests failed **at the base commit too** (base CI on `1195f48`
  is red; `main` is also red). None involve files this branch changes:
  - link audit (×3): `/category/kurtas` no longer exists after the launch
    taxonomy (`everyday-kurtis`), and the home page falls back to
    `/collections/party-evening`, `/workwear` and `/weekend`, which the test
    seed does not create (`7f5e90c`);
  - bag accessibility: the checkout stepper's upcoming-step text
    (`#B9AE9F` on `#FAF6FB`, 2.04:1) is below WCAG AA (`72cea3c`).
  A related intermittent failure: the product page's "Offers" note
  (`#A0978A`, 2.69:1, `72cea3c`) fails contrast whenever an automatic
  promotion is active, which happens while `promotions.spec` runs in
  parallel. These belong to the storefront/catalogue work and were left
  for it.
- *(Closed in the review follow-up, 2026-10-05.)* File checks used to
  look only at a file's first bytes, so a corrupt file that started like a
  JPEG was stored. Every upload is now decoded in full; see "Review
  follow-up" below.

## Not checked here

- A real S3 bucket for photos (none exists); local disk was used.
- Real payment, courier and SMS providers (none configured; LR-008 open).
- Barcode scanners, label printers and scales (no hardware).
- The demo's own photographs and fonts (blocked by this sandbox's network).

## Decisions (Product Owner, 2026-10-05)

All five open decisions were answered in the Product Owner's review of
this phase and are recorded in `blueprint/DECISION_REGISTER.md` → "AO —
Admin operations":

| # | Decision | Where |
|---|---|---|
| AO-D1 | Unpublished products may be republished through the readiness/QA checks; archived stays separate. | Workspace → Publish ("Republish") |
| AO-D2 | Shoe, belt and perfume attributes appear in the existing product-details section of the product page. | Storefront product page |
| AO-D3 | Business and warehouse setup gets admin screens. | Admin → Business & warehouse |
| AO-D4 | Explicit owner approval policy; one rule across PO, adjustments, receiving and picking. | `docs/admin/APPROVALS.md` |
| AO-D5 | Booking and handover recorded separately; the sale-posting point stays until its consequences are reviewed. | `docs/admin/DISPATCH.md` |

## Review follow-up (2026-10-05)

The Product Owner's review of `e88aab9` asked for three items to be
closed before acceptance, then the next dispatch steps.

1. **Green CI on the combined branch.** `main` (catalogue photography) was
   merged in, then the base-branch failures were fixed:
   - the home page now links only to collections that are actually
     published, so a store without the seeded collections has no 404
     links;
   - the link audit uses the launch category `everyday-kurtis`;
   - the checkout stepper's upcoming steps and the product page's offers
     note are darkened to `#756A5E` (WCAG AA, parity item C-3), and the
     offers note is now covered by an axe check while a promotion is
     active;
   - the two bulk catalogue specs that had been skipped were run. One
     (`search-deep-pages`) could never pass: it wrote its fixtures to the
     `styles` index while the test API reads `styles_test`. It now writes
     to the test index and refuses to run against `styles`.
2. **Image validation.** Every upload (product photos, content images,
   return evidence) is decoded in full; corrupt, truncated, animated and
   oversized files are refused before anything is stored. Details in
   DEPLOYMENT.md ("Product photos and content images").
3. **Import recovery and concurrency.** Each product is saved in one
   transaction under a per-product lock; simultaneous imports of a product
   serialise; an interrupted batch is safe to resend and re-indexes
   search; prices are append-only. See "3. Import products" above.

Also from the review: the pick co-approver gap is closed by the shared
approval policy (`docs/admin/APPROVALS.md`).

## Second review (2026-10-05, after `3e1149a`)

The Product Owner verified CI green on `3e1149a` (run 37264858214) and
named two incomplete controls, plus a code review before merging.

### Test record for `3e1149a` (correction)

An earlier report quoted "944 passed and 1 failed". That was an
intermediate run, not the final one. The final local run on `3e1149a`,
the commit that was pushed:

| Suite | Files | Passed | Failed | Skipped |
|---|---|---|---|---|
| Unit (`commerce-api`) | 15 | 86 | 0 | 0 |
| Unit (other workspaces) | 5 | 21 | 0 | 0 |
| Integration, with the S3 emulator | 64 | 950 | 0 | 0 |
| Browser (storefront, admin, API smoke) | — | 88 | 0 | 0 |

Read-load and checkout-contention load checks passed. CI's own totals
could not be read here: the log tool returns only the last 5,000 lines
and the full log download is blocked by this sandbox's network policy.

**Defect history.** The earlier full integration run on the dispatch work
had 944 passed, 1 failed and 5 skipped:
- the failure was `product-invariants` asserting an outdated readiness
  message; the assertion was corrected to the new message in `a2dd690`
  (the behaviour it checks was unchanged);
- the 5 skipped were the S3 storage tests, which skip when no S3
  emulator is running. The final run had the emulator up.

### 1. Independent approval needs the approver's own login

Fixed. Adjustments, receiving and picking now queue a request when
another person is named; nothing is applied until that person approves it
from their own login, and the action is re-checked at that moment. Owner
self-approval remains a separate, immediate path. See
`docs/admin/APPROVALS.md` → "Approval requests".

### 2. Dispatch status

The admin now shows **Booked — awaiting collection** and **Handed over**
as distinct stages, with filters (`docs/admin/DISPATCH.md` → "Dispatch
stage in the admin"). **AO-D5 remains partly implemented:** the package
still becomes `SHIPPED` and stock still leaves the ledger at booking. The
review of moving that to handover is
`docs/admin/BOOKING_TO_HANDOVER_REVIEW.md`. It recommends option B (sale,
shipped status and shipped message at handover, plus a rule for
cancelling a booked parcel) and needs the Product Owner's decision.

### 3. Code review before merging

Reviewed in the code: approval paths, dispatch, credential handling,
import transactions and image decoding.

Fixed:

| # | Area | Finding | Fix |
|---|---|---|---|
| A1 | Approvals | Naming another approver recorded attribution only | Approval requests (above) |
| C1 | Credentials | Simultaneous wrong passwords could all be checked before the limit counted them | Each person's confirmations are serialised with a database lock; a burst gets exactly 5 checks |
| C2 | Credentials | Logs redacted `password` only at the top level of a body | `password` and `mfaCode` redacted when nested too |
| D1 | Dispatch | "Shipped" and "delivered" messages were sent inside the transaction, before commit | Sent after commit |
| D2 | Dispatch | Two simultaneous handovers of one parcel could both audit it | Rows locked in a fixed order first |
| D3 | Dispatch | The handover list stopped at 500 without saying so | Total shown with the limit |
| I2 | Images | Many simultaneous large uploads could each decode at once (memory) | At most 2 decodes at a time; others wait |
| I3 | Images | A rotated phone photo (EXIF orientation 5–8) was measured unrotated | Width and height swapped for those orientations |

Import transactions: no defect found. Each product is written in one
transaction under a per-product lock, nothing outside the database
(search, storage) is called inside it, and search is refreshed after
commit.

Open, for a decision or a later pass:
- **C3:** an authenticator code can be reused within its 30-second window,
  at sign-in and for approval confirmation. This is existing sign-in
  behaviour; closing it means recording used codes.
- **I6:** public product photos keep their camera metadata (EXIF, which
  can include GPS location). Stripping it means re-encoding every upload,
  which changes the stored file. Recorded as `DECISION_REQUIRED`
  (`AO-D6` in `blueprint/DECISION_REGISTER.md`).

### Test record for this change

Final local run on the pushed head of this change:

| Suite | Files | Passed | Failed | Skipped |
|---|---|---|---|---|
| Unit (`commerce-api`) | 17 | 90 | 0 | 0 |
| Unit (other workspaces) | 5 | 21 | 0 | 0 |
| Integration, with the S3 emulator | 64 | 964 | 0 | 0 |
| Browser (storefront, admin, API smoke) | — | 89 | 0 | 0 |

Lint and typecheck are clean in every workspace; read-load and
checkout-contention load checks passed.

**Defect history.** The first browser run had 88 passed and 1 failed:
P1-06 selected the Pack & ship filter option "ready to ship", which this
change renamed to "Ready to ship" when it added the dispatch stages. The
test was updated to the new label (the step it checks is unchanged) and
the whole browser suite was rerun from a fresh database.

### Next, as asked

1. The AO-D5 decision on moving stock posting to handover.
2. A courier adapter for real labels, pickup and cancellation. **No
   courier has been chosen** (`LR-008` is `DECISION_REQUIRED`), so this
   cannot start until one is.
3. Promotion templates, basket simulation and campaign configuration.

## Solo-owner walkthrough (2026-10-05, after `57f0f53`)

The Product Owner asked for one desktop walkthrough before more features
are added. The five steps were:

1. Publish a product.
2. Receive stock with owner approval.
3. Pick, pack, measure and print an order.
4. Book the parcel, hand it over and track it.
5. Handle failures.

At each screen the question was whether the next action is obvious,
typed work is kept, and failures are explained. The full report, with
each finding and what was done, is
[`WALKTHROUGH_2026-10-05.md`](WALKTHROUGH_2026-10-05.md).

- **Fixed (the larger items).**
  - Picked orders had no visible next step. Pack & ship now has a
    "Picked, waiting for a package" list.
  - Pack & ship hid most work behind a Pending filter.
  - Purchase order, package and order-line actions were offered in
    states where they cannot apply.
  - Own-approval and refused dialogs lost what was typed or gave
    misleading errors.
  - Messages used internal status and field names.
  - Errors on long forms were shown off-screen.
  - Readiness said "can be bought" with no stock.
  - Documents gave no warning when the warehouse address was missing.
  - Waiting approvals were not visible on the Overview.
- **Reported, not built:**
  - a staff management screen (W-23; needs a go-ahead);
  - the delivery-area list (W-11; comes with the courier, LR-008).
- **Recommendations recorded, not approved:** AO-D5 option B and AO-D6
  metadata stripping, both still `DECISION_REQUIRED` in
  `blueprint/DECISION_REGISTER.md`. Neither has been built.
