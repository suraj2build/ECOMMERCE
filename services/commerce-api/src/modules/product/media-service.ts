import type { FastifyInstance } from 'fastify';
import type { ProductMedia } from '@fcp/db';
import { loadEnv } from '@fcp/config';
import { ConflictError, NotFoundError, ValidationError } from '@fcp/shared';
import { recordAudit } from '../audit/service.js';
import { sniffImageMimeType } from '../returns/evidence-storage.js';
import { newProductMediaKey, PRODUCT_MEDIA_KEY, productMediaUrl, resolveProductMediaStore, type ProductMediaStore } from './media-storage.js';

export interface UploadedFile {
  buffer: Buffer;
  /** As sent by the browser; only used for the audit record, never trusted. */
  filename?: string;
}

/**
 * Admin Ops Phase 1: product photos uploaded from the owner's computer,
 * plus colour assignment, listing (cover) photo, ordering, replacement and
 * removal for every product photo (uploaded or URL-referenced).
 *
 * The file type is taken from the bytes (JPEG/PNG/WebP), never from the
 * name or the browser's claim; the size limit is PRODUCT_MEDIA_MAX_FILE_SIZE_BYTES.
 * Writes are store-first: bytes are saved before any product record points
 * at them, so a failed save leaves the product exactly as it was.
 */
export class ProductMediaService {
  private storeInstance: ProductMediaStore | undefined;

  constructor(private readonly fastify: FastifyInstance, store?: ProductMediaStore) {
    this.storeInstance = store;
  }

  /** Resolved on first use, like return evidence: a production server without
   * PRODUCT_MEDIA_STORAGE=s3 still starts, refuses uploads with a clear
   * message, and shows the gap on the Setup page. */
  private get store(): ProductMediaStore {
    this.storeInstance ??= resolveProductMediaStore();
    return this.storeInstance;
  }

  private get prisma() {
    return this.fastify.prisma;
  }

  private async editableStyle(styleId: string) {
    const style = await this.prisma.style.findUnique({ where: { id: styleId } });
    if (!style) throw new NotFoundError('Style', styleId);
    if (style.lifecycleState === 'ARCHIVED') throw new ConflictError('This product is archived and can no longer be edited');
    return style;
  }

  private async mediaOf(mediaId: string) {
    const media = await this.prisma.productMedia.findUnique({ where: { id: mediaId } });
    if (!media) throw new NotFoundError('ProductMedia', mediaId);
    await this.editableStyle(media.styleId);
    return media;
  }

  private async checkColour(styleId: string, colourId: string | null | undefined) {
    if (!colourId) return;
    const colour = await this.prisma.colour.findUnique({ where: { id: colourId } });
    if (!colour || colour.styleId !== styleId) throw new ValidationError('That colour does not belong to this product');
  }

  /** Validates and stores the bytes; returns what the media row should record. */
  private async storeFile(file: UploadedFile) {
    const max = loadEnv().PRODUCT_MEDIA_MAX_FILE_SIZE_BYTES;
    if (file.buffer.length === 0) throw new ValidationError('The file is empty');
    if (file.buffer.length > max) throw new ValidationError(`The photo is larger than ${Math.round(max / 1048576)} MB`);
    const mimeType = sniffImageMimeType(file.buffer);
    if (!mimeType) throw new ValidationError('Upload a JPEG, PNG or WebP photo');
    const storageKey = newProductMediaKey(mimeType);
    let store: ProductMediaStore;
    try {
      store = this.store;
    } catch (err) {
      throw new ConflictError(`Photo storage is not set up: ${(err as Error).message}`);
    }
    try {
      await store.put(storageKey, file.buffer, mimeType);
    } catch (err) {
      this.fastify.log.error({ err }, 'product media store write failed');
      throw new ConflictError('The photo could not be saved to storage. Nothing was changed; try again or check Setup → Media storage.');
    }
    return { storageKey, mimeType, byteSize: file.buffer.length, url: productMediaUrl(storageKey) };
  }

  async upload(styleId: string, file: UploadedFile, options: { colourId?: string | null; altText?: string | null }, actorStaffId: string): Promise<ProductMedia> {
    await this.editableStyle(styleId);
    await this.checkColour(styleId, options.colourId);
    const stored = await this.storeFile(file);
    const last = await this.prisma.productMedia.aggregate({ where: { styleId }, _max: { sortOrder: true } });
    const media = await this.prisma.productMedia.create({
      data: {
        styleId,
        colourId: options.colourId || null,
        altText: options.altText?.trim() || null,
        type: 'IMAGE',
        sortOrder: (last._max.sortOrder ?? -1) + 1,
        ...stored,
      },
    });
    await recordAudit(this.prisma, {
      actorType: 'STAFF',
      actorStaffId,
      action: 'product_media.upload',
      entityType: 'ProductMedia',
      entityId: media.id,
      newValue: { mimeType: stored.mimeType, byteSize: stored.byteSize, colourId: media.colourId },
      reference: styleId,
    });
    return media;
  }

