import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { isLookbookDepartment } from '@/lib/lookbook';
import { loadStorefrontStory, managedStoryHref } from '@/lib/lookbook-cms';
import { redirect } from 'next/navigation';
import { absoluteUrl } from '@/lib/seo';
import { ShopStoryView } from '@/vanya/views/ShopStoryView';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ department: string; slug: string }>;
}): Promise<Metadata> {
  const { department, slug } = await params;
  const story = isLookbookDepartment(department)
    ? await loadStorefrontStory(department, slug)
    : undefined;
  return story
    ? {
        title: story.title + ' | Lookbook',
        description: story.intro,
        alternates: { canonical: absoluteUrl(managedStoryHref(story)) },
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
  const story = await loadStorefrontStory(department, slug);
  if (!story) notFound();
  if ('presentation' in story && story.presentation === 'book') redirect(managedStoryHref(story));
  return <ShopStoryView story={story} />;
}
