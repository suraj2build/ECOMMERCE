# Review preview: deployment plan (LR-010)

A hosted copy of VANYA that you can open on your phone, with the storefront,
the admin console and the API. It is **not production**: payments run in
Razorpay test mode, sign-in codes and shipments use the labelled test
doubles until the SMS and carrier vendors are chosen (LR-008), search
engines are told not to index it, and every storefront page carries a
"Preview site" banner.

## Recommended host: Render

Why Render:

- It hosts the whole stack: managed Postgres, Key Value (Redis), a private
  Meilisearch service with a disk, and three web services.
- Each service gets an HTTPS `*.onrender.com` address that opens on a phone.
- Secrets live in Render's encrypted environment settings, never in the
  repository.
- The setup is one file in the repository, `infra/preview/render.yaml`.
- Singapore is its closest region to India.

Choosing another host changes only that file, not the application.

## What runs

| Service | Render type | Plan | Purpose |
|---|---|---|---|
| `vanya-preview-storefront` | Web service (Node 24) | Starter | Customer storefront |
| `vanya-preview-admin` | Web service (Node 24) | Starter | Staff console |
| `vanya-preview-api` | Web service (Node 24) + 1 GB disk | Starter | commerce-api, scheduled jobs, return photos |
| `vanya-preview-search` | Private service (Meilisearch 1.10) + 1 GB disk | Starter | Search index |
| `vanya-preview-db` | Postgres 16 | Basic-256mb | System of record |
| `vanya-preview-cache` | Key Value | Starter | Staff sessions, rate limits |

On each deploy the API runs the database migrations and the base seed (an
idempotent step that adds roles, permissions and reference data) before it
starts.

## Monthly cost (estimate)

| Item | USD / month |
|---|---|
| 3 web services × Starter ($7) | 21.00 |
| Meilisearch private service, Starter | 7.00 |
| Postgres Basic-256mb ($6) + 5 GB storage ($0.30/GB) | 7.50 |
| Key Value Starter | 10.00 |
| 2 × 1 GB disks ($0.25/GB) | 0.50 |
| **Total** | **≈ $46 (about ₹4,000)** |

Possible additions:

- **Pro workspace (+$25):** needed if your team wants several members or
  more included bandwidth. A Hobby workspace is free.
- **API on Standard (+$18):** only if the 512 MB Starter instance runs out
  of memory.
- **Typical range:** $46–$89 a month.

Render bills by the second, so suspended services cost nothing while
suspended.

These prices come from third-party summaries dated September 2026. This
environment's network policy blocks `render.com`, so I could not read
Render's own pricing page. Render changed its workspace pricing in August
2026. **Confirm the figures on render.com/pricing before you create the
services.**

Sources:

