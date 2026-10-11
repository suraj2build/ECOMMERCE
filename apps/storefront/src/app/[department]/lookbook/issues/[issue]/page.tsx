import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getManagedLookbooks, managedBook } from '@/lib/lookbook-cms';
import { isLookbookDepartment } from '@/lib/lookbook';
import { findIssue, issueHref } from '@/lib/lookbook-issue';
import { resolveIssueProducts } from '@/lib/lookbook-issue-products';
import { absoluteUrl } from '@/lib/seo';
import { LookbookIssueView } from '@/vanya/views/LookbookIssueView';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ department: string; issue: string }>;
}): Promise<Metadata> {
  const p = await params;
  const index = isLookbookDepartment(p.department) ? await getManagedLookbooks(p.department) : { stories: [], hiddenBuiltins: [] };
  const managed = index.stories.find((s) => s.slug === p.issue && s.presentation === 'book');
  const edition = managed ?? (index.hiddenBuiltins.includes(p.issue) || index.stories.some((s) => s.slug === p.issue) ? undefined : findIssue(p.department, p.issue));
  return edition
    ? {
        title: edition.title + ' | Complete Lookbook',
        description: edition.intro,
        alternates: { canonical: absoluteUrl(issueHref(edition)) },
        openGraph: {
          title: edition.title,
          description: edition.intro,
          images: [absoluteUrl(edition.cover)],
        },
      }
    : { title: 'Not found', robots: { index: false } };
}
export default async function IssuePage({
  params,
}: {
  params: Promise<{ department: string; issue: string }>;
}) {
  const p = await params;
  if (!isLookbookDepartment(p.department)) notFound();
  const index = await getManagedLookbooks(p.department);
  const managed = index.stories.find((s) => s.slug === p.issue && s.presentation === 'book');
  if (managed) return <LookbookIssueView {...await managedBook(managed)} />;
  const edition = index.hiddenBuiltins.includes(p.issue) || index.stories.some((s) => s.slug === p.issue) ? undefined : findIssue(p.department, p.issue);
  if (!edition) notFound();
  const resolved = await resolveIssueProducts(edition);
  return <LookbookIssueView {...resolved} />;
}
