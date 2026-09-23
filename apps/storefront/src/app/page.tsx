import { getPublicCollections, getPublicStyles, getWatchAndShopFeed } from '@/lib/api';
import { Hero } from '@/components/home/Hero';
import { ShopByCategory } from '@/components/home/ShopByCategory';
import { ProductGrid } from '@/components/home/ProductGrid';
import { CollectionsStrip } from '@/components/home/CollectionsStrip';
import { WatchAndShop } from '@/components/home/WatchAndShop';
import { TrustPromises } from '@/components/home/TrustPromises';

// Home renders even when commerce-api is briefly unreachable - every
// data-backed module degrades to "not rendered" rather than crashing the
// page (see the try/catch below), since a merchandising module going
// temporarily empty is a much smaller failure than the whole homepage 500ing.
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
      <Hero />
      <ShopByCategory />
      <ProductGrid title="New & Trending" styles={styles} />
      <WatchAndShop items={watchAndShop} />
      <CollectionsStrip collections={collections} />
      <TrustPromises />
    </>
  );
}