  /** Swaps the file behind an existing photo, keeping its colour, order, text and cover choice. */
  async replaceFile(mediaId: string, file: UploadedFile, actorStaffId: string): Promise<ProductMedia> {
    const media = await this.mediaOf(mediaId);
    if (media.type !== 'IMAGE') throw new ValidationError('Only photos can be replaced with an upload');
    const stored = await this.storeFile(file);
    const updated = await this.prisma.productMedia.update({ where: { id: mediaId }, data: stored });
    await recordAudit(this.prisma, {
      actorType: 'STAFF',
      actorStaffId,
      action: 'product_media.replace',
      entityType: 'ProductMedia',
      entityId: mediaId,
      oldValue: { url: media.url },
      newValue: { url: updated.url, mimeType: stored.mimeType, byteSize: stored.byteSize },
      reference: media.styleId,
    });
    return updated;
  }

  async update(mediaId: string, patch: { colourId?: string | null; altText?: string | null; isSwatch?: boolean }, actorStaffId: string) {
    const media = await this.mediaOf(mediaId);
    if (patch.colourId !== undefined) await this.checkColour(media.styleId, patch.colourId);
    const updated = await this.prisma.productMedia.update({
      where: { id: mediaId },
      data: {
        ...(patch.colourId !== undefined ? { colourId: patch.colourId || null } : {}),
        ...(patch.altText !== undefined ? { altText: patch.altText?.trim() || null } : {}),
        ...(patch.isSwatch !== undefined ? { isSwatch: patch.isSwatch } : {}),
      },
    });
    await recordAudit(this.prisma, {
      actorType: 'STAFF',
      actorStaffId,
      action: 'product_media.update',
      entityType: 'ProductMedia',
      entityId: mediaId,
      newValue: { changedFields: Object.keys(patch) },
      reference: media.styleId,
    });
    return updated;
  }

  /** Makes one photo the product's listing photo (one per product). */
  async setCover(mediaId: string, actorStaffId: string) {
    const media = await this.mediaOf(mediaId);
    if (media.type !== 'IMAGE') throw new ValidationError('Only a photo can be the listing photo');
    await this.prisma.$transaction(async (tx) => {
      // Lock the style row so two concurrent "make cover" clicks serialise
      // (the partial unique index would otherwise reject the loser with a 500).
      await tx.$queryRaw`SELECT id FROM styles WHERE id = ${media.styleId} FOR UPDATE`;
      await tx.productMedia.updateMany({ where: { styleId: media.styleId, isCover: true }, data: { isCover: false } });
      await tx.productMedia.update({ where: { id: mediaId }, data: { isCover: true } });
    });
    await recordAudit(this.prisma, { actorType: 'STAFF', actorStaffId, action: 'product_media.cover', entityType: 'ProductMedia', entityId: mediaId, reference: media.styleId });
    return this.prisma.productMedia.findUniqueOrThrow({ where: { id: mediaId } });
  }

  /** Sets the photo order; `orderedIds` must be exactly this product's photos. */
  async reorder(styleId: string, orderedIds: string[], actorStaffId: string) {
    await this.editableStyle(styleId);
    const existing = await this.prisma.productMedia.findMany({ where: { styleId }, select: { id: true } });
    const ids = new Set(existing.map((m) => m.id));
    if (orderedIds.length !== ids.size || new Set(orderedIds).size !== orderedIds.length || orderedIds.some((id) => !ids.has(id))) {
      throw new ValidationError('The new order must list every photo of this product exactly once. Reload and try again.');
    }
    await this.prisma.$transaction(orderedIds.map((id, index) => this.prisma.productMedia.update({ where: { id }, data: { sortOrder: index } })));
    await recordAudit(this.prisma, { actorType: 'STAFF', actorStaffId, action: 'product_media.reorder', entityType: 'Style', entityId: styleId, newValue: { count: orderedIds.length } });
    return this.prisma.productMedia.findMany({ where: { styleId }, orderBy: { sortOrder: 'asc' } });
  }

  /**
   * Removes a photo from the product. A published product must keep at
   * least one photo (the QA gate it was published under requires one):
   * upload the replacement first, or use Replace.
   */
  async remove(mediaId: string, actorStaffId: string) {
    const media = await this.mediaOf(mediaId);
    const style = await this.prisma.style.findUniqueOrThrow({ where: { id: media.styleId } });
    if (style.lifecycleState === 'PUBLISHED' && media.type === 'IMAGE') {
      const images = await this.prisma.productMedia.count({ where: { styleId: media.styleId, type: 'IMAGE' } });
      if (images <= 1) throw new ConflictError('A published product needs at least one photo. Add or replace a photo before removing this one.');
    }
    await this.prisma.productMedia.delete({ where: { id: mediaId } });
    await recordAudit(this.prisma, {
      actorType: 'STAFF',
      actorStaffId,
      action: 'product_media.remove',
      entityType: 'ProductMedia',
      entityId: mediaId,
      oldValue: { url: media.url, colourId: media.colourId },
      reference: media.styleId,
    });
  }

  /** Public bytes of a photo that a product still uses; 404 otherwise. */
  async readPublic(key: string): Promise<{ buffer: Buffer; mimeType: string }> {
    if (!PRODUCT_MEDIA_KEY.test(key)) throw new NotFoundError('ProductMedia', key);
    const media = await this.prisma.productMedia.findUnique({ where: { storageKey: key } });
    if (!media || !media.mimeType) throw new NotFoundError('ProductMedia', key);
    const object = await this.store.get(key);
    return { buffer: object.buffer, mimeType: media.mimeType };
  }

  /** Setup & health: a real write/read/delete against the configured store. */
  async probeStore(): Promise<{ kind: 'local' | 's3' }> {
    await this.store.probe();
    return { kind: this.store.kind };
  }
}
