// Isolated UI-test fixture. Never use as a commerce-api implementation.
import http from 'node:http';
import { readFileSync } from 'node:fs';
const style = '12345678-1234-1234-1234-123456789abc',
  colour = '12345678-1234-1234-1234-123456789def';
const doc = JSON.parse(
  readFileSync(
    new URL('../../docs/lookbook/content/lookbook-women-city-days.json', import.meta.url),
  ),
);
doc.looks[0].items = [{ styleId: style, colourId: colour }];
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
      additions = [];
      return send({ ok: true });
    }
    if (path === '/_test/sold-out') {
      soldOut = true;
      return send({ ok: true });
    }
    if (path === '/_test/additions') return send(additions);
    if (path === '/api/v1/storefront/cms/landing-pages/lookbook-women-city-days')
      return send({
        slug: 'lookbook-women-city-days',
        title: 'City days',
        blocks: [
          { key: 'lookbook-women-city-days', title: 'City days', content: JSON.stringify(doc) },
        ],
      });
    if (path.includes('/cms/landing-pages/')) return send({}, 404);
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
