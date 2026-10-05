import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { checkUploadedImage, decodeSlotsInUse, MAX_CONCURRENT_DECODES } from '../../src/lib/image-validation.js';

const jpeg = (width: number, height: number, orientation?: number) => {
  const img = sharp({ create: { width, height, channels: 3, background: { r: 120, g: 80, b: 60 } } }).jpeg({ quality: 80 });
  return (orientation ? img.withMetadata({ orientation }) : img).toBuffer();
};

describe('uploaded image checks', () => {
  it('records the size a photo is shown at: a sideways-stored phone photo has width and height swapped', async () => {
    expect(await checkUploadedImage(await jpeg(400, 300))).toMatchObject({ mimeType: 'image/jpeg', width: 400, height: 300 });
    expect(await checkUploadedImage(await jpeg(400, 300, 6))).toMatchObject({ width: 300, height: 400 });
    expect(await checkUploadedImage(await jpeg(400, 300, 3))).toMatchObject({ width: 400, height: 300 });
  });

  it(`decodes at most ${MAX_CONCURRENT_DECODES} images at once; the rest wait their turn and still finish`, async () => {
    const big = await jpeg(3000, 2000);
    let maxActive = 0;
    let sawWaiting = false;
    let done = false;
    const sampler = (async () => {
      while (!done) {
        const { active, waiting } = decodeSlotsInUse();
        maxActive = Math.max(maxActive, active);
        if (waiting > 0) sawWaiting = true;
        await new Promise((r) => setImmediate(r));
      }
    })();
    const results = await Promise.all(Array.from({ length: 6 }, () => checkUploadedImage(big)));
    done = true;
    await sampler;
    expect(results.every((r) => r.width === 3000 && r.height === 2000)).toBe(true);
    expect(maxActive).toBeLessThanOrEqual(MAX_CONCURRENT_DECODES);
    expect(sawWaiting).toBe(true);
    expect(decodeSlotsInUse()).toEqual({ active: 0, waiting: 0 });
  });

  it('frees its slot when a decode fails', async () => {
    const good = await jpeg(200, 200);
    const truncated = good.subarray(0, Math.floor(good.length / 2));
    await expect(checkUploadedImage(truncated)).rejects.toThrow(/damaged/);
    expect(decodeSlotsInUse()).toEqual({ active: 0, waiting: 0 });
  });
});
