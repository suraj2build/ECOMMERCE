import { getPublicCollections, getPublicStyles, getWatchAndShopFeed } from '@/lib/api';
import { VanyaGateway } from '@/components/home/VanyaGateway';
import { Hero } from '@/components/home/Hero';
import { ShopByCategory } from '@/components/home/ShopByCategory';
import { ProductGrid } from '@/components/home/ProductGrid';
import { CollectionsStrip } from '@/components/home/CollectionsStrip';
import { WatchAndShop } from '@/components/home/WatchAndShop';
import { TrustPromises } from '@/components/home/TrustPromises';

async function safeFetch<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch {
    return fallback;
  }
}

export default async function HomePage() {
  const [styles, collections, watchAndShop] = await Promise.all([
    safeFetch(() => getPublicStyles(12), []),
    safeFetch(() => getPublicCollections(), []),
    safeFetch(() => getWatchAndShopFeed(), []),
  ]);

  return (
    <>
      <VanyaGateway />
      <Hero />
      <ShopByCategory />
      <ProductGrid title="New & Trending" styles={styles} />
      <WatchAndShop items={watchAndShop} />
      <CollectionsStrip collections={collections} />
      <TrustPromises />
    </>
  );
}
