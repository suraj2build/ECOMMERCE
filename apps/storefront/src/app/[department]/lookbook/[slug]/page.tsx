import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { findStory, isLookbookDepartment, parseStoryContent, storyHref } from '@/lib/lookbook';
import { getCmsPage } from '@/lib/lookups';
import { absoluteUrl } from '@/lib/seo';
import { ShopStoryView } from '@/vanya/views/ShopStoryView';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ department: string; slug: string }>;
}): Promise<Metadata> {
  const { department, slug } = await params;
  const story = isLookbookDepartment(department) ? findStory(department, slug) : undefined;
  return story
    ? {
        title: story.title + ' | Lookbook',
        description: story.intro,
        alternates: { canonical: absoluteUrl(storyHref(story)) },
      }
    : { title: 'Not found', robots: { index: false } };
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
  // Published CMS overrides alone can add exact product mappings.
  // No guessed/demo IDs. An unpublished override leaves the inspiration edition.
  const page = await getCmsPage('lookbook-' + department + '-' + slug);
  const block = page?.blocks.find((b) => b.key === 'lookbook-' + department + '-' + slug);
  const story = block ? parseStoryContent(block.content, base) : base;
  if (!story) notFound();
  return <ShopStoryView story={story} />;
}
