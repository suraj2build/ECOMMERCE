import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
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
  const edition = findIssue(p.department, p.issue);
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
  const edition = findIssue(p.department, p.issue);
  if (!edition) notFound();
  const resolved = await resolveIssueProducts(edition);
  return <LookbookIssueView {...resolved} />;
}
