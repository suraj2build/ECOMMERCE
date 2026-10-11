import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { templateSources } from './lookbook-templates.js';
import sharp from 'sharp';
import { randomUUID } from 'node:crypto';
import { loadEnv, mockProvidersAllowed } from '@fcp/config';
import { ConflictError, NotFoundError, ValidationError } from '@fcp/shared';
import { recordAudit } from '../audit/service.js';
import { purgeCatalogAfter } from '../pdp/storefront-cache.js';
import {
  LocalDiskEvidenceStorageProvider,
  S3EvidenceStorageProvider,
  sniffImageMimeType,
} from '../returns/evidence-storage.js';

const mediaUrl = z
  .string()
  .trim()
  .min(1)
  .max(2000)
  .refine((v) => {
    if (/^\/(?!\/)/.test(v)) return !v.includes('\\') && ![...v].some((c) => c.charCodeAt(0) <= 32);
    try {
      const u = new URL(v);
      return u.protocol === 'https:' && !u.username && !u.password;
    } catch {
      return false;
    }
  }, 'Use a site image path or HTTPS image URL');
const text = (max: number) => z.string().trim().min(1).max(max);
export const lookbookSchema = z
  .object({
    slug: text(100).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    department: z.enum(['women', 'men']),
    title: text(200),
    intro: z.string().trim().max(3000),
    occasion: text(100),
    model: text(100),
    cover: mediaUrl,
    presentation: z.enum(['story', 'book']).default('story'),
    showOnHome: z.boolean().default(true),
    sortOrder: z.number().int().min(0).max(10000).default(0),
    looks: z
      .array(
        z
          .object({
            title: text(200),
            model: z.string().trim().max(100).optional(),
            caption: z.string().trim().max(3000),
            image: mediaUrl,
            alt: text(400),
            items: z
              .array(z.object({ styleId: z.string().uuid(), colourId: z.string().uuid() }).strict())
              .max(8)
              .refine(
                (items) => new Set(items.map((i) => i.styleId + i.colourId)).size === items.length,
                'A product colour can only be linked once per look',
              ),
          })
          .strict(),
      )
      .min(1)
      .max(50),
  })
  .strict();
