# Lookbook management and shopping flow

Authorized by the Product Owner on 2026-10-11: “check the flow all lookbookshould have the flow rto resch the prudct to buy it... also it should have admin page also to create look book upload images etc.”

Build scope: Content → Lookbooks, uploads, ordered looks, exact existing product/colour selection, draft/published snapshots, optimistic revision protection, storefront discovery and buying links. No generated inventory or guessed product matches. This extends the existing CMS content-block storage; no database migration is required.

Staff need `cms:read` to view and `cms:manage` to upload, save and publish. Each published look needs at least one real published product with its own colour and active variants in the selected department. Stock may later sell out; the shopper sees current availability and can still reach the product page. Staff remain responsible for matching every pictured saleable garment to the selected product.

Draft edits do not change the currently published edition. Publish promotes the saved form to a public snapshot; unpublish removes the managed edition from the hub and routes. Two editors cannot silently overwrite each other.

Uploads accept JPEG/PNG/WebP up to 5 MiB and 40 megapixels, decode and re-encode upright to WebP, and remove camera metadata. Local previews use `CMS_MEDIA_STORAGE=local` and `CMS_MEDIA_STORAGE_DIR`; production requires `CMS_MEDIA_STORAGE=s3`, using the existing S3 connection and product-media bucket under a separate `lookbook-media/` prefix. The API serves public editorial images; private return evidence remains separate.

Older unmapped inspirations offer clearly labelled department shopping and navigation to the complete mapped book. They never claim a similar item is the exact photographed one. New managed editions cannot publish empty product mappings.

## Configure an edition

Open `http://localhost:3001/dashboard/cms/lookbooks` (Content → Lookbooks). Super Admin and Marketing have the relevant CMS permissions in the standard role setup.

1. Choose **Create** or configure an existing bundled edition using the template controls. Importing creates a draft and keeps the bundled edition visible until publication.
2. Set the department, title, introduction, occasion, format and cover. Use scrolling story or complete book.
3. Add ordered looks, upload each image, describe it with alt text and captions, and select the exact existing products and colours. Link every saleable garment shown. Missing template products must be resolved before publishing.
4. Save a draft. Review the linked products, images and ordering, then publish. Existing published content stays visible while you edit the next draft.
5. Open the department Lookbook hub. A story offers product details and size selection/add to bag; complete books pair photographs with shoppable product pages. Unpublish removes the edition from public discovery and its public route.

Choose homepage visibility and display order in the editor. Storefront changes may take up to 60 seconds to appear due to caching. Uploaded images are editorial public assets, not private evidence.

## Run the change locally

Pull `feat/gender-lookbooks`, run `npm ci`, and restart the API, admin and storefront. No database migration or data reset is needed. Configure the image storage settings above. `NEXT_PUBLIC_STOREFRONT_URL` controls admin previews when the storefront is hosted elsewhere.

The original bundled book keeps its downloadable PDF. Managed books do not automatically generate a new PDF; the reader reflects the published content, and an outdated static PDF is not attached to edited books.

## Validation — 2026-10-11

- API unit: 97/97. These use isolated repository/auth fixtures; they are not a real database integration run.
- Storefront unit: 36/36.
- Production builds: API, admin and storefront passed; typechecks passed.
- Lookbook browser suite: 13/13 on production builds against the isolated mock catalogue. Covers upload, exact product/colour selection, draft/publish/unpublish, homepage/hub discovery, story and book shopping, product colour selection, bag, imports and read-only permissions.
- Real database integration: blocked during setup because PostgreSQL/Redis are unavailable here. The new integration tests cover snapshot privacy and concurrent publication but have not passed locally. No complete commerce/courier UAT or user-machine localhost verification is claimed.

Earlier browser runs exposed a mapped-look render guard and cached product-page query handling; both were corrected before the final passing run. Test selectors and read-only fixture setup were also corrected.

The final dependency check patched source-map-js to 1.2.2; production audit passes the high-severity gate. Two pre-existing moderate advisories remain (Next.js and fast-jwt). Storefront/admin builds and the browser journey were rerun on this lockfile.
