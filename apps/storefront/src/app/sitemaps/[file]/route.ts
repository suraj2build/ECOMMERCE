import { sitemapFile, urlset } from '@/lib/sitemap';

export const dynamic = 'force-dynamic';

export async function GET(_request: Request, { params }: { params: Promise<{ file: string }> }): Promise<Response> {
  const { file } = await params;
  const entries = await sitemapFile(file);
  if (!entries) return new Response('Not found', { status: 404 });
  return new Response(urlset(entries), { headers: { 'content-type': 'application/xml; charset=utf-8' } });
}