- [makerkit Render pricing calculator](https://makerkit.dev/pricing-calculator/render)
- [srvrlss.io: Render](https://www.srvrlss.io/provider/render/)
- [bex.co: Render price changes](https://bex.co/blog/2026/09/04/render-price-changes-cost-sheet)
- [bex.co: Render Pro seats vs bandwidth](https://bex.co/blog/2026/09/03/render-pro-seats-vs-bandwidth)

## What you provide

You enter these in Render's environment settings. Never paste them into
chat or commit them.

Required:

1. **A Render account in the business's name**, with a payment card, and
   GitHub connected with access to `suraj2build/ECOMMERCE`.
2. **`MFA_SECRET_ENCRYPTION_KEY`**: 64 hex characters, from
   `openssl rand -hex 32`. Keep a copy; staff MFA secrets cannot be read
   without it.
3. **`SEED_SUPER_ADMIN_EMAIL` and `SEED_SUPER_ADMIN_PASSWORD`**: the
   preview's first admin login.
4. **The service addresses**, entered after Render assigns them (step 4
   below):
   - `NEXT_PUBLIC_API_URL`
   - `NEXT_PUBLIC_SITE_URL`
   - `CORS_ORIGINS`
   - `STOREFRONT_REVALIDATE_URL`
   - `STOREFRONT_PUBLIC_URL`
   - `MEILISEARCH_HOST`

Optional:

- **Razorpay test keys** (`rzp_test_…`) and a webhook secret, from the
  Razorpay dashboard in test mode. Without them the preview takes cash on
  delivery only. A live key stops the API from starting.
- **`MAINTENANCE_ALERT_WEBHOOK_URL`**: a Slack or Google Chat incoming
  webhook. Until it is set, failing scheduled jobs appear as error lines in
  the API's Render logs.
- **GA4 and Meta.** A separate GA4 test property; a Meta Pixel with
  `META_TEST_EVENT_CODE` (a preview refuses Meta server events without it).

Not needed for the preview:

- SMS vendor and carrier (LR-008);
- S3 (the API's own disk holds test return photos);
- Merchant Center and Meta catalogue accounts.

Render generates these itself:

- `JWT_ACCESS_SECRET`
- `GUEST_SESSION_SIGNING_SECRET`
- `STOREFRONT_REVALIDATE_SECRET`
- `MEILI_MASTER_KEY`

## Steps (about 30 minutes, mostly waiting for builds)

1. **Open the blueprint.** In Render: New → Blueprint. Choose
   `suraj2build/ECOMMERCE`, branch `claude/loving-fermat-cyucke`, and
   Blueprint file `infra/preview/render.yaml`.
2. **Enter the values.** Fill in the values from "What you provide". For
   the addresses, use the expected names; correct them in step 4 if Render
   assigns different ones:
   - `NEXT_PUBLIC_API_URL` = `https://vanya-preview-api.onrender.com`
   - `NEXT_PUBLIC_SITE_URL` and `STOREFRONT_PUBLIC_URL` =
     `https://vanya-preview-storefront.onrender.com`
   - `STOREFRONT_REVALIDATE_URL` = the storefront address +
     `/api/revalidate/product`
   - `CORS_ORIGINS` = the storefront and admin addresses, comma-separated
   - `MEILISEARCH_HOST` = `http://vanya-preview-search:7700` (the search
     service's internal address, shown on its Render page)
3. **Apply.** Render creates the database, cache and search service,
   builds the three apps, and runs migrations and the base seed. Builds
   take about 5 minutes each.
4. **Check the addresses.** If any address Render shows differs from what
   you entered, update the values. Then redeploy the storefront and admin:
   their `NEXT_PUBLIC_` values are fixed when they are built.
5. **Load the demo catalogue.** It has 12 products with sizes, size charts,
   collections and Watch & Shop. Open the API service's Shell in Render and
   run:

   ```
   DEMO_SEED_ALLOWED=preview DEMO_API_URL=http://localhost:$PORT \
   DEMO_ASSET_BASE=https://vanya-preview-storefront.onrender.com \
   node scripts/seed-demo.mjs
   ```

6. **Set up Razorpay (optional).** In the Razorpay test dashboard, add the
   webhook `https://vanya-preview-api.onrender.com/api/v1/webhooks/razorpay`
   with the same secret as `RAZORPAY_WEBHOOK_SECRET`.
7. **Open it on your phone.**
   - Storefront: `https://vanya-preview-storefront.onrender.com`
   - Admin: `https://vanya-preview-admin.onrender.com/login`, with the seed
     admin email and password.
   - Customer sign-in by mobile works with any test number. The six-digit
     code appears in the API service's Render logs, marked
     `[dev-only] OTP`. On a preview it is printed there because no SMS
     vendor exists yet.

## Rehearsal (2026-10-04, local)

I ran the blueprint's exact build, pre-deploy and start commands from a
fresh clone of `c6b3ee6`, with `NODE_ENV=production` and
`DEPLOYMENT_STAGE=preview`, against a new database and freshly generated
secrets. Results:

- **API.** `npm ci --include=dev` and the build finished in 50 s.
  Migrations and the base seed applied cleanly, and the new COD permission
  was granted to SUPER_ADMIN and FINANCE. The API started, logged the
  PREVIEW warning, and started the scheduled jobs.
- **Live Razorpay key.** Starting with an `rzp_live_` key failed with
  "a preview takes only Razorpay test-mode keys".
- **Storefront and admin.** Both built and served 200.
- **Indexing.** The storefront sent `X-Robots-Tag: noindex, nofollow`,
  `robots.txt` disallowed everything, and the preview banner was on the
  page.
- **Demo catalogue.** The demo seed ran against the running preview API,
  and 12 products were listed.
- **Sign-in.** Requesting a sign-in code printed it in the API log. The
  seed admin's login returned 200.
- **Checkout under contention.** 20 shoppers raced for 5 units of one
  product: 5 orders were accepted and 15 were refused with 409
  INSUFFICIENT_STOCK. Inventory reconciled (MATCH), with no reservations
  left active.

Not rehearsed:

- Render itself. Its schema validation and its build machines are
  unreachable from here, so the first real deploy is the check of the
  blueprint's syntax. If Render rejects a field, the error names it.
- Razorpay test payments. There are no test keys yet.

## Keeping it separate from production

- **Own data.** The preview has its own database, cache, search index and
  disk. Nothing is shared with a future production environment, and the
  demo seed refuses to run on the production stage.
- **No real money.** Live Razorpay keys are refused at startup.
- **No real conversions.** Meta server events go only to the Test Events
  tool. GA4 should point at a separate test property.
- **No search engines.** A preview is never indexed, even if
  `SITE_INDEXING=enabled` is set by mistake.
- **Production refuses all of this.** The production stage (the default)
  still refuses every mock provider and local-disk photo storage.

## Go-live is a separate step

This preview does not authorize or rehearse production. Go-live still needs:

- the LR-008 vendors;
- S3 storage;
- real provider accounts;
- a production deployment approved by you;
- smoke tests on that deployment.
