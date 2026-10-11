# Separate Lookbooks and Shop the Story

Implemented on `feat/gender-lookbooks`, based on main e8c87cb. This branch does not include the separate admin-ops branch.

## Customer experience

- `/women/lookbook` and `/men/lookbook`: separate editorial hubs, occasion filters, two stories each.
- Four story pages: city-days, after-the-light (women), the-working-week and off-the-clock (men).
- Twelve editorial looks with chapter navigation, photography, captions and a homepage teaser.
- Header and mobile drawer links; visiting a department route selects that department.
- Exact mapped pieces open a shopping panel. Each needs its own size; prices and availability come from commerce-api. The exact colour/size is checked again immediately before adding. There is no automatic replacement with a similar garment or another colour.
- Keyboard focus is trapped/restored and Escape closes the panel. Failed/unpublished pieces cannot be added.
- Existing bag, checkout and commerce services remain authoritative.

## Launch content and honest limits

The shipped photographs are **editorial inspiration**. All launch `items` arrays are empty. No real catalogue mappings were verified in this environment. Consequently the initial public edition explains that product shopping appears once exact pictured pieces are linked; it does not invent buy buttons for generated clothes.

The panel is implemented, but purchasing a mapped story requires staff to publish its exact style/colour mappings through the existing CMS. No new admin editor or backend/schema migration is included. There is no full-look bundle add, video autoplay, hotspot editor or dynamically created story route in this edition.

## Publish a mapped story with the existing CMS

1. Start from one of `content/*.json` in this folder. Confirm every mapped item actually matches the pictured garment and colour; styling accessories may be omitted.
2. Add an item `{ "styleId": "<published product UUID>", "colourId": "<exact colour UUID>" }` to its look. Copy IDs from the catalogue, never from a name/category guess. Leave inspiration-only looks empty.
3. In Content → Content blocks, create an active block with key `lookbook-women-city-days` (or the appropriate registered department/slug), title of your choice, and JSON as its content. Updates use the existing PATCH `/cms/content-blocks/:id` route. The generic block screen on this base supports creation/toggling only.
4. In Content → Landing pages, create a page whose slug and block key both equal that key, then publish it. Public reads resolve active blocks from published pages only.
5. Check `/women/lookbook/city-days` (or corresponding route). The existing catalogue cache invalidation/60-second window applies.
6. Verify mobile/desktop, current prices, each size, unavailable items and bag contents before launch.

JSON accepts a cover, intro, and 1–12 looks, each with title, image URL, meaningful alt, caption and 0–8 unique style/colour pairs. Only same-site paths or HTTPS media URLs are accepted. Route and department cannot be changed by JSON. Invalid published content returns 404; an unavailable CMS returns an error rather than pretending to serve its current published mappings. Missing/unpublished CMS overrides show the bundled inspiration edition. Hub titles/covers remain the bundled edition; CMS overrides apply to the story detail.

## Image direction and provenance

Three campaign references were edited using ImageGen. Output WebPs are in `apps/storefront/public/campaigns/lookbook-v1`.

- Riya: original cafe campaign; preserve face/outfit, improve head/neck alignment and natural posture.
- Heena: original green satin dress campaign; improve lighting/location with a warm evening terrace, preserve dress and natural proportions.
- Deeksha: original one-shoulder green dress campaign; retain identity and garment, reduce exaggerated chest emphasis, improve natural fit and framing.

These are AI edits of existing campaign references, not new photographs or verified product photos. Approved latest model sheets were not all independently recovered. Human review must confirm identity consistency, anatomy, hands, seams, jewellery, actual garment details and crop safety. A flatter pose alone does not guarantee model-sheet compliance. Existing men's images are reused.

## Validation

See VALIDATION.md for checks actually completed and any blocked checks. Screenshots/videos, when present, describe the implementation preview and must not be called courier or payment UAT.
