import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Container } from '@/components/ui/Container';
import { SITE_URL } from '@/lib/api';
import { getLegalPage } from '@/lib/lookups';

const PAGES = {
  privacy: {
    title: 'Privacy Policy',
    description: 'How VANYA collects, uses and protects personal information.',
    // LR-001: details the business must supply before this policy can be
    // published. Engineering never writes legal wording.
    missing: [
      'Legal entity name and registered office address',
      'Grievance officer name and contact details',
      'Purposes of processing and the legal basis for each',
      'How long personal data is kept',
      'Service providers that process personal data (payment, SMS, shipping, analytics)',
      'How customers request access, correction, erasure or consent withdrawal',
      'Effective date',
    ],
  },
  terms: {
    title: 'Terms of Use',
    description: 'The terms that apply to shopping on VANYA.',
    missing: [
      'Legal entity name and registered office address',
      'Governing law and jurisdiction',
      'Order acceptance, pricing-error and cancellation terms',
      'Shipping, return and refund terms as approved by the business',
      'Grievance and customer-contact details',
      'Effective date',
    ],
  },
} as const;

type Kind = keyof typeof PAGES;
const isKind = (slug: string): slug is Kind => slug in PAGES;

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  if (!isKind(slug)) return { title: 'Not found' };
  const page = await getLegalPage(slug);
  const meta = PAGES[slug];
  return {
    title: page?.title ?? meta.title,
    description: page?.metaDescription ?? meta.description,
    alternates: { canonical: `${SITE_URL}/legal/${slug}` },
    // Only approved, published text is indexable (LR-002).
    robots: page ? undefined : { index: false, follow: true },
  };
}

export default async function LegalPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!isKind(slug)) notFound();
  const meta = PAGES[slug];
  const page = await getLegalPage(slug);

  return (
    <Container className="max-w-3xl py-10 md:py-14">
      <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-accent">Legal</p>
      <h1 className="mt-2 font-display text-4xl tracking-[-0.035em] text-ink md:text-5xl">{page?.title ?? meta.title}</h1>

      {page ? (
        <>
          <p className="mt-3 text-xs text-ink-muted">
            Last updated {new Date(page.publishedAt ?? page.updatedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}
          </p>
          {page.blocks.map((block) => (
            <section key={block.key} className="mt-8">
              <h2 className="font-display text-2xl text-ink">{block.title}</h2>
              {/* Plain text only (LR-001): approved copy is split into paragraphs, never injected as HTML. */}
              {block.content.split(/\n\s*\n/).map((paragraph, index) => (
                <p key={index} className="mt-3 whitespace-pre-line text-sm leading-7 text-ink-muted">{paragraph.trim()}</p>
              ))}
            </section>
          ))}
        </>
      ) : (
        <section data-testid="legal-pending" className="mt-8 rounded-[20px] border border-border bg-[var(--color-surface-soft)] p-6">
          <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-ink">Awaiting approved text</h2>
          <p className="mt-3 text-sm leading-7 text-ink-muted">
            The {meta.title.toLowerCase()} has not been published yet. It will appear here once VANYA approves it. The following details are still needed:
          </p>
          <ul className="mt-4 list-disc space-y-2 pl-5 text-sm leading-6 text-ink-muted">
            {meta.missing.map((item) => <li key={item}>{item}</li>)}
          </ul>
        </section>
      )}
    </Container>
  );
}
