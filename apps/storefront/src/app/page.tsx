import type { Metadata } from 'next';
import { getAllPublicCollections, getWatchAndShopFeed, searchStorefront } from '@/lib/api';
import { absoluteUrl, sharing } from '@/lib/seo';
import { loadEditorial, reelsForDepartment, type Department } from '@/vanya/bridge/editorial';
import { HomeExperience, type DepartmentHome } from '@/vanya/bridge/HomeExperience';

const DESCRIPTION = 'Modern Indian menswear and womenswear. Timeless silhouettes, contemporary craftsmanship.';

export const metadata: Metadata = {
  alternates: { canonical: absoluteUrl('/') },
  ...sharing('VANYA — Indian Roots · Modern Form', DESCRIPTION, '/'),
};

async function departmentHome(department: Department, feed: Awaited<ReturnType<typeof getWatchAndShopFeed>>, collectionSlugs: string[]): Promise<DepartmentHome> {
  const [result, editorial] = await Promise.all([
    searchStorefront({ gender: department, sort: 'newest', pageSize: 12 }).catch(() => null),
    loadEditorial(department, collectionSlugs),
  ]);
  return {
    products: result?.hits ?? [],
    reels: reelsForDepartment(feed, department),
    gatewayImage: editorial.gateway,
    editorial: editorial.home,
  };
}

export default async function HomePage() {
  const [feed, collections] = await Promise.all([getWatchAndShopFeed().catch(() => []), getAllPublicCollections().catch(() => [])]);
  const slugs = collections.map((c) => c.slug);
  const [men, women] = await Promise.all([departmentHome('men', feed, slugs), departmentHome('women', feed, slugs)]);
  return <HomeExperience men={men} women={women} />;
}
