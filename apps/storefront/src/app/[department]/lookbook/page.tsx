import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { isLookbookDepartment } from '@/lib/lookbook';
import { absoluteUrl } from '@/lib/seo';
import { getManagedLookbooks, storefrontStories } from '@/lib/lookbook-cms';
import { LookbookView } from '@/vanya/views/LookbookView';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ department: string }>;
}): Promise<Metadata> {
  const { department } = await params;
  if (!isLookbookDepartment(department)) return { title: 'Not found', robots: { index: false } };
  return {
    title: (department === 'men' ? "Men's" : "Women's") + ' Lookbook',
    description: 'Explore photoshoot edits and shop the pieces behind each story.',
    alternates: { canonical: absoluteUrl('/' + department + '/lookbook') },
  };
}
export default async function LookbookPage({
  params,
}: {
  params: Promise<{ department: string }>;
}) {
  const { department } = await params;
  if (!isLookbookDepartment(department)) notFound();
  const index = await getManagedLookbooks(department);
  return <LookbookView department={department} stories={await storefrontStories(department)} showComplete={!index.hiddenBuiltins.includes('a-city-three-moods') && !index.stories.some((s) => s.slug === 'a-city-three-moods')} />;
}
