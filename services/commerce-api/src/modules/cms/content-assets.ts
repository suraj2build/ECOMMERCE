import type { FastifyInstance } from 'fastify';
import { loadEnv } from '@fcp/config';
import { ConflictError, NotFoundError, ValidationError } from '@fcp/shared';
import { recordAudit } from '../audit/service.js';
import { sniffImageMimeType } from '../returns/evidence-storage.js';
import { newProductMediaKey, PRODUCT_MEDIA_KEY, resolveProductMediaStore, type ProductMediaStore } from '../product/media-storage.js';

/** The URL stored on a banner or page: relative to the storefront, which proxies it to the API. */
export function contentAssetUrl(key: string): string {
  return `/media/content/${key}`;
}

/**
 * Admin Ops Phase 1: images uploaded for banners and pages. They live in
 * the same public store as product photos (never the private return-
 * evidence store) and are served only while their ContentAsset row exists.
 */
export class ContentAssetService {
  private storeInstance: ProductMediaStore | undefined;

  constructor(private readonly fastify: FastifyInstance, store?: ProductMediaStore) {
    this.storeInstance = store;
  }

  private get store(): ProductMediaStore {
    this.storeInstance ??= resolveProductMediaStore();
    return this.storeInstance;
  }

  async upload(buffer: Buffer, altText: string | null, actorStaffId: string) {
    const max = loadEnv().PRODUCT_MEDIA_MAX_FILE_SIZE_BYTES;
    if (buffer.length === 0) throw new ValidationError('The file is empty');
    if (buffer.length > max) throw new ValidationError(`The image is larger than ${Math.round(max / 1048576)} MB`);
    const mimeType = sniffImageMimeType(buffer);
    if (!mimeType) throw new ValidationError('Upload a JPEG, PNG or WebP image');
    const storageKey = newProductMediaKey(mimeType);
    try {
      await this.store.put(storageKey, buffer, mimeType);
    } catch (err) {
      this.fastify.log.error({ err }, 'content asset store write failed');
      throw new ConflictError('The image could not be saved to storage. Nothing was changed; check Setup → Media storage.');
    }
    const asset = await this.fastify.prisma.contentAsset.create({
      data: { storageKey, mimeType, byteSize: buffer.length, altText: altText?.trim() || null, createdByStaffId: actorStaffId },
    });
    await recordAudit(this.fastify.prisma, { actorType: 'STAFF', actorStaffId, action: 'cms.asset.upload', entityType: 'ContentAsset', entityId: asset.id, newValue: { mimeType, byteSize: buffer.length } });
    return { ...asset, url: contentAssetUrl(storageKey) };
  }

  async list(take = 60) {
    const assets = await this.fastify.prisma.contentAsset.findMany({ orderBy: { createdAt: 'desc' }, take });
    return assets.map((a) => ({ id: a.id, url: contentAssetUrl(a.storageKey), altText: a.altText, byteSize: a.byteSize, createdAt: a.createdAt }));
  }

  async readPublic(key: string) {
    if (!PRODUCT_MEDIA_KEY.test(key)) throw new NotFoundError('ContentAsset', key);
    const asset = await this.fastify.prisma.contentAsset.findUnique({ where: { storageKey: key } });
    if (!asset) throw new NotFoundError('ContentAsset', key);
    const object = await this.store.get(key);
    return { buffer: object.buffer, mimeType: asset.mimeType };
  }
}
