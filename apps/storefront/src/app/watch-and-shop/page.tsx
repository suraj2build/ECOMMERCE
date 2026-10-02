export const dynamic = 'force-dynamic';

import { getWatchAndShopFeed } from '@/lib/api';
import { VanyaWatchAndShop } from '@/components/watch-and-shop/VanyaWatchAndShop';

export default async function WatchAndShopPage() {
  const items = await getWatchAndShopFeed();
  return <VanyaWatchAndShop items={items} />;
}
