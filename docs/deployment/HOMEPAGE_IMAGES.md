# Launch homepage images

AI-generated UAT campaign imagery uses Aryan, Heena, Riya and Deeksha's supplied character sheets. Men's styling is daily wear and business casual; women's styling leads with colourful, lively fashion, everyday and partywear, with a smaller workwear edit. Product photography is intentionally unchanged.

The 36 existing CMS banner positions are mapped in `scripts/demo-data/homepage-images.json`. Image files live under `apps/storefront/public/campaigns/launch-v1/`. Matching category positions reuse campaign images; footwear and belts have dedicated still-life images. Generated imagery represents a demo assortment, not verified merchandise or customer endorsements.

## Apply on the desktop running the demo

1. Fetch and switch to `main` (`git fetch origin`, then `git switch main` or `git switch --track origin/main` if it is not local), pull this revision and rebuild/restart the storefront using the desktop's working configuration so `/campaigns/launch-v1/*.webp` is served.
2. Set `DEMO_STOREFRONT_URL` to the URL reachable by all intended testers (for the existing LAN demo, the desktop's current LAN URL). The API defaults to `http://localhost:4000`; override `DEMO_API_URL` if needed. Demo staff credentials are read from `.demo/settings.json` or the existing `SEED_SUPER_ADMIN_EMAIL`/`SEED_SUPER_ADMIN_PASSWORD` environment variables.
3. Run `node scripts/apply-homepage-images.mjs` for preflight/dry run, then `node scripts/apply-homepage-images.mjs --apply`.
4. Open both departments on desktop and phone. Check gateway, hero, feature, category circles, occasion cards and lifestyle galleries, including their existing links.

The updater patches only `imageUrl` on exactly matched existing CMS rows. It preserves banner IDs, titles, links, ordering, product data, orders and inventory, and uses the audited staff API. It stores origin-relative asset URLs, so the same images work on localhost, LAN and a future hosted storefront. It validates all remote image responses before writing, refuses ambiguous or changed banner matches and verifies persisted values after applying. It is safe to rerun after a partial failure. `--validate` checks the manifest and local files without contacting the API.

Do not run a database reset or bump the demo catalogue version to install images. The generation session cannot reach the desktop's private LAN demo; live CMS application and browser verification must happen there.

Review gallery: `/campaigns/launch-v1/preview.html`. The final model roles are Aryan for menswear, Riya for playful everyday fashion, Heena for glamour/partywear, and Deeksha for daily wear/formals/everyday kurtis. Alisha's draft variants were replaced following the user's comparison review. Final generation prompts are recorded in `scripts/demo-data/homepage-image-prompts.json`; imagery was produced with the built-in image generation tool.

## Review and validation

Every selected source image was visually reviewed for facial identity, head/body proportions, neck alignment, garment visibility, hands, lighting and background consistency. Repetitive female poses and rejected model variants were regenerated. Mobile hero/feature crop positions were adjusted to keep the model visible. Storefront typecheck, lint and production build passed; the image-only updater passed dry-run, idempotency and preflight guard checks. Full rendered storefront browser verification remains a desktop step: browser access to this environment's local preview was blocked, and the desktop LAN API is not reachable here.