type Document = z.infer<typeof lookbookSchema>;
const prefix = 'lookbook-document-';
const keyFor = (department: string, slug: string) => prefix + department + '-' + slug;
interface RecordContent {
  version: 1;
  revision: number;
  draft: Document;
  published: Document | null;
}
function decode(content: string): RecordContent {
  const value = JSON.parse(content) as RecordContent;
  if (value.version !== 1 || !Number.isInteger(value.revision))
    throw new ValidationError('Unsupported lookbook record');
  return {
    ...value,
    draft: lookbookSchema.parse(value.draft),
    published: value.published ? lookbookSchema.parse(value.published) : null,
  };
}
function storage() {
  const env = loadEnv();
  if (env.CMS_MEDIA_STORAGE === 's3')
    return new S3EvidenceStorageProvider({
      ...env,
      RETURN_EVIDENCE_S3_BUCKET: env.S3_BUCKET,
      RETURN_EVIDENCE_S3_PREFIX: 'lookbook-media/',
    });
  if (!mockProvidersAllowed(env))
    throw new ValidationError(
      'Set CMS_MEDIA_STORAGE=s3 before uploading production lookbook images',
    );
  return new LocalDiskEvidenceStorageProvider(env.CMS_MEDIA_STORAGE_DIR);
}
export class LookbookService {
  constructor(private readonly app: FastifyInstance) {}
  async list() {
    const blocks = await this.app.prisma.cmsContentBlock.findMany({
      where: { key: { startsWith: prefix } },
      orderBy: { key: 'asc' },
    });
    return blocks.map((b) => ({ id: b.id, ...decode(b.content), isPublished: b.isActive }));
  }
  async publicList(department: Document['department']) {
    const records = await this.list();
    return {
      stories: records
        .filter((r) => r.isPublished && r.published?.department === department)
        .map((r) => r.published!)
        .sort((a, b) => a.sortOrder - b.sortOrder),
      // Only reserved bundled handles are exposed to suppress their fallback after unpublish.
      hiddenBuiltins: records
        .filter(
          (r) =>
            !r.isPublished &&
            r.published !== null &&
            r.draft.department === department &&
            [
              'city-days',
              'after-the-light',
              'the-working-week',
              'off-the-clock',
              'a-city-three-moods',
            ].includes(r.draft.slug),
        )
        .map((r) => r.draft.slug),
    };
  }
  async validateProducts(doc: Document, publishing: boolean) {
    if (publishing) {
      for (const image of new Set([doc.cover, ...doc.looks.map((l) => l.image)])) {
        if (!image.startsWith('/lookbook-media/')) continue;
        const id = image.slice('/lookbook-media/'.length);
        if (!z.string().uuid().safeParse(id).success || !await this.app.prisma.cmsContentBlock.findUnique({ where: { key: 'lookbook-asset-' + id } })) throw new ValidationError('A selected upload no longer exists. Upload that image again before publishing.');
      }
    }
    const styles = await this.app.prisma.style.findMany({
      where: { id: { in: [...new Set(doc.looks.flatMap((l) => l.items.map((i) => i.styleId)))] } },
      include: { colours: true, skus: true },
    });
    for (const [n, look] of doc.looks.entries()) {
      if (publishing && !look.items.length)
        throw new ValidationError(
          `Look ${n + 1}: link at least one exact pictured product and colour before publishing`,
        );
      for (const item of look.items) {
        const style = styles.find((s) => s.id === item.styleId);
        if (
          !style ||
          (style.gender ?? style.department ?? '').toLowerCase() !== doc.department ||
          !style.colours.some((c) => c.id === item.colourId)
        )
          throw new ValidationError(
            `Look ${n + 1}: product and colour must belong to this department and to each other`,
          );
        if (
          publishing &&
          (style.lifecycleState !== 'PUBLISHED' ||
            !style.skus.some((s) => s.colourId === item.colourId && s.isActive))
        )
          throw new ValidationError(
            `Look ${n + 1}: publish the product and create its active colour/size variants first`,
          );
      }
    }
  }
  async save(
    doc: Document,
    expectedRevision: number,
    action: 'save' | 'publish' | 'unpublish',
    actorStaffId: string,
  ) {
    // One lock per stable handle serializes creation and edits, including two editors opening an unsaved handle.
    return this.app.prisma.$transaction(async (tx) => {
      const key = keyFor(doc.department, doc.slug);
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
      const old = await tx.cmsContentBlock.findUnique({ where: { key } });
      const previous = old ? decode(old.content) : null;
      if ((previous?.revision ?? 0) !== expectedRevision)
        throw new ConflictError(
          'This lookbook changed in another window. Reload it before saving.',
        );
      if (action !== 'unpublish') await this.validateProducts(doc, action === 'publish');
      const content: RecordContent = {
        version: 1,
        revision: expectedRevision + 1,
        draft: doc,
        published: action === 'publish' ? doc : (previous?.published ?? null),
      };
      const isActive =
        action === 'publish' ? true : action === 'unpublish' ? false : (old?.isActive ?? false);
      const block = await tx.cmsContentBlock.upsert({
        where: { key },
        create: {
          key,
          title: doc.title,
          content: JSON.stringify(content),
          isActive,
          createdByStaffId: actorStaffId,
        },
        update: { title: doc.title, content: JSON.stringify(content), isActive },
      });
      await recordAudit(tx, {
        actorType: 'STAFF',
        actorStaffId,
        action: 'cms.lookbook.' + action,
        entityType: 'CmsContentBlock',
        entityId: block.id,
        newValue: { slug: doc.slug, department: doc.department, revision: content.revision },
      });
      return { id: block.id, ...content, isPublished: isActive };
    });
  }
}
const routes: FastifyPluginAsync = async (app) => {
  const service = new LookbookService(app);
  const read = [app.requireStaffAuth, app.requirePermission('cms:read')];
  const manage = [app.requireStaffAuth, app.requirePermission('cms:manage')];
  const after = purgeCatalogAfter(app);
  app.get('/cms/lookbooks', { preHandler: read }, async () => service.list());
  app.get('/cms/lookbooks/templates', { preHandler: read }, async () => {
    const codes = [
      ...new Set(
        templateSources.flatMap((t) => t.looks.flatMap((l) => l.products.map((p) => p.styleCode))),
      ),
    ];
    const styles = await app.prisma.style.findMany({
      where: { styleCode: { in: codes }, lifecycleState: 'PUBLISHED' },
      include: { colours: true },
    });
    return templateSources.map((template) => {
      const missing: string[] = [];
      const looks = template.looks.map(({ products, ...look }) => ({
        ...look,
        items: products.flatMap((p) => {
          const style = styles.find(
            (s) =>
              s.styleCode === p.styleCode &&
              (s.gender ?? s.department ?? '').toLowerCase() === template.department,
          );
          const colours = style?.colours.filter((c) => c.name === p.colourName) ?? [];
          if (!style || colours.length !== 1) {
            missing.push(p.styleCode + ' / ' + p.colourName);
            return [];
          }
          return [{ styleId: style.id, colourId: colours[0]!.id }];
        }),
      }));
      return { document: { ...template, looks }, missing };
    });
  });
  app.post('/cms/lookbooks', { preHandler: manage }, async (req) => {
    const input = z
      .object({
        document: lookbookSchema,
        expectedRevision: z.number().int().nonnegative(),
        action: z.enum(['save', 'publish', 'unpublish']),
      })
      .strict()
      .parse(req.body);
    return after(
      service.save(input.document, input.expectedRevision, input.action, req.staffUser!.id),
    );
  });
  app.post('/cms/lookbooks/products/linked', { preHandler: read }, async (req) => {
    const { ids } = z.object({ ids: z.array(z.string().uuid()).max(400) }).parse(req.body);
    return app.prisma.style.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        name: true,
        styleCode: true,
        colours: { select: { id: true, name: true } },
      },
    });
  });
  app.get('/cms/lookbooks/products', { preHandler: read }, async (req) => {
    const query = z
      .object({
        department: z.enum(['women', 'men']),
        q: z.string().max(200).default(''),
        skip: z.coerce.number().int().nonnegative().default(0),
      })
      .parse(req.query);
    const where = {
      lifecycleState: 'PUBLISHED' as const,
      AND: [
        {
          OR: [
            { gender: { equals: query.department, mode: 'insensitive' as const } },
            {
              gender: null,
              department: { equals: query.department, mode: 'insensitive' as const },
            },
          ],
        },
        {
          OR: [
            { name: { contains: query.q, mode: 'insensitive' as const } },
            { styleCode: { contains: query.q, mode: 'insensitive' as const } },
          ],
        },
      ],
    };
    const [items, total] = await Promise.all([
      app.prisma.style.findMany({
        where,
        include: { colours: true },
        orderBy: { styleCode: 'asc' },
        take: 30,
        skip: query.skip,
      }),
      app.prisma.style.count({ where }),
    ]);
    return { items, total };
  });
  app.get('/storefront/lookbooks', async (req) => {
    const { department } = z.object({ department: z.enum(['women', 'men']) }).parse(req.query);
    return service.publicList(department);
  });
  app.post('/cms/lookbooks/images', { preHandler: manage }, async (req, reply) => {
    const file = await req.file({ limits: { fileSize: 5 * 1024 * 1024, files: 1 } });
    if (!file) throw new ValidationError('Choose a JPEG, PNG or WebP image');
    const original = await file.toBuffer();
    if (!sniffImageMimeType(original))
      throw new ValidationError('Only JPEG, PNG and WebP images are accepted');
    let buffer: Buffer;
    try {
      // Decode completely; reject corrupt bytes, huge canvases and animation. Re-encoding removes camera/GPS metadata.
      const image = sharp(original, { limitInputPixels: 40_000_000, failOn: 'warning' });
      const meta = await image.metadata();
      if ((meta.pages ?? 1) !== 1) throw new Error('Animated images are not supported');
      buffer = await image
        .rotate()
        .resize({ width: 2400, height: 3000, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 94 })
        .toBuffer();
    } catch {
      throw new ValidationError(
        'This image cannot be decoded. Use a non-animated JPEG, PNG or WebP under 40 megapixels.',
      );
    }
    const id = randomUUID();
    await storage().putObject(id, buffer, 'image/webp');
    const block = await app.prisma.cmsContentBlock.create({
      data: {
        key: 'lookbook-asset-' + id,
        title: 'Lookbook image',
        content: JSON.stringify({ kind: 'lookbook-image', id }),
        isActive: false,
        createdByStaffId: req.staffUser!.id,
      },
    });
    await recordAudit(app.prisma, {
      actorType: 'STAFF',
      actorStaffId: req.staffUser!.id,
      action: 'cms.lookbook.image_upload',
      entityType: 'CmsContentBlock',
      entityId: block.id,
      newValue: { id, bytes: buffer.length },
    });
    return reply.status(201).send({ path: '/lookbook-media/' + id });
  });
  app.get('/storefront/lookbooks/images/:id', async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const meta = await app.prisma.cmsContentBlock.findUnique({
      where: { key: 'lookbook-asset-' + id },
    });
    if (!meta) throw new NotFoundError('Lookbook image');
    const { buffer } = await storage().getObject(id);
    return reply
      .header('Cache-Control', 'public, max-age=31536000, immutable')
      .header('X-Content-Type-Options', 'nosniff')
      .type('image/webp')
      .send(buffer);
  });
};
export default routes;
