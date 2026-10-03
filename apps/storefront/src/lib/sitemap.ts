/**
 * Sitemap index and files (LR-002). Every storefront-visible product is
 * listed (no row cap), split into files of at most 10,000 URLs so no file
 * nears the protocol's 50,000-URL limit; categories with visible products,
 * published collections and the static public pages are listed too. Reads
 * are uncached so a just-published product appears at once.
 */
import { SITE_URL } from './api';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
export const PRODUCTS_PER_FILE = 10_000;

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`commerce-api request failed: GET ${path} -> ${res.status}`);
  return res.json() as Promise<T>;
}

export interface SitemapEntry { loc: string; lastmod?: string | null }

const escapeXml = (value: string) => value.replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]!));

export function urlset(entries: SitemapEntry[]): string {
  const body = entries.map((e) => `<url><loc>${escapeXml(e.loc)}</loc>${e.lastmod ? `<lastmod>${new Date(e.lastmod).toISOString()}</lastmod>` : ''}</url>`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${body}</urlset>`;
}

export function sitemapIndex(files: string[]): string {
  const body = files.map((file) => `<sitemap><loc>${escapeXml(`${SITE_URL}/sitemaps/${file}`)}</loc></sitemap>`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${body}</sitemapindex>`;
}

export async function productPage(skip: number, take = PRODUCTS_PER_FILE) {
  return getJson<{ total: number; items: { id: string; lastModified: string | null }[] }>(`/api/v1/storefront/seo/products?take=${take}&skip=${skip}`);
}

export async function sitemapFiles(): Promise<string[]> {
  const { total } = await productPage(0, 1);
  const productFiles = Math.max(1, Math.ceil(total / PRODUCTS_PER_FILE));
  return ['pages.xml', 'categories.xml', 'collections.xml', ...Array.from({ length: productFiles }, (_, i) => `products-${i}.xml`)];
}

export async function sitemapFile(file: string): Promise<SitemapEntry[] | null> {
  if (file === 'pages.xml') {
    const legal: SitemapEntry[] = [];
    for (const kind of ['privacy', 'terms']) {
      // Only approved, published legal text is listed (LR-001).
      const res = await fetch(`${API_URL}/api/v1/storefront/cms/landing-pages/legal-${kind}`, { cache: 'no-store' });
      if (res.ok) legal.push({ loc: `${SITE_URL}/legal/${kind}` });
    }
    return [{ loc: SITE_URL }, { loc: `${SITE_URL}/collections` }, { loc: `${SITE_URL}/watch-and-shop` }, { loc: `${SITE_URL}/category/women` }, { loc: `${SITE_URL}/category/men` }, { loc: `${SITE_URL}/category/new` }, ...legal];
  }
  if (file === 'categories.xml') {
    const categories = await getJson<{ slug: string; lastPublishedAt: string | null }[]>('/api/v1/storefront/seo/categories');
    return categories.map((c) => ({ loc: `${SITE_URL}/category/${c.slug}`, lastmod: c.lastPublishedAt }));
  }
  if (file === 'collections.xml') {
    const entries: SitemapEntry[] = [];
    for (let skip = 0; ; skip += 60) {
      const page = await getJson<{ slug: string }[]>(`/api/v1/storefront/collections?take=60&skip=${skip}`);
      entries.push(...page.map((c) => ({ loc: `${SITE_URL}/collections/${c.slug}` })));
      if (page.length < 60) break;
    }
    return entries;
  }
  const match = /^products-(\d+)\.xml$/.exec(file);
  if (!match || String(Number(match[1])) !== match[1]) return null;
  const index = Number(match[1]);
  const { total, items } = await productPage(index * PRODUCTS_PER_FILE);
  // Only files the index lists exist; products-0.xml always does.
  if (index > 0 && index * PRODUCTS_PER_FILE >= total) return null;
  return items.map((item) => ({ loc: `${SITE_URL}/product/${item.id}`, lastmod: item.lastModified }));
}
