import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { SITE_URL } from '@/lib/api';
import { safeHref } from '@/lib/cms-links';
import { getCmsPage } from '@/lib/lookups';

/**
 * A content page staff publish in admin → Content → Landing pages
 * (specs/28-admin.md: campaign landing pages change without a deployment),
 * e.g. Our Story or Journal linked from the footer's "footer-about" menu.
 * Only published pages exist; the text is the staff's own, shown as plain
 * paragraphs and never injected as HTML. Legal pages keep their own route.
 */
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function isContentSlug(slug: string): boolean {
  return SLUG.test(slug) && !slug.startsWith('legal-');
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const page = isContentSlug(slug) ? await getCmsPage(slug) : null;
  if (!page) return { title: 'Not found', robots: { index: false, follow: true } };
  return {
    title: page.title,
    description: page.metaDescription ?? undefined,
    alternates: { canonical: `${SITE_URL}/pages/${slug}` },
  };
}

export default async function ContentPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!isContentSlug(slug)) notFound();
  const page = await getCmsPage(slug);
  if (!page) notFound();
  const heroImage = safeHref(page.heroImageUrl);

  return (
    <article className="max-w-3xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-10 sm:py-14">
      <span className="text-[10px] tracking-[0.22em] uppercase text-[#756A5E] font-semibold">VANYA</span>
      <h1 className="font-editorial text-3xl sm:text-5xl text-[#1A1816] font-normal mt-2 leading-tight">{page.title}</h1>
      {heroImage ? (
        <img src={heroImage} alt="" className="mt-8 w-full rounded-2xl object-cover aspect-[16/9] bg-[#EFE9DF]" />
      ) : null}
      {page.blocks.map((block) => (
        <section key={block.key} className="mt-10">
          <h2 className="font-editorial text-2xl text-[#1A1816]">{block.title}</h2>
          {/* Plain text only: the staff's paragraphs, never HTML. */}
          {block.content.split(/\n\s*\n/).map((paragraph, index) => (
            <p key={index} className="mt-4 whitespace-pre-line text-sm leading-7 text-[#5C5146]">{paragraph.trim()}</p>
          ))}
        </section>
      ))}
    </article>
  );
}
