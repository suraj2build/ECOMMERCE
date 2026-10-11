// Isolated UI-test fixture. Never use as a commerce-api implementation.
import http from 'node:http';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
const style = '12345678-1234-1234-1234-123456789abc',
  colour = '12345678-1234-1234-1234-123456789def';
const doc = JSON.parse(
  readFileSync(
    new URL('../../docs/lookbook/content/lookbook-women-city-days.json', import.meta.url),
  ),
);
doc.looks[0].items = [{ styleId: style, colourId: colour }];
const issue = JSON.parse(
  readFileSync(
    new URL('../../apps/storefront/src/content/lookbook-issue-01.json', import.meta.url),
  ),
);
const uid = (text) => {
  const h = createHash('sha256').update(text).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
};
const bookProducts = new Map();
for (const reference of issue.looks.flatMap((l) => l.products)) {
  const id = uid(reference.styleCode);
  if (!bookProducts.has(id))
    bookProducts.set(id, {
      id,
      styleCode: reference.styleCode,
      name: reference.title,
      gender: 'women',
      department: 'women',
      currency: 'INR',
      sellingPrice: 1290,
      mrp: 1290,
      brandName: 'Preview catalogue',
      categoryName: 'Women',
      categorySlug: 'women',
      isMarkdown: false,
      media: [{ id: uid(reference.styleCode + reference.colourName + '-front'), url: 'http://127.0.0.1:3000' + reference.front, type: 'IMAGE', colourId: uid(reference.styleCode + reference.colourName), sortOrder: 0 }],
      badges: [],
      sizeChart: null,
      ratingSummary: { averageRating: null, reviewCount: 0 },
      reviews: [],
      reviewsTotal: 0,
      crossSell: [],
      publishedAt: '2026-10-11T00:00:00.000Z',
      variants: [],
    });
  const product = bookProducts.get(id);
  if (!product.variants.some((v) => v.colourName === reference.colourName)) {
    product.variants.push({
      skuId: 'book-' + reference.catalogueId + '-' + reference.colourName + '-small',
      colourId: uid(reference.styleCode + reference.colourName),
      colourName: reference.colourName,
      sizeId: 'small',
      sizeLabel: 'S',
      inStock: true,
      availableQuantity: 2,
    });
    product.variants.push({
      skuId: 'book-' + reference.catalogueId + '-' + reference.colourName + '-medium',
      colourId: uid(reference.styleCode + reference.colourName),
      colourName: reference.colourName,
      sizeId: 'medium',
      sizeLabel: 'M',
      inStock: false,
      availableQuantity: 0,
    });
  }
}
let managed = [], uploads = 0;
async function purge() { await fetch('http://127.0.0.1:3000/api/revalidate/catalog', { method: 'POST', headers: { authorization: 'Bearer lookbook-fixture-only' } }).catch(() => {}); }
let soldOut = false,
  additions = [];
