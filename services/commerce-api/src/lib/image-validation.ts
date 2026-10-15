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
 * Full decodes run at most this many at a time. A 40-megapixel photo needs
 * about 160 MB while it is decoded; without a limit, a burst of large
 * uploads could exhaust the server's memory. Uploads beyond the limit wait
 * their turn.
 */
export const MAX_CONCURRENT_DECODES = 2;
let activeDecodes = 0;
const waiting: Array<() => void> = [];

async function withDecodeSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (activeDecodes >= MAX_CONCURRENT_DECODES) await new Promise<void>((resolve) => waiting.push(resolve));
  else activeDecodes += 1;
  try {
    return await fn();
  } finally {
    const next = waiting.shift();
    if (next) next();
    else activeDecodes -= 1;
  }
}

/** For tests: how many decodes are running and waiting right now. */
export function decodeSlotsInUse() {
  return { active: activeDecodes, waiting: waiting.length };
}

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
  if (meta.format !== FORMAT[mimeType] || !meta.width || !meta.height) throw new ValidationError(DAMAGED);
  // A phone photo taken upright is often stored sideways with an EXIF
  // orientation of 5-8; it is shown rotated, so its displayed width and
  // height are swapped.
  const rotated = (meta.orientation ?? 1) >= 5;
  const width = rotated ? meta.height : meta.width;
  const height = rotated ? meta.width : meta.height;
  if ((meta.pages ?? 1) > 1) throw new ValidationError('Animated images are not accepted. Upload a still photo.');
  const longest = Math.max(width, height);
  if (longest > env.IMAGE_UPLOAD_MAX_EDGE_PX) {
    throw new ValidationError(`The image is ${width} × ${height} pixels; its longest side can be at most ${env.IMAGE_UPLOAD_MAX_EDGE_PX} pixels.`);
  }
  if (width * height > env.IMAGE_UPLOAD_MAX_PIXELS) {
    throw new ValidationError(`The image is ${width} × ${height} pixels; it can have at most ${Math.round(env.IMAGE_UPLOAD_MAX_PIXELS / 1_000_000)} million pixels.`);
  }
  try {
    await withDecodeSlot(() => sharp(buffer, { failOn: 'warning', limitInputPixels: env.IMAGE_UPLOAD_MAX_PIXELS }).stats());
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

export interface PublicImage extends CheckedImage {
  /** The bytes to store: re-encoded without camera or location metadata. */
  buffer: Buffer;
}

/**
 * AO-D6 (Product Owner, 2026-10-06): product photos and content images are
 * public, so camera and location metadata is removed before they are
 * stored. The image is checked first ({@link checkUploadedImage}), then
 * re-encoded by libvips:
 *
 * - orientation: the EXIF orientation is applied to the pixels and the tag
 *   dropped, so the photo shows the same way up everywhere;
 * - colour: the embedded ICC colour profile is kept (sharp's default
 *   output drops it, which would shift colours on wide-gamut photos);
 * - everything else is dropped: EXIF (camera, serial number, time, GPS),
 *   XMP and IPTC;
 * - format is unchanged. PNG stays lossless. JPEG and WebP are lossy
 *   formats, so they are re-encoded at quality 95 (JPEG without chroma
 *   subsampling), which is visually indistinguishable from the upload.
 *
 * Private return evidence does not come through here: it is kept exactly
 * as uploaded, in its own private store.
 */
export async function preparePublicImage(input: Buffer, noun: 'photo' | 'image' = 'image'): Promise<PublicImage> {
  const checked = await checkUploadedImage(input, noun);
  const env = loadEnv();
  let buffer: Buffer;
  try {
    buffer = await withDecodeSlot(() => {
      const pipeline = sharp(input, { failOn: 'warning', limitInputPixels: env.IMAGE_UPLOAD_MAX_PIXELS }).rotate().keepIccProfile();
      if (checked.mimeType === 'image/png') return pipeline.png({ compressionLevel: 9 }).toBuffer();
      if (checked.mimeType === 'image/webp') return pipeline.webp({ quality: 95, smartSubsample: true }).toBuffer();
      return pipeline.jpeg({ quality: 95, chromaSubsampling: '4:4:4' }).toBuffer();
    });
  } catch {
    throw new ValidationError(DAMAGED);
  }
  return { ...checked, buffer };
}
