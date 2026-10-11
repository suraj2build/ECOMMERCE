import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { findStory, isLookbookDepartment, parseStoryContent, storyHref, type Story } from '@/lib/lookbook';
import { getCmsPage } from '@/lib/lookups';
import { absoluteUrl } from '@/lib/seo';
import { ShopStoryView } from '@/vanya/views/ShopStoryView';

/**
 * Published CMS overrides alone can add exact product mappings - no
 * guessed/demo IDs. Neither an unpublished override nor an invalid one
 * (a staff content mistake: too many items, a malformed ID, etc.) should
 * ever take down a page that otherwise has a perfectly good bundled
 * editorial story - both leave the inspiration edition rather than 404ing.
 * Shared by the page and its metadata so neither can see the override
 * without the other.
 */
async function resolveStory(base: Story): Promise<Story> {
  const key = 'lookbook-' + base.department + '-' + base.slug;
  const page = await getCmsPage(key);
  const block = page?.blocks.find((b) => b.key === key);
  const parsed = block ? parseStoryContent(block.content, base) : null;
  return parsed ?? base;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ department: string; slug: string }>;
}): Promise<Metadata> {
  const { department, slug } = await params;
  const base = isLookbookDepartment(department) ? findStory(department, slug) : undefined;
  if (!base) return { title: 'Not found', robots: { index: false } };
  const story = await resolveStory(base);
  return {
    title: story.title + ' | Lookbook',
    description: story.intro,
    alternates: { canonical: absoluteUrl(storyHref(story)) },
  };
}
export default async function StoryPage({
  params,
}: {
  params: Promise<{ department: string; slug: string }>;
}) {
  const { department, slug } = await params;
  if (!isLookbookDepartment(department)) notFound();
  const base = findStory(department, slug);
  if (!base) notFound();
  const story = await resolveStory(base);
  return <ShopStoryView story={story} />;
}
