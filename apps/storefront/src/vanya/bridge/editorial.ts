/**
 * Editorial photographs for the gateway and department home, read from CMS
 * banners by placement (admin → Content → Banners): `gateway-<dept>`,
 * `home-hero-<dept>`, `home-feature-<dept>`, `home-category-<dept>`,
 * `home-occasion-<dept>`, `home-tastemakers-<dept>`. A placement with no
 * banner leaves its section without a photograph rather than borrowing one.
 */
import { getBanners, type ShoppableMediaSummary } from '@/lib/api';
import type { HomeEditorial } from '../views/HomeView';

export type Department = 'men' | 'women';

export async function loadEditorial(department: Department): Promise<{ gateway: string | null; home: HomeEditorial }> {
  const [gateway, hero, feature, categories, occasions, tastemakers] = await Promise.all(
    ['gateway', 'home-hero', 'home-feature', 'home-category', 'home-occasion', 'home-tastemakers'].map((key) =>
      getBanners(`${key}-${department}`),
    ),
  );
  return {
    gateway: gateway![0]?.imageUrl ?? null,
    home: {
      hero: hero![0]?.imageUrl ?? null,
      feature: feature![0]?.imageUrl ?? null,
      categories: categories!.map((b) => ({ id: b.id, title: b.title, image: b.imageUrl, href: b.linkUrl ?? `/category/${department}` })),
      occasions: occasions!.map((b) => ({ image: b.imageUrl, href: b.linkUrl })),
      tastemakers: tastemakers!.map((b) => ({ id: b.id, image: b.imageUrl, caption: b.title })),
    },
  };
}

/** Watch & Shop posts with at least one tagged product from the department. */
export function reelsForDepartment(feed: ShoppableMediaSummary[], department: Department) {
  return feed.filter((media) =>
    media.tags.some((tag) => (tag.style.gender ?? tag.style.department ?? '').toLowerCase() === department),
  );
}
