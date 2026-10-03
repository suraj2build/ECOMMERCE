import { expect, type APIRequestContext } from '@playwright/test';

/**
 * Reads the whole sitemap the way a crawler does (LR-002): /sitemap.xml is an
 * index; every file it lists must answer 200 with a urlset. Returns the index
 * body and every <loc> from every listed file.
 */
export async function crawlSitemap(request: APIRequestContext, storefrontUrl: string) {
  const index = await request.get(`${storefrontUrl}/sitemap.xml`);
  expect(index.ok()).toBe(true);
  expect(index.headers()['content-type']).toContain('xml');
  const indexXml = await index.text();
  expect(indexXml).toContain('<sitemapindex');
  const files = [...indexXml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]!);
  expect(files.length).toBeGreaterThan(0);
  const locs: string[] = [];
  for (const file of files) {
    expect(file.startsWith(`${storefrontUrl}/sitemaps/`)).toBe(true);
    const res = await request.get(file);
    expect(res.ok(), `${file} -> ${res.status()}`).toBe(true);
    const xml = await res.text();
    expect(xml).toContain('<urlset');
    locs.push(...[...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]!));
  }
  return { indexXml, files, locs };
}
