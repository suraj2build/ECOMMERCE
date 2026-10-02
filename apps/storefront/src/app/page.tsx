import { getPublicCollections, getWatchAndShopFeed, searchStorefront } from '@/lib/api';
import { VanyaHomeExperience } from '@/components/home/VanyaHomeExperience';

async function safeFetch<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try { return await fn(); } catch { return fallback; }
}

export default async function HomePage() {
  const [men, women, collections, watchAndShop] = await Promise.all([
    safeFetch(() => searchStorefront({ gender: 'men', sort: 'newest', pageSize: 12 }), null),
    safeFetch(() => searchStorefront({ gender: 'women', sort: 'newest', pageSize: 12 }), null),
    safeFetch(() => getPublicCollections(), []),
    safeFetch(() => getWatchAndShopFeed(), []),
  ]);

  return (
    <VanyaHomeExperience
      menProducts={men?.hits ?? []}
      womenProducts={women?.hits ?? []}
      collections={collections}
      watchAndShop={watchAndShop}
    />
  );
}
