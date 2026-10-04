# VANYA visual parity checklist

Authority: `suraj2build/Stitch-Spark_Ai_Studio` at `24b2399` (latest commit,
2026-10-02; the version the P2 replacement was approved against), plus the
approved separate VANYA brand row above desktop navigation ("Vanya Luxury
Fashion Header.png"). Admin design is not governed by AI Studio.

Method: both applications were run and captured with Chromium at 390×844 and
1440×900, at the same routes and departments: the original with Vite on
port 5173 and the storefront from `npm run demo`.

**Sandbox limit:** this environment's network policy blocks
`images.unsplash.com`, where every original photograph is hosted. In the
original-app captures, those photographs are replaced by a flat grey tile so
the layout stays visible. The photographs load on a normal network, such as
the reviewer's Mac.

Status key:

- **Fix**: an implementation difference that this pass corrects.
- **Data**: the original shows prototype data. The layout is ported and
  real data is shown, or the element is hidden when no real data exists.
- **Blocked**: the original element depends on data or business rules that
  do not exist. It is not faked; the reason is given.
- **Keep**: an intentional deviation that has already been approved.

## Imagery

| # | Difference | Status |
|---|---|---|
| I-1 | Demo products use generated illustrated garments ("DEMO IMAGE") instead of the original editorial photography. | **Fix (preview data).** The demo seed uses the original photographs for its products. Production catalogue media is unchanged and comes from the admin. |
| I-2 | Hero, gateway, category bubbles, occasion banners and tastemaker photos are hard-coded Unsplash URLs in the original. | **Fix.** These come from CMS banners by placement. The demo seed loads the original photographs; production adds its own in admin. With no banner, the section shows its text on the theme surface, never a substitute photo. |
| I-3 | Placeholder images repeat a "VANYA" label that overlaps gateway branding. | **Fix.** The generated placeholders are no longer used by the demo. |

## Gateway

| # | Difference | Status |
|---|---|---|
| G-1 | Original overlay header: "NEW DELHI · INDIA" left; VANYA plus "— INDIAN ROOTS · MODERN FORM —" centre; Search / Account / Bag (n) right. Current shows the wordmark only. | **Fix** |
| G-2 | Bottom ticker strip (New Season · Festive 2026 · Complimentary Shipping · Easy Returns) is missing. | **Fix** for the strip. **Blocked** for "Complimentary shipping", which is an unapproved promise: the item shows the confirmed free-delivery threshold, otherwise "Delivery checked by PIN code" (see C-1). |
| G-3 | Preview banner covers the top of the gateway. | **Fix.** The notice becomes a slim strip above the gateway and no longer covers it. |
| G-4 | Original at 390px: the overlay header text overlaps itself. | **Fix** (an original defect): stack cleanly at 390px. |

## Header and navigation

| # | Difference | Status |
|---|---|---|
| H-1 | Separate centred brand row above the navigation. | **Keep** (approved header reference). |
| H-2 | Utility tier: "← Atelier Portals (Choose Department)" with compass icon; centre announcement; Track Order and Rewards (n Pts). Current uses different wording and icons. | **Fix** for wording and icons. **Data** for the centre announcement: the original's delivery/tailoring promise is not adopted, and a real department line is shown. |
| H-3 | Nav items and order: MEN/WOMEN, FESTIVE, NEW IN, three department categories, then TROUSERS/SETS and WATCH & SHOP. Current adds COLLECTIONS and changes order and spacing. | **Fix** (Collections moves to the footer and mobile menu). |
| H-4 | Search pill "Search kurtas, bandhgalas…" and icon set (lucide User / Heart / ShoppingBag with dark count badges); the bag badge always shows a count. | **Fix** |
| H-5 | Department-coloured glow line under the header. | **Fix** |
| H-6 | Mobile drawer: VANYA + "Pour Homme · Men" header, uppercase links, "← Choose Department (Main Portal)" footer button. | **Fix** |
| H-7 | Original at 390px: the bag icon overflows off-screen. | **Fix** (an original defect): keep bag and search visible. |

## Home (each department, top to bottom)

| # | Original section | Current | Status |
|---|---|---|---|
| HM-1 | Full-bleed hero: THE FESTIVE EDIT / VANYA / MODERN INDIAN MENSWEAR, two pill CTAs, right watermark "TRADITION TAILORED FOR A MODERN MAN". | Similar, but the image is a placeholder and the CTA says "Explore collections". | **Fix** |
| HM-2 | Trust bar (4 perks, rounded white card). | Present, with different copy. | **Fix** for layout and icons. **Data** for copy: returns days and free-shipping threshold come from the real policies; secure payment methods come from what the checkout offers. |
| HM-3 | Category story bubbles (8 circles). | Missing. | **Fix**: real categories, with CMS images. |
| HM-4 | "Elevated Everyday — Tradition Tailored for Today" rounded feature banner. | Missing. | **Fix** |
| HM-5 | NEW ARRIVALS: 6-column grid of the original product card. | 4-column grid of a different card. | **Fix** |
| HM-6 | Instagram callout card plus 6 vertical reel cards. | Dark band with 3 reels. | **Fix** |
| HM-7 | Occasion trio banners (For Work / Celebration / Travel). | Missing. | **Fix** (CMS images; links to real categories). |
| HM-8 | AS SEEN ON TASTEMAKERS: 6 photos. | Missing. | **Fix** (CMS placement; hidden when it has no photos). |
| HM-9 | Brand pillars (4). | Missing. | **Fix** |
| HM-10 | — | "Collections & stories" block (not in the original). | **Fix**: removed from home; Collections stay reachable from the footer and menu. |

## Product card

| # | Difference | Status |
|---|---|---|
| PC-1 | Rounded white card with border and hover lift; 3:4 image; hover crossfade to the second image. | **Fix** (the search index gains the second image). |
| PC-2 | Badges: "% OFF" (primary colour) and BESTSELLER. | **Data**: % OFF comes from the real MRP and selling price. BESTSELLER and NEW come from the merchandise badges staff set in admin (the demo seed sets the design's own). "Out of stock" is kept. |
| PC-3 | Wishlist heart on the image. | **Fix**, wired to the real wishlist. |
| PC-4 | Hover "Instant Select Size / Quick Add" bar with per-size stock. | **Fix**: per-size availability is added to the search index; adding resolves the real SKU and adds it to the real bag. |
| PC-5 | Fabric line and rating; title; subtitle. | **Data**: fabric is real; the rating is shown only when real reviews exist (indexed rating). The subtitle uses real fit and occasion. |
| PC-6 | Price row "₹4,950 ~~₹6,990~~" with colour swatches. | **Fix**: en-IN formatting; real colour hex swatches (indexed). |

## Listing (category and search)

| # | Difference | Status |
|---|---|---|
| L-1 | Header: "ATELIER CATALOG • DEDICATED MEN'S ATELIER" eyebrow, "Men's Collection" title, description, "← Switch Department (Main Portal)" pill. | **Fix** |
| L-2 | Control bar: Hide/Show Filters, "Showing N styles", sort pill, 3/4 grid toggle. Current shows a stacked filter form of five rounded inputs before any product (one full mobile screen). | **Fix** |
| L-3 | Desktop left sidebar "Refine Selection": Category checkboxes, Colour Palette chips, In-Stock Only. | **Fix**, backed by the real search facets (server-side, keeps department and pagination). |
| L-4 | Fit-First Navigation (garment dimension filter) in the sidebar. | **Blocked**: the search API has no per-garment dimension data to filter on. |
| L-5 | Mobile: compact Filter (n) and Sort controls; products visible on the first screen; bottom-sheet "Filter & Refine" with Clear / Apply (n). | **Fix** (accessible dialog with focus trap and Escape). |
| L-6 | Active filter chips with "Clear All". | **Fix** |
| L-7 | "1 styles" / "1 items" plurals. | **Fix** |

## Product details

| # | Difference | Status |
|---|---|---|
| P-1 | Breadcrumb; left gallery (large image plus 2-column grid; mobile swipe with dots); right sticky purchase panel. | **Fix** |
| P-2 | Contextual lighting preview (Daylight / Golden Hour / Evening / Studio). | **Fix** (presentation only). It opens on Studio, the unaltered photograph, so colours are shown as photographed. |
| P-3 | Title with BESTSELLER tag, subtitle, rating summary, price + MRP + % OFF, "Inclusive of all Indian taxes". | **Fix**: real rating summary; tax note as in the current approved copy. |
| P-4 | Colour pills with names; size chips with low-stock and unavailable states; Size Guide; model note. | **Fix** (real stock per colour; the size guide and "My Size" read the product's own size chart; the model note only when media has `modelInfo`, which the demo seed sets from the design). Sold-out sizes are disabled and labelled "Sold out": the original's "Notify me" restock sign-up is **Blocked** (no restock-alert service). |
| P-5 | ADD TO BAG + heart; INSTANT BUY. | **Fix**: Instant Buy adds the item to the real bag and opens the bag, as in the design. |
| P-6 | "Shop Coordinated Ensemble (15% off)" and Shop the Complete Look hotspots. | **Blocked**: no styled-look data and no approved ensemble discount. |
| P-7 | Digital Product Passport. | **Blocked**: no provenance data. |
| P-8 | Delivery & COD availability PIN check. | **Fix** (real serviceability). |
| P-9 | Accordions: Product Details, Fit & Sizing Notes, Fabric & Artisan Care, Shipping & Returns, Artisan Origin. | **Data**: real fabric, fit, care, origin and policies; empty sections are hidden. |
| P-10 | Frequently Bought Together. | **Data**: the same bundle block, titled "Curated Ensemble · Wear It With" because the pairing is the merchandiser's cross-sell, not purchase data. Each piece is added in a size the shopper picks, at live prices. |
| P-11 | Ratings & Reviews: score, distribution bars, filter/sort, write a review. | **Fix**, using real reviews. |
| P-12 | You May Also Like (original cards); Recently Viewed. | **Fix**: You May Also Like is live styles from the same category and department; Recently Viewed is this browser's history, shown with live details. Signed-in views are also recorded to the account. |
| P-13 | Mobile sticky purchase bar. | **Fix** |

## Watch & Shop

| # | Difference | Status |
|---|---|---|
| W-1 | "WATCH & SHOP CINEMA / Live Fashion in Motion" header; 9:16 player with creator chip, up/down arrows and caption; right rack "Tagged garments in this reel" with Quick Buy and Full Details; "Explore all shoppable reels" thumbnails. Current uses a different layout. | **Fix**, with real shoppable media and tags. |
| W-2 | View counts ("128K"). | **Blocked**: no view data; not shown. |

## Wishlist, bag, checkout

| # | Difference | Status |
|---|---|---|
| B-1 | Bag drawer "Shopping Bag / Review Bag (n)", items with quantity stepper and "Save for later", totals, primary-colour PROCEED TO CHECKOUT. | **Fix**. Coupon codes, rewards earned and delivery charges are shown at checkout from the live service, not invented in the drawer. |
| B-2 | Bag page copy "calculated by the live checkout service". | **Fix**: customer language. |
| B-3 | Wishlist page "Saved Garments (n)" with original cards and MOVE TO BAG. | **Fix** |
| B-4 | Bag not emptied after an order (LR-011). | **Fix**: ordered quantities are removed when the order is created; the header count updates. |
| B-5 | Prices "₹6990". | **Fix**: en-IN "₹6,990" everywhere. |

## Footer

| # | Difference | Status |
|---|---|---|
| F-1 | Trust strip of four items. | **Fix** for layout. **Data** for copy (see C-1). |
| F-2 | VANYA Rewards "Atelier Loyalty Circle" panel with earning rules. | **Fix** for layout. **Blocked** for the figures (1 pt per ₹10, festive multipliers, 100 pts = ₹50, tiers): the earning rates are not published to shoppers, so the panel describes the programme and links to the shopper's real balance. |
| F-3 | Trending Categories (D3 chart). | **Blocked**: it shows fabricated demand data; no public analytics exist. |
| F-4 | Columns: brand blurb, Shop (department), Help, About VANYA, Join the Atelier (newsletter) + socials; legal row. | **Fix** for columns and the legal row. **Blocked**: newsletter (no subscription service); About links that have no pages; social handles (none approved). |

## Overlays

| # | Difference | Status |
|---|---|---|
| O-1 | Search overlay: query box, "Vibe & Occasion" chips with counts, Trending Searches, Recent Inquiries, Explore Key Categories, result cards. | **Fix**: typed searches use the real search index; the vibe chips use the design's own matching rules over the department's live products (counts shown only when every product is loaded). **Data**: "Trending Searches" is shown as "Suggested Searches" (no trending data exists); Recent Inquiries are this browser's own searches. |
| O-2 | Quick-add sheet and size guide / "My Size Finder". | **Fix**: live sizes per colour; the size chart and recommendation come from the product's chart. Opened from the footer, the guide explains that charts are on each product. |

## Copy and formatting

| # | Difference | Status |
|---|---|---|
| C-1 | Prototype promises: free delivery above ₹999/₹1,999, complimentary express delivery and bespoke tailoring above ₹5,000, 7-day returns, coupon VANYA10. | **Not adopted.** Real policy values are shown where the API provides them (`policies.returns.windowDays`, confirmed `shipping.freeAboveAmount`); otherwise neutral wording. |
| C-2 | Money "₹6990"; "1 styles", "1 items"; technical shopper copy. | **Fix** |
| C-3 | Text contrast: several of the original's small grey labels (`#8C7F72`, `#8A7D71`, `#7E7468` and similar, 3.0–4.4:1), the theme primaries (`#8F6B4E`, `#866791`, 4.49:1 on their page colours) and the footer's legal row (`#786D61` on `#1A1816`, 3.5:1) are below WCAG AA for small text. | **Adjusted for accessibility.** Each is darkened to the nearest passing shade with the same hue (greys `#756A5E`; primaries `#876448` and `#7F6189`; on the dark footer, light tints `#B08D74`, `#B394BE` and `#A39789`). Layout, sizes and weights are unchanged; the shift is about one tone. |

## Admin (not governed by AI Studio)

| # | Difference | Status |
|---|---|---|
| A-1 | Mobile navigation stacks several screens of links above the workspace. | **Fix**: collapsible drawer; the workspace shows immediately. |

## Result

Recorded 2026-10-04 after the correction pass. Both applications were
captured again at 390×844 and 1440×900: the original from AI Studio and the
storefront from `npm run demo`. Screenshot pairs were compared one by one
for the gateway, both homes, both listings, both product pages, Watch & Shop,
wishlist, bag drawer, bag page, checkout and the phone admin.

**Corrected:** every row marked **Fix** above, which is G-1…G-4, H-1…H-7,
HM-1…HM-10, PC-1…PC-6, L-1…L-3, L-5…L-7, P-1…P-5, P-8, P-11…P-13, W-1,
B-1…B-5, F-1, F-4 (columns and legal row), O-1, O-2, C-2 and A-1.

**Shown with real data:** PC-2, PC-5, P-9, P-10, H-2, HM-2, F-1.

**Blocked:** none of these is faked; each waits on real data or a business
decision.

| Item | Blocked on |
|---|---|
| L-4 Fit-First filter | No per-garment measurements |
| P-4 restock "Notify me" | No restock-alert service |
| P-6 coordinated-ensemble discount and look hotspots | No styled-look data and no approved discount |
| P-7 Digital Product Passport | No provenance data |
| W-2 view counts | No view data |
| F-2 rewards figures | Earning rates are not published to shoppers |
| F-3 trending chart | Would need fabricated demand data |
| F-4 newsletter, About pages and social handles | None exist |
| C-1 prototype delivery, returns and coupon promises | Not adopted |

**Adjusted:** C-3, a one-tone darkening of text that was below WCAG AA.

**Visual checks done:**

- No horizontal overflow at 320, 390, 768, 1024, 1280 and 1440 px on any
  storefront page.
- The header brand row and navigation do not overlap at any width.
- The preview strip sits above the gateway, and the gateway now fits the
  remaining height, so its bottom ticker stays visible.
- Bag and search dialogs hold keyboard focus and return it on Escape.
- Touch targets in the bag and checkout are at least 44 px; the checkout
  E2E checks this on a phone viewport.
- axe (WCAG 2 A/AA) finds no serious or critical violations on every
  storefront page and overlay, at both widths and for both departments.

**Not verifiable here:**

- Photographs and reels. Unsplash and Mixkit are blocked by this
  environment's network policy, so both sides of every capture show a grey
  tile where the photograph is. On a normal network, such as the reviewer's
  Mac, the demo shows the original photographs.
- Typefaces. Google Fonts are also blocked, so the captures use fallback
  fonts. The storefront ships the design's fonts (Playfair Display and
  Inter) through `next/font`.

**Next step:** visual sign-off is the Product Owner's, on the running
demo.
