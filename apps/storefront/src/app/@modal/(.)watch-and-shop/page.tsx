/**
 * Intercepts a client-side (soft) navigation to /watch-and-shop from
 * elsewhere on the site, rendering the reel as a modal over the current page
 * instead of a full page navigation (specs/35-watch-and-shop.md's 2026-10-17
 * addendum). A direct load, hard refresh, or shared link to this same URL
 * never reaches this file - Next.js only engages an intercepting route for
 * in-app navigation - and renders the real app/watch-and-shop/page.tsx
 * instead, unchanged, so deep-linking and SEO are unaffected.
 */
import { getWatchAndShopFeed } from '@/lib/api';
import { ReelModal } from '@/vanya/views/ReelModal';

export default async function InterceptedWatchAndShop({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const reel = (await searchParams).reel;
  const items = await getWatchAndShopFeed();
  return <ReelModal feed={items} initialReelId={typeof reel === 'string' ? reel : undefined} />;
}
