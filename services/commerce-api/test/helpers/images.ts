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

/**
 * A phone-style photo carrying the metadata AO-D6 removes from public
 * images: camera make/model, a GPS position, XMP (photographer's name) and
 * an EXIF orientation of 6 (stored sideways, shown upright), plus a Display
 * P3 colour profile that must be kept. Stored 40 × 20: the left half red,
 * the right half blue, so after the orientation is applied (20 × 40) the
 * top half is red and the bottom half blue.
 */
export async function photoWithMetadata(format: 'jpeg' | 'png' | 'webp' = 'jpeg'): Promise<Buffer> {
  const width = 40;
  const height = 20;
  const pixels = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 3;
      const red = x < width / 2;
      pixels[i] = red ? 220 : 30;
      pixels[i + 1] = 30;
      pixels[i + 2] = red ? 30 : 220;
    }
  }
  const xmp =
    '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:dc="http://purl.org/dc/elements/1.1/" dc:creator="Secret Photographer"/></rdf:RDF></x:xmpmeta>';
  const image = sharp(pixels, { raw: { width, height, channels: 3 } })
    .withIccProfile('p3')
    .withExif({ IFD0: { Make: 'TestCam', Model: 'X100' }, IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '28/1 36/1 0/1', GPSLongitudeRef: 'E', GPSLongitude: '77/1 12/1 0/1' } })
    .withXmp(xmp)
    .withMetadata({ orientation: 6 });
  if (format === 'png') return image.png().toBuffer();
  if (format === 'webp') return image.webp({ quality: 95 }).toBuffer();
  return image.jpeg({ quality: 95 }).toBuffer();
}

/** True when the EXIF block has a GPS section (the GPS IFD pointer, tag 0x8825, little- or big-endian). */
export function exifHasGps(exif: Buffer | undefined): boolean {
  return Boolean(exif && (exif.includes(Buffer.from([0x25, 0x88])) || exif.includes(Buffer.from([0x88, 0x25]))));
}

/** Mean absolute difference per channel value between two images of the same size, after applying orientation. */
export async function meanPixelDifference(a: Buffer, b: Buffer): Promise<number> {
  const [ra, rb] = await Promise.all([sharp(a).rotate().removeAlpha().raw().toBuffer({ resolveWithObject: true }), sharp(b).rotate().removeAlpha().raw().toBuffer({ resolveWithObject: true })]);
  if (ra.info.width !== rb.info.width || ra.info.height !== rb.info.height) throw new Error('images differ in size');
  let total = 0;
  for (let i = 0; i < ra.data.length; i++) total += Math.abs(ra.data[i]! - rb.data[i]!);
  return total / ra.data.length;
}
