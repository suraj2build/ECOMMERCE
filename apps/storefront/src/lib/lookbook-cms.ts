import { unstable_cache } from 'next/cache';
import { CATALOG_CACHE_TAG, getProductDetail, type ProductDetail } from './api';
import { storiesFor, parseStoryContent, type Story, type LookbookDepartment } from './lookbook';
import { cityIssue, looksForBuiltinStory, type LookbookIssue } from './lookbook-issue';
import { resolveIssueProducts } from './lookbook-issue-products';
import { getCmsPage } from './lookups';
export type ManagedStory = Story & {
  presentation: 'story' | 'book';
  showOnHome: boolean;
  sortOrder: number;
};
type Index = { stories: ManagedStory[]; hiddenBuiltins: string[] };
const api = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
export function parseManagedIndex(value: unknown, department: LookbookDepartment): Index {
  if (!value || typeof value !== 'object') return { stories: [], hiddenBuiltins: [] };
  const input = value as Record<string, unknown>;
  const stories: ManagedStory[] = [];
  for (const entry of Array.isArray(input.stories) ? input.stories : []) {
    if (!entry || typeof entry !== 'object') continue;
    const s = entry as ManagedStory;
    if (
      s.department !== department ||
      typeof s.slug !== 'string' ||
      !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(s.slug) ||
      ![s.title, s.occasion, s.model].every((v) => typeof v === 'string' && v.trim())
    )
      continue;
    const story = parseStoryContent(JSON.stringify(s), s);
    if (!story || story.looks.some((l) => !l.items.length)) continue;
    stories.push({
      ...story,
      presentation: s.presentation === 'book' ? 'book' : 'story',
      showOnHome: s.showOnHome === true,
      sortOrder: Number.isInteger(s.sortOrder) ? s.sortOrder : 0,
    });
  }
  return {
    stories,
    hiddenBuiltins: Array.isArray(input.hiddenBuiltins)
      ? input.hiddenBuiltins.filter((s): s is string => typeof s === 'string')
      : [],
  };
}
const cachedManagedLookbooks = unstable_cache(
  async (department: LookbookDepartment): Promise<Index> => {
    const res = await fetch(`${api}/api/v1/storefront/lookbooks?department=${department}`, {
      cache: 'no-store',
    });
    if (res.status === 404) return { stories: [], hiddenBuiltins: [] };
    if (!res.ok) throw new Error('Lookbook CMS temporarily unavailable');
    return parseManagedIndex(await res.json(), department);
  },
  ['published-lookbooks'],
  { revalidate: 60, tags: [CATALOG_CACHE_TAG] },
);
/**
 * A story is only ever hidden by a SUCCESSFUL response that explicitly lists
 * it in `hiddenBuiltins` - that is the one and only signal staff actually
 * unpublished it. A failed/unreachable fetch carries no such information, so
 * it must never be treated as "everything was unpublished" (that previously
 * made a transient blip on this one new endpoint 404 every bundled lookbook
 * page, which had zero runtime dependency before this feature existed) -
 * the safe default on failure is the same "nothing is known to be hidden"
 * result an explicit 404 already returns above, so every caller (hub,
 * story pages, the homepage teaser, the sitemap) falls back to the bundled
 * content consistently, the same way it did before this endpoint existed.
 */
export async function getManagedLookbooks(department: LookbookDepartment): Promise<Index> {
  try {
    return await cachedManagedLookbooks(department);
  } catch {
    return { stories: [], hiddenBuiltins: [] };
  }
}
export function managedStoryHref(story: Story & { presentation?: string }) {
  return `/${story.department}/lookbook/${story.presentation === 'book' ? 'issues/' : ''}${story.slug}`;
}
export async function storefrontStories(department: LookbookDepartment) {
  const index = await getManagedLookbooks(department);
  const overridden = new Set([...index.hiddenBuiltins, ...index.stories.map((s) => s.slug)]);
  const builtins = storiesFor(department).filter((s) => !overridden.has(s.slug));
  if (department !== 'women' || !builtins.length) return [...index.stories, ...builtins];
  const resolved = await resolveIssueProducts(cityIssue);
  return [
    ...index.stories,
    ...builtins.map((s) => ({
      ...s,
      looks: looksForBuiltinStory(resolved.issue.looks, s.slug),
    })),
  ];
}
export async function loadStorefrontStory(department: LookbookDepartment, slug: string) {
  const index = await getManagedLookbooks(department);
  const managed = index.stories.find((s) => s.slug === slug);
  if (managed) return managed;
  if (index.hiddenBuiltins.includes(slug)) return null;
  const base = storiesFor(department).find((s) => s.slug === slug);
  if (!base) return null;
  // Retain existing published CMS overrides during the migration to the form editor.
  try {
    const page = await getCmsPage('lookbook-' + department + '-' + slug);
    const block = page?.blocks.find((b) => b.key === 'lookbook-' + department + '-' + slug);
    if (block) return parseStoryContent(block.content, base) ?? base;
  } catch {
    /* The bundled story remains readable if the CMS is temporarily unavailable. */
  }
  if (department === 'women') {
    const resolved = await resolveIssueProducts(cityIssue);
    return { ...base, looks: looksForBuiltinStory(resolved.issue.looks, slug) };
  }
  return base;
}
/** Staff-authored complete books reuse the same reader and live product panel.
 * Product plates come from each selected colour's real catalogue media. */
export async function managedBook(
  story: ManagedStory,
): Promise<{ issue: LookbookIssue; catalogueUnavailable: boolean }> {
  const details = new Map<string, ProductDetail | null>();
  await Promise.all(
    [...new Set(story.looks.flatMap((l) => l.items.map((i) => i.styleId)))].map(async (id) => {
      details.set(id, await getProductDetail(id));
    }),
  );
  let unavailable = false;
  const looks = story.looks.map((l, i) => {
    const products = l.items.flatMap((item) => {
      const p = details.get(item.styleId);
      const colour = p?.variants.find((v) => v.colourId === item.colourId);
      if (!p || !colour || (p.gender || p.department || '').toLowerCase() !== story.department) {
        unavailable = true;
        return [];
      }
      const media = p.media.filter(
        (m) => m.type === 'IMAGE' && (m.colourId === item.colourId || !m.colourId),
      );
      return [
        {
          styleCode: p.styleCode,
          colourName: colour.colourName,
          title: p.name,
          catalogueId: p.id,
          front: media[0]?.url ?? '',
          detail: media[1]?.url ?? media[0]?.url ?? '',
          garmentDescription: '',
        },
      ];
    });
    return {
      ...l,
      id: String(i + 1).padStart(2, '0'),
      model: l.model || story.model,
      scene: story.occasion,
      products,
    };
  });
  const chapters: LookbookIssue['chapters'] = [];
  let nextPage = 4;
  for (const look of looks) {
    const last = chapters.at(-1);
    if (!last || last.model !== look.model) {
      chapters.push({
        title: look.model,
        model: look.model,
        intro: story.occasion,
        start: nextPage,
        lookIds: [look.id],
      });
      nextPage += 3;
    } else {
      last.lookIds.push(look.id);
      nextPage += 2;
    }
  }
  return {
    issue: {
      slug: story.slug,
      department: story.department,
      title: story.title,
      number: 'Staff edition',
      intro: story.intro,
      cover: story.cover,
      pdf: '',
      looks,
      chapters,
    },
    catalogueUnavailable: unavailable,
  };
}
