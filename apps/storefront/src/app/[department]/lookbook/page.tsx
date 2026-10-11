import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { isLookbookDepartment } from '@/lib/lookbook';
import { absoluteUrl } from '@/lib/seo';
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
  return <LookbookView department={department} />;
}
