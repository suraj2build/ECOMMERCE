import { safeHref } from './cms-links';

export type LookbookDepartment = 'men' | 'women';
export interface LookItem {
  styleId: string;
  colourId: string;
}
export interface Look {
  title: string;
  caption: string;
  image: string;
  alt: string;
  items: LookItem[];
}
export interface Story {
  slug: string;
  department: LookbookDepartment;
  title: string;
  intro: string;
  occasion: string;
  model: string;
  cover: string;
  looks: Look[];
}
const root = '/campaigns/launch-v1/';
const frame = (title: string, image: string, model: string): Look => ({
  title,
  image: root + image,
  caption: 'An outfit study in colour, texture and movement.',
  alt: model + ' wearing the complete outfit',
  items: [],
});
/** Editorial inspiration only until staff map the EXACT pictured product and colour.
 * Never infer mappings from category, name similarity, or a search result. */
export const launchStories: Story[] = [
  {
    slug: 'city-days',
    department: 'women',
    title: 'City days',
    intro: 'A little colour. A little confidence. Everyday pieces, seen through a fresh lens.',
    occasion: 'Everyday',
    model: 'Riya',
    cover: '/campaigns/lookbook-v1/riya-editorial.webp',
    looks: [
      {
        ...frame('The café stop', 'lifestyle-women-fashion.webp', 'Riya'),
        image: '/campaigns/lookbook-v1/riya-editorial.webp',
      },
      frame('Blue hour', 'lifestyle-women-denim.webp', 'Riya'),
      frame('Weekend plans', 'occasion-women-weekend.webp', 'Riya'),
    ],
  },
  {
    slug: 'after-the-light',
    department: 'women',
    title: 'After the light',
    intro:
      'Soft shine and effortless silhouettes. An evening edit that lets the garment do the talking.',
    occasion: 'Evening',
    model: 'Deeksha & Heena',
    cover: '/campaigns/lookbook-v1/deeksha-editorial.webp',
    looks: [
      {
        ...frame('The arrival', 'home-hero-women.webp', 'Deeksha'),
        image: '/campaigns/lookbook-v1/deeksha-editorial.webp',
      },
      {
        ...frame('Satin in motion', 'lifestyle-women-party.webp', 'Heena'),
        image: '/campaigns/lookbook-v1/heena-editorial.webp',
      },
      frame('One more evening', 'occasion-women-party.webp', 'Heena'),
    ],
  },
  {
    slug: 'the-working-week',
    department: 'men',
    title: 'The working week',
    intro:
      'Considered shirts, easy layers and clean lines. Business casual for the days that matter.',
    occasion: 'Work',
    model: 'Aryan',
    cover: root + 'home-hero-men.webp',
    looks: [
      frame('A clear start', 'home-hero-men.webp', 'Aryan'),
      frame('The shirt edit', 'lifestyle-men-shirt.webp', 'Aryan'),
      frame('After the meeting', 'occasion-men-business.webp', 'Aryan'),
    ],
  },
  {
    slug: 'off-the-clock',
    department: 'men',
    title: 'Off the clock',
    intro: 'Relaxed, never careless. Polished essentials for your own time.',
    occasion: 'Weekend',
    model: 'Aryan',
    cover: root + 'occasion-men-everyday.webp',
    looks: [
      frame('Easy mornings', 'occasion-men-everyday.webp', 'Aryan'),
      frame('The polo', 'lifestyle-men-polo.webp', 'Aryan'),
      frame('Denim days', 'lifestyle-men-denim.webp', 'Aryan'),
    ],
  },
];

export function isLookbookDepartment(value: string): value is LookbookDepartment {
  return value === 'men' || value === 'women';
}
export function storiesFor(department: LookbookDepartment) {
  return launchStories.filter((story) => story.department === department);
}
export function findStory(department: LookbookDepartment, slug: string) {
  return launchStories.find((story) => story.department === department && story.slug === slug);
}
export function storyHref(story: Pick<Story, 'department' | 'slug'>) {
  return '/' + story.department + '/lookbook/' + story.slug;
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** CMS JSON is data, never HTML. Invalid documents fail closed instead of
 * linking an arbitrary colour or displaying unsafe media URLs. */
export function parseStoryContent(raw: string, base: Story): Story | null {
  try {
    const data: unknown = JSON.parse(raw);
    if (!data || typeof data !== 'object') return null;
    const doc = data as Record<string, unknown>;
    if (!Array.isArray(doc.looks) || doc.looks.length < 1 || doc.looks.length > 12) return null;
    const looks: Look[] = [];
    for (const value of doc.looks) {
      if (!value || typeof value !== 'object') return null;
      const look = value as Record<string, unknown>;
      const image = safeHref(look.image);
      if (
        !image ||
        typeof look.title !== 'string' ||
        !look.title.trim() ||
        typeof look.alt !== 'string' ||
        !look.alt.trim() ||
        !Array.isArray(look.items) ||
        look.items.length > 8
      )
        return null;
      const items: LookItem[] = [];
      for (const value of look.items) {
        if (!value || typeof value !== 'object') return null;
        const item = value as Record<string, unknown>;
        if (
          typeof item.styleId !== 'string' ||
          !uuid.test(item.styleId) ||
          typeof item.colourId !== 'string' ||
          !uuid.test(item.colourId)
        )
          return null;
        if (items.some((old) => old.styleId === item.styleId && old.colourId === item.colourId))
          return null;
        items.push({ styleId: item.styleId, colourId: item.colourId });
      }
      looks.push({
        title: look.title.trim(),
        image,
        alt: look.alt.trim(),
        caption: typeof look.caption === 'string' ? look.caption : '',
        items,
      });
    }
    const cover = doc.cover === undefined ? base.cover : safeHref(doc.cover);
    if (!cover) return null;
    return { ...base, cover, looks, intro: typeof doc.intro === 'string' ? doc.intro : base.intro };
  } catch {
    return null;
  }
}
