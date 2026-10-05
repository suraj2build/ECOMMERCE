import sharp from 'sharp';
import { loadEnv } from '@fcp/config';
import { ValidationError } from '@fcp/shared';
import { sniffImageMimeType } from '../modules/returns/evidence-storage.js';

// Uploads are decoded once and discarded; libvips' operation cache would
// only hold on to memory between unrelated uploads.
sharp.cache(false);

export type ImageMimeType = 'image/jpeg' | 'image/png' | 'image/webp';

const FORMAT: Record<ImageMimeType, string> = { 'image/jpeg': 'jpeg', 'image/png': 'png', 'image/webp': 'webp' };

export interface CheckedImage {
  mimeType: ImageMimeType;
  width: number;
  height: number;
}

const DAMAGED = 'The file is damaged or is not a complete image. Export it again and upload the new file.';

/**
 * Proves an upload is a real, complete still image within the size limits,
 * given the type already sniffed from its bytes (never the client's claim):
 *
 * 1. the header must parse and name the same format the bytes started with;
 * 2. dimensions are checked from the header BEFORE any pixel is decoded, so
 *    a small file claiming enormous dimensions (a decompression bomb) is
 *    refused without allocating its pixels;
 * 3. multi-frame (animated) images are refused - photos are stills;
 * 4. every pixel is then decoded with decoder WARNINGS fatal, which rejects
 *    truncated or corrupt data that only looks like an image at the start.
 *    Warnings, not just errors: libjpeg reports a JPEG whose image data was
 *    cut short (the rest would show grey) only as a warning. Normal camera,
 *    phone and editor exports decode without warnings; a rejected file is
 *    fixed by exporting it again.
 */
export async function inspectImage(buffer: Buffer, mimeType: ImageMimeType): Promise<CheckedImage> {
  const env = loadEnv();
  let meta: Awaited<ReturnType<ReturnType<typeof sharp>['metadata']>>;
  try {
    meta = await sharp(buffer, { limitInputPixels: false }).metadata();
  } catch {
    throw new ValidationError(DAMAGED);
  }
  const { width, height } = meta;
  if (meta.format !== FORMAT[mimeType] || !width || !height) throw new ValidationError(DAMAGED);
  if ((meta.pages ?? 1) > 1) throw new ValidationError('Animated images are not accepted. Upload a still photo.');
  const longest = Math.max(width, height);
  if (longest > env.IMAGE_UPLOAD_MAX_EDGE_PX) {
    throw new ValidationError(`The image is ${width} × ${height} pixels; its longest side can be at most ${env.IMAGE_UPLOAD_MAX_EDGE_PX} pixels.`);
  }
  if (width * height > env.IMAGE_UPLOAD_MAX_PIXELS) {
    throw new ValidationError(`The image is ${width} × ${height} pixels; it can have at most ${Math.round(env.IMAGE_UPLOAD_MAX_PIXELS / 1_000_000)} million pixels.`);
  }
  try {
    await sharp(buffer, { failOn: 'warning', limitInputPixels: env.IMAGE_UPLOAD_MAX_PIXELS }).stats();
  } catch {
    throw new ValidationError(DAMAGED);
  }
  return { mimeType, width, height };
}

/** Sniffs the type from the bytes, then {@link inspectImage}. JPEG, PNG and WebP only. */
export async function checkUploadedImage(buffer: Buffer, noun: 'photo' | 'image' = 'image'): Promise<CheckedImage> {
  const sniffed = sniffImageMimeType(buffer);
  if (sniffed !== 'image/jpeg' && sniffed !== 'image/png' && sniffed !== 'image/webp') {
    throw new ValidationError(`Upload a JPEG, PNG or WebP ${noun}`);
  }
  return inspectImage(buffer, sniffed);
}