http
  .createServer(async (req, res) => {
    const path = new URL(req.url, 'http://localhost').pathname;
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'content-type,x-guest-session-id,authorization');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Content-Type', 'application/json');
    const send = (value, status = 200) => {
      res.statusCode = status;
      res.end(JSON.stringify(value));
    };
    if (req.method === 'OPTIONS') {
      res.end();
      return;
    }
    if (path === '/_test/reset') {
      soldOut = false;
      additions = []; managed = []; uploads = 0; await purge();
      return send({ ok: true });
    }
    if (path === '/_test/sold-out') {
      soldOut = true;
      return send({ ok: true });
    }
    if (path === '/_test/additions') return send(additions);
    if (path === '/_test/uploads') return send({ uploads });
    if (path === '/api/v1/cms/lookbooks/templates') return send([{ document: {
      slug: issue.slug, department: 'women', title: issue.title, intro: issue.intro, occasion: 'A day in the city', model: 'Riya, Deeksha & Heena', cover: issue.cover, presentation: 'book', showOnHome: true, sortOrder: 0,
      looks: issue.looks.map((l) => ({ title: l.title, model: l.model, caption: l.caption, image: l.image, alt: l.alt, items: l.products.map((p) => ({ styleId: uid(p.styleCode), colourId: uid(p.styleCode + p.colourName) })) })),
    }, missing: [] }]);
    if (path === '/api/v1/cms/lookbooks/images') {
      if (!(req.headers['content-type'] || '').startsWith('multipart/form-data;')) return send({ error: { message: 'Expected multipart upload' } }, 400);
      for await (const _chunk of req) { /* consume the browser's actual multipart upload */ }
      uploads++;
      return send({ path: '/lookbook-media/12345678-1234-4234-a234-000000000001' }, 201);
    }
    if (path === '/api/v1/storefront/lookbooks/images/12345678-1234-4234-a234-000000000001') {
      res.setHeader('Content-Type', 'image/webp');
      res.end(readFileSync(new URL('../../apps/storefront/public/campaigns/issue-01/look-01.webp', import.meta.url))); return;
    }
    if (path === '/api/v1/cms/lookbooks/products/linked') {
      let raw = ''; for await (const chunk of req) raw += chunk;
      const ids = JSON.parse(raw).ids;
      return send([...bookProducts.values()].filter((p) => ids.includes(p.id)).map((p) => ({ ...p, colours: p.variants.filter((v) => v.sizeId === 'small').map((v) => ({ id: v.colourId, name: v.colourName })) })));
    }
    if (path === '/api/v1/cms/lookbooks/products') {
      const params = new URL(req.url, 'http://localhost').searchParams;
      const q = (params.get('q') || '').toLowerCase(), skip = Number(params.get('skip') || 0);
      const matches = [...bookProducts.values()].filter((p) => p.gender === params.get('department') && (p.styleCode.toLowerCase().includes(q) || p.name.toLowerCase().includes(q)));
      return send({ items: matches.slice(skip, skip + 30).map((p) => ({ ...p, colours: p.variants.filter((v) => v.sizeId === 'small').map((v) => ({ id: v.colourId, name: v.colourName })) })), total: matches.length });
    }
    if (path === '/api/v1/cms/lookbooks') {
      if (req.method === 'GET') return send(managed);
      let raw = ''; for await (const chunk of req) raw += chunk;
      const body = JSON.parse(raw), old = managed.find((r) => r.draft.slug === body.document.slug && r.draft.department === body.document.department);
      if ((old?.revision || 0) !== body.expectedRevision) return send({ error: { message: 'This lookbook changed in another window. Reload it before saving.' } }, 409);
      if (body.action === 'publish' && body.document.looks.some((l) => !l.items.length)) return send({ error: { message: 'Link every look before publishing.' } }, 400);
      const row = { id: old?.id || 'fixture-lookbook', revision: body.expectedRevision + 1, draft: body.document, published: body.action === 'publish' ? body.document : old?.published || null, isPublished: body.action === 'publish' ? true : body.action === 'unpublish' ? false : old?.isPublished || false };
      managed = managed.filter((r) => r.id !== row.id).concat(row); await purge(); return send(row);
    }
    if (path === '/api/v1/storefront/lookbooks') {
      const department = new URL(req.url, 'http://localhost').searchParams.get('department');
      return send({ stories: managed.filter((r) => r.isPublished && r.published.department === department).map((r) => r.published), hiddenBuiltins: managed.filter((r) => !r.isPublished && r.published !== null && r.draft.department === department && ['city-days', 'after-the-light', 'the-working-week', 'off-the-clock', 'a-city-three-moods'].includes(r.draft.slug)).map((r) => r.draft.slug) });
    }
    if (path === '/api/v1/storefront/search') return send({ hits: [], total: 0, query: '', page: 1, totalPages: 0, facets: {} });

    if (path === '/api/v1/storefront/cms/landing-pages/lookbook-women-city-days')
      return send({
        slug: 'lookbook-women-city-days',
        title: 'City days',
        blocks: [
          { key: 'lookbook-women-city-days', title: 'City days', content: JSON.stringify(doc) },
        ],
      });
    if (path.includes('/cms/landing-pages/')) return send({}, 404);
    if (path === '/api/v1/storefront/styles') {
      const query = new URL(req.url, 'http://localhost').searchParams;
      const skip = Number(query.get('skip') || 0),
        take = Number(query.get('take') || 12);
      return send([...bookProducts.values()].slice(skip, skip + take));
    }
    const bookProduct = bookProducts.get(path.split('/').at(-1));
    if (path.startsWith('/api/v1/storefront/products/') && bookProduct)
      return send({
        ...bookProduct,
        variants: bookProduct.variants.map((v) => ({
          ...v,
          inStock: !soldOut && v.inStock,
          availableQuantity: soldOut ? 0 : v.availableQuantity,
        })),
      });
    if (path === '/api/v1/storefront/products/' + style)
      return send({
        id: style,
        name: 'Fixture pictured yellow tee',
        gender: 'women',
        department: 'women',
        currency: 'INR',
        sellingPrice: 1290,
        mrp: 1290,
        styleCode: 'FIXTURE-YELLOW',
        brandName: 'Test catalogue',
        categoryName: 'Tops',
        categorySlug: 'tops',
        isMarkdown: false,
        media: [],
        badges: [],
        sizeChart: null,
        ratingSummary: { averageRating: null, reviewCount: 0 },
        reviews: [],
        reviewsTotal: 0,
        crossSell: [],
        publishedAt: '2026-10-11T00:00:00.000Z',
        variants: [
          {
            skuId: 'wrong-colour',
            colourId: '12345678-1234-1234-1234-000000000000',
            colourName: 'Blue',
            sizeId: 'small',
            sizeLabel: 'S',
            inStock: true,
            availableQuantity: 9,
          },
          {
            skuId: 'exact-yellow-small',
            colourId: colour,
            colourName: 'Yellow',
            sizeId: 'small',
            sizeLabel: 'S',
            inStock: !soldOut,
            availableQuantity: soldOut ? 0 : 2,
          },
          {
            skuId: 'exact-yellow-medium',
            colourId: colour,
            colourName: 'Yellow',
            sizeId: 'medium',
            sizeLabel: 'M',
            inStock: false,
            availableQuantity: 0,
          },
        ],
      });
    const cart = {
      id: 'fixture-bag',
      items: [],
      itemCount: additions.length,
      subtotal: 0,
      hasBlockingChanges: false,
    };
    if (path === '/api/v1/storefront/cart/items' && req.method === 'POST') {
      let raw = '';
      for await (const chunk of req) raw += chunk;
      additions.push(JSON.parse(raw));
      return send(cart);
    }
    if (path === '/api/v1/storefront/cart') return send(cart);
    if (path === '/api/v1/storefront/wishlist') return send([]);
    if (path === '/api/v1/storefront/guest-session')
      return send({
        guestSessionId: `gs1.test.${Math.floor(Date.now() / 1000)}.${Math.floor(Date.now() / 1000) + 86400}.fixture`,
      });
    if (
      path === '/api/v1/storefront/categories' ||
      path.includes('/cms/banners') ||
      path.includes('/watch-and-shop')
    )
      return send([]);
    if (path.includes('/cms/navigation-menus/')) return send({ items: [] });
    if (path === '/api/v1/storefront/policies')
      return send({
        shipping: { flatAmount: 0, freeAboveAmount: 0, currency: 'INR', confirmed: false },
        returns: { defaultWindowDays: 7 },
      });
    send({}, 404);
  })
  .listen(4000, '127.0.0.1');
