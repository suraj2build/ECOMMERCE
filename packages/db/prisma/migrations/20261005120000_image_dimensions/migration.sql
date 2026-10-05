-- Pixel dimensions of uploaded images, read while each upload is fully
-- decoded. Nullable: media referenced by URL, and files uploaded before
-- this change, have none.
ALTER TABLE "product_media" ADD COLUMN "width" INTEGER, ADD COLUMN "height" INTEGER;
ALTER TABLE "content_assets" ADD COLUMN "width" INTEGER, ADD COLUMN "height" INTEGER;
