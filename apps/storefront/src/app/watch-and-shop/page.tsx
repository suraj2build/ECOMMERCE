export const dynamic = 'force-dynamic';

import type { Metadata } from 'next';
import { getWatchAndShopFeed } from '@/lib/api';
import { absoluteUrl, sharing } from '@/lib/seo';

const DESCRIPTION = 'Shop the looks from VANYA lookbooks and styling stories.';

export const metadata: Metadata = {
  title: 'Watch & Shop',
  description: DESCRIPTION,
  alternates: { canonical: absoluteUrl('/watch-and-shop') },
  ...sharing('Watch & Shop | VANYA', DESCRIPTION, '/watch-and-shop'),
};
import { ReelsView } from '@/vanya/views/ReelsView';

export default async function WatchAndShopPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const reel = (await searchParams).reel;
  const items = await getWatchAndShopFeed();
  return <ReelsView feed={items} initialReelId={typeof reel === 'string' ? reel : undefined} />;
}
