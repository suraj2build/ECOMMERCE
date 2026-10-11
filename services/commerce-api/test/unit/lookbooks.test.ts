import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import multipart from '@fastify/multipart';
import sharp from 'sharp';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { __resetEnvCacheForTests } from '@fcp/config';
import { ForbiddenError, UnauthorizedError } from '@fcp/shared';
import routes, { LookbookService, lookbookSchema } from '../../src/modules/cms/lookbooks.js';
import errorHandler from '../../src/plugins/error-handler.js';

const styleId = '12345678-1234-4234-a234-123456789abc';
const colourId = '12345678-1234-4234-a234-123456789def';
const document = () =>
  lookbookSchema.parse({
    slug: 'test-book',
    department: 'women',
    title: 'Test book',
    intro: 'Original story',
    occasion: 'Everyday',
    model: 'Riya',
    cover: '/cover.webp',
    looks: [
      {
        title: 'Morning',
        caption: '',
        image: '/look.webp',
        alt: 'Riya wearing a top',
        items: [{ styleId, colourId }],
      },
    ],
  });

describe('Lookbook HTTP contracts (isolated repository fixture)', () => {
  let app: FastifyInstance;
  let records: Map<
    string,
    { id: string; key: string; content: string; isActive: boolean; title: string }
  >;
  let styles: {
    id: string;
    gender: string;
    department: string;
    lifecycleState: string;
    colours: { id: string; name: string }[];
    skus: { colourId: string; isActive: boolean }[];
  }[];
  let audit: unknown[];
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'lookbook-test-'));
    process.env.CMS_MEDIA_STORAGE_DIR = dir;
    process.env.CMS_MEDIA_STORAGE = 'local';
    __resetEnvCacheForTests();
    records = new Map();
    audit = [];
    styles = [
      {
        id: styleId,
        gender: 'women',
        department: 'women',
        lifecycleState: 'PUBLISHED',
        colours: [{ id: colourId, name: 'Pink' }],
        skus: [{ colourId, isActive: true }],
      },
    ];
    app = Fastify();
    const repository = {
      cmsContentBlock: {
        findUnique: async ({ where }: { where: { key: string } }) => records.get(where.key) ?? null,
        findMany: async () =>
          [...records.values()].filter((r) => r.key.startsWith('lookbook-document-')),
        upsert: async ({
          where,
          create,
          update,
        }: {
          where: { key: string };
          create: Record<string, unknown>;
          update: Record<string, unknown>;
        }) => {
          const row = {
            ...(records.get(where.key) ?? { ...create, id: 'saved-id' }),
            ...update,
          } as ReturnType<typeof records.get>;
          records.set(where.key, row!);
          return row;
        },
        create: async ({ data }: { data: Record<string, unknown> }) => {
          const r = { ...data, id: 'image-row' } as NonNullable<ReturnType<typeof records.get>>;
          records.set(r.key, r);
          return r;
        },
      },
      style: { findMany: async () => styles },
      auditLog: {
        create: async ({ data }: { data: unknown }) => {
          audit.push(data);
          return data;
        },
      },
      $executeRaw: async () => 0,
      $transaction: async <T>(run: (tx: unknown) => Promise<T>) => run(repository),
    };
    // These tests cover HTTP validation and projection; real Postgres locking is covered by the integration specification.
    app.decorate('prisma', repository);
    app.decorate('storefrontCache', { invalidateCatalog: async () => {} });
    app.decorate(
      'requireStaffAuth',
      async (req: { headers: { authorization?: string }; staffUser?: { id: string } }) => {
        if (!req.headers.authorization) throw new UnauthorizedError();
        req.staffUser = { id: 'actor' };
      },
    );
    app.decorate(
      'requirePermission',
      (permission: string) => async (req: { headers: { authorization?: string } }) => {
        if (req.headers.authorization === 'Bearer read-only' && permission === 'cms:manage')
          throw new ForbiddenError();
      },
    );
    await app.register(errorHandler);
    await app.register(multipart);
    await app.register(routes);
    await app.ready();
  });
  afterEach(async () => {
    await app.close();
    await rm(dir, { recursive: true, force: true });
    delete process.env.CMS_MEDIA_STORAGE_DIR;
    __resetEnvCacheForTests();
  });
  const headers = { authorization: 'Bearer editor' };
  function save(doc = document(), expectedRevision = 0, action = 'save') {
    return app.inject({
      method: 'POST',
      url: '/cms/lookbooks',
      headers,
      payload: { document: doc, expectedRevision, action },
    });
  }
  it('requires staff authentication and manage permission for writes', async () => {
    expect((await app.inject({ method: 'GET', url: '/cms/lookbooks' })).statusCode).toBe(401);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/cms/lookbooks',
          headers: { authorization: 'Bearer read-only' },
          payload: { document: document(), expectedRevision: 0, action: 'publish' },
        })
      ).statusCode,
    ).toBe(403);
  });
  it('keeps drafts private, preserves the first published snapshot during edits, then promotes on publish', async () => {
    expect((await save()).statusCode).toBe(200);
    expect((await app.inject('/storefront/lookbooks?department=women')).json().stories).toEqual([]);
    expect((await save(document(), 1, 'publish')).statusCode).toBe(200);
    const changed = { ...document(), title: 'Changed draft' };
    await save(changed, 2);
    expect(
      (await app.inject('/storefront/lookbooks?department=women')).json().stories[0].title,
    ).toBe('Test book');
    await save(changed, 3, 'publish');
    expect(
      (await app.inject('/storefront/lookbooks?department=women')).json().stories[0].title,
    ).toBe('Changed draft');
    expect(audit).toHaveLength(4);
  });
  it('rejects stale revisions without overwriting the current draft', async () => {
    await save();
    const retry = await save({ ...document(), title: 'Stale draft' });
    expect(retry.statusCode).toBe(409);
    expect((await new LookbookService(app).list())[0]!.draft.title).toBe('Test book');
  });
  it('requires mapped products on publish but allows an unmapped draft', async () => {
    const doc = document();
    doc.looks[0]!.items = [];
    expect((await save(doc)).statusCode).toBe(200);
    expect((await save(doc, 1, 'publish')).statusCode).toBe(400);
  });
  it('refuses colours belonging to another style or products in another department', async () => {
    const doc = document();
    doc.looks[0]!.items[0]!.colourId = '12345678-1234-4234-a234-000000000000';
    expect((await save(doc, 0, 'publish')).statusCode).toBe(400);
    styles[0]!.gender = 'men';
    expect((await save(document(), 0, 'publish')).statusCode).toBe(400);
  });
  it('refuses unpublished products and colours without active variants at publication', async () => {
    styles[0]!.lifecycleState = 'DRAFT';
    expect((await save(document(), 0, 'publish')).statusCode).toBe(400);
    styles[0]!.lifecycleState = 'PUBLISHED';
    styles[0]!.skus[0]!.isActive = false;
    expect((await save(document(), 0, 'publish')).statusCode).toBe(400);
  });
  it('unpublishes an edition even if a linked product was subsequently removed', async () => {
    await save(document(), 0, 'publish');
    styles = [];
    expect((await save(document(), 1, 'unpublish')).statusCode).toBe(200);
    expect((await app.inject('/storefront/lookbooks?department=women')).json().stories).toEqual([]);
  });
  it('does not hide an existing bundled edition when its first import is saved as a draft', async () => {
    await save({ ...document(), slug: 'city-days' });
    expect(
      (await app.inject('/storefront/lookbooks?department=women')).json().hiddenBuiltins,
    ).toEqual([]);
  });
  it('suppresses bundled defaults on unpublish and separates departments', async () => {
    const doc = { ...document(), slug: 'city-days' };
    await save(doc, 0, 'publish');
    expect((await app.inject('/storefront/lookbooks?department=men')).json().stories).toEqual([]);
    await save(doc, 1, 'unpublish');
    expect(
      (await app.inject('/storefront/lookbooks?department=women')).json().hiddenBuiltins,
    ).toEqual(['city-days']);
  });
  it('refuses a missing uploaded image before publication', async () => {
    expect((await save({ ...document(), cover: '/lookbook-media/' + styleId }, 0, 'publish')).statusCode).toBe(400);
  });
  it('rejects unsafe image paths and duplicate mapped pieces', async () => {
    for (const cover of ['javascript:alert(1)', '//host/x', '/\\evil/x', 'data:image/png;base64,x'])
      expect((await save({ ...document(), cover })).statusCode).toBe(400);
    const doc = document();
    doc.looks[0]!.items.push(doc.looks[0]!.items[0]!);
    expect((await save(doc)).statusCode).toBe(400);
  });
  function upload(buffer: Buffer) {
    const boundary = 'test-lookbook-boundary';
    return app.inject({
      method: 'POST',
      url: '/cms/lookbooks/images',
      headers: { ...headers, 'content-type': 'multipart/form-data; boundary=' + boundary },
      payload: Buffer.concat([
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="test.png"\r\nContent-Type: image/png\r\n\r\n`,
        ),
        buffer,
        Buffer.from(`\r\n--${boundary}--\r\n`),
      ]),
    });
  }
  it('decodes uploads, strips metadata, stores bytes and serves the public image', async () => {
    const image = await sharp({
      create: { width: 20, height: 30, channels: 3, background: '#abcdef' },
    })
      .withMetadata()
      .png()
      .toBuffer();
    const res = await upload(image);
    expect(res.statusCode).toBe(201);
    const id = res.json().path.split('/').at(-1);
    const served = await app.inject('/storefront/lookbooks/images/' + id);
    expect(served.statusCode).toBe(200);
    expect(served.headers['content-type']).toBe('image/webp');
    const meta = await sharp(served.rawPayload).metadata();
    expect(meta.exif).toBeUndefined();
    expect(meta.width).toBe(20);
    expect(audit).toHaveLength(1);
  });
  it('refuses executables, corrupt PNGs, oversized uploads and missing image IDs', async () => {
    expect((await upload(Buffer.from('not an image'))).statusCode).toBe(400);
    expect((await upload(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]))).statusCode).toBe(400);
    expect((await upload(Buffer.alloc(5 * 1024 * 1024 + 1))).statusCode).toBe(413);
    expect((await app.inject('/storefront/lookbooks/images/' + styleId)).statusCode).toBe(404);
  });
});
