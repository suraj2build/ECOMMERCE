import { getWatchAndShopFeed, type ShoppableMediaSummary } from '@/lib/api';
import { VanyaWatchAndShop } from '@/components/watch-and-shop/VanyaWatchAndShop';

export default async function WatchAndShopPage() {
  let items: ShoppableMediaSummary[] = [];
  try {
    items = await getWatchAndShopFeed();
  } catch {
    items = [];
  }
  return <VanyaWatchAndShop items={items} />;
}
