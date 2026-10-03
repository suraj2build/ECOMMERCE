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
import { VanyaWatchAndShop } from '@/components/watch-and-shop/VanyaWatchAndShop';

export default async function WatchAndShopPage() {
  const items = await getWatchAndShopFeed();
  return <VanyaWatchAndShop items={items} />;
}
