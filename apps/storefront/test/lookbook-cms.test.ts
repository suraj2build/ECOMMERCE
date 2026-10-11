import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('next/cache', () => ({ unstable_cache: (fn: unknown) => fn }));
vi.mock('../src/lib/lookups', () => ({ getCmsPage: async () => null }));
const mocks = vi.hoisted(() => ({ detail: vi.fn(), issue: vi.fn() }));
vi.mock('../src/lib/api', () => ({ CATALOG_CACHE_TAG: 'catalog', getProductDetail: mocks.detail }));
vi.mock('../src/lib/lookbook-issue-products', () => ({ resolveIssueProducts: mocks.issue }));
import {
  getManagedLookbooks,
  managedBook,
  parseManagedIndex,
  loadStorefrontStory,
} from '../src/lib/lookbook-cms';
const styleId = '12345678-1234-4234-a234-123456789abc',
  colourId = '12345678-1234-4234-a234-123456789def';
const story = {
  slug: 'new-story',
  department: 'women' as const,
  title: 'New story',
  intro: '',
  model: 'Riya',
  occasion: 'Morning',
  cover: '/cover.webp',
  presentation: 'book' as const,
  showOnHome: true,
  sortOrder: 0,
  looks: [
    {
      title: 'One',
      model: 'Riya',
      caption: '',
      image: '/image.webp',
      alt: 'Pink top',
      items: [{ styleId, colourId }],
    },
  ],
};
beforeEach(() => {
  vi.restoreAllMocks();
  mocks.detail.mockReset();
});
describe('published lookbook consumption', () => {
  it('drops malformed, unmapped, unsafe and cross-department documents', () => {
    for (const changed of [
      { department: 'men' },
      { title: {} },
      { cover: 'javascript:alert(1)' },
      { slug: '../admin' },
      { looks: [{ ...story.looks[0], items: [] }] },
    ]) {
      expect(parseManagedIndex({ stories: [{ ...story, ...changed }] }, 'women').stories).toEqual(
        [],
      );
    }
    expect(parseManagedIndex({ stories: [story] }, 'women').stories[0]!.slug).toBe(story.slug);
  });
  it('never resurrects a bundled edition after a CMS outage', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    const result = await getManagedLookbooks('women');
    expect(result.hiddenBuiltins).toContain('city-days');
    expect(result.hiddenBuiltins).toContain('a-city-three-moods');
    expect(await loadStorefrontStory('women', 'city-days')).toBeNull();
    vi.unstubAllGlobals();
  });
  it('builds book chapters and exact-colour product plates from the linked products', async () => {
    mocks.detail.mockResolvedValue({
      id: styleId,
      styleCode: 'EXACT',
      name: 'Pink top',
      gender: 'women',
      variants: [{ colourId, colourName: 'Pink' }],
      media: [
        { type: 'IMAGE', colourId: 'other', url: '/wrong.webp' },
        { type: 'IMAGE', colourId, url: '/pink.webp' },
      ],
    });
    const result = await managedBook({
      ...story,
      looks: [...story.looks, { ...story.looks[0]!, model: 'Heena', title: 'Two' }],
    });
    expect(result.issue.chapters.map((c) => c.start)).toEqual([4, 7]);
    expect(result.issue.looks[0]!.products[0]!.front).toBe('/pink.webp');
    expect(result.issue.looks[0]!.items[0]!.colourId).toBe(colourId);
    expect(result.issue.pdf).toBe('');
  });
  it('keeps a missing or wrong-department linked product out of the product plates', async () => {
    mocks.detail.mockResolvedValue({
      id: styleId,
      gender: 'men',
      variants: [{ colourId, colourName: 'Pink' }],
      media: [],
    });
    const result = await managedBook(story);
    expect(result.issue.looks[0]!.products).toEqual([]);
    expect(result.catalogueUnavailable).toBe(true);
  });
});
