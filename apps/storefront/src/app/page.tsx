import { getPublicCollections, getWatchAndShopFeed, searchStorefront } from '@/lib/api';
import { VanyaGateway } from '@/components/home/VanyaGateway';
import { VanyaHome } from '@/components/home/VanyaHome';

async function safeFetch<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch {
    return fallback;
  }
}

export default async function HomePage() {
  const [menResult, womenResult, collections, watch] = await Promise.all([
    safeFetch(() => searchStorefront({ gender: 'men', sort: 'newest', pageSize: 12 }), null),
    safeFetch(() => searchStorefront({ gender: 'women', sort: 'newest', pageSize: 12 }), null),
    safeFetch(() => getPublicCollections(), []),
    safeFetch(() => getWatchAndShopFeed(), []),
  ]);

  return (
    <>
      <VanyaGateway />
      <VanyaHome
        men={menResult?.hits ?? []}
        women={womenResult?.hits ?? []}
        collections={collections}
        watch={watch}
      />
    </>
  );
}
