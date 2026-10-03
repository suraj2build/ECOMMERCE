import { getPublicCollections, getWatchAndShopFeed, searchStorefront } from '@/lib/api';
import type { Metadata } from 'next';
import { VanyaHomeExperience } from '@/components/home/VanyaHomeExperience';
import { absoluteUrl, sharing } from '@/lib/seo';

const DESCRIPTION = 'Modern Indian menswear and womenswear. Timeless silhouettes, contemporary craftsmanship.';

export const metadata: Metadata = {
  alternates: { canonical: absoluteUrl('/') },
  ...sharing('VANYA — Indian Roots · Modern Form', DESCRIPTION, '/'),
};

async function safeFetch<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch {
    return fallback;
  }
}

export default async function HomePage() {
  const [menResult, womenResult, collections, watchAndShop] = await Promise.all([
    safeFetch(() => searchStorefront({ gender: 'men', sort: 'newest', pageSize: 12 }), null),
    safeFetch(() => searchStorefront({ gender: 'women', sort: 'newest', pageSize: 12 }), null),
    safeFetch(() => getPublicCollections(), []),
    safeFetch(() => getWatchAndShopFeed(), []),
  ]);

  return (
    <VanyaHomeExperience
      menProducts={menResult?.hits ?? []}
      womenProducts={womenResult?.hits ?? []}
      collections={collections}
      watchAndShop={watchAndShop}
    />
  );
}
