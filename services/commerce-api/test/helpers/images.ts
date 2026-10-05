import zlib from 'node:zlib';
import sharp from 'sharp';

/**
 * Real image files for upload tests, made with the same decoder the API
 * uses, plus deliberately broken ones. A fixed noise pattern keeps the
 * compressed data non-trivial, so a truncation actually removes pixels.
 */
function noise(width: number, height: number): Buffer {
  const pixels = Buffer.alloc(width * height * 3);
  for (let i = 0; i < pixels.length; i++) pixels[i] = (i * 7919) % 251;
  return pixels;
}

const raw = (width: number, height: number) => sharp(noise(width, height), { raw: { width, height, channels: 3 } });

export const realJpeg = (width = 64, height = 48) => raw(width, height).jpeg({ quality: 90 }).toBuffer();
export const realPng = (width = 64, height = 48) => raw(width, height).png().toBuffer();
export const realWebp = (width = 64, height = 48) => raw(width, height).webp().toBuffer();

/** A JPEG whose header is intact but whose image data stops half way (end marker restored). */
export async function cutShortJpeg(): Promise<Buffer> {
  const jpeg = await realJpeg();
  return Buffer.concat([jpeg.subarray(0, Math.floor(jpeg.length * 0.5)), Buffer.from([0xff, 0xd9])]);
}

/** A PNG cut off part-way through its compressed data. */
export async function truncatedPng(): Promise<Buffer> {
  const png = await realPng();
  return png.subarray(0, Math.floor(png.length * 0.7));
}

/** Only the JPEG start-of-image bytes followed by filler: passes a byte-signature check, is not an image. */
export const fakeJpeg = () => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 0x11)]);

/** A two-frame animated WebP. */
export async function animatedWebp(): Promise<Buffer> {
  const frame = (background: string) => sharp({ create: { width: 16, height: 16, channels: 3, background } }).png().toBuffer();
  return sharp([await frame('#ff0000'), await frame('#00ff00')], { join: { animated: true } }).webp().toBuffer();
}

/**
 * A few hundred bytes whose PNG header claims `width` x `height` pixels (a
 * decompression bomb when large). Only the header is valid; the upload
 * check must refuse it from the header, before decoding any pixel.
 */
export function claimedPng(width: number, height: number): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(body) >>> 0);
    return Buffer.concat([length, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // truecolour
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(Buffer.alloc(64))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
