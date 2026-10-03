export const dynamic = 'force-dynamic';

import { notFound } from 'next/navigation';
import { Container } from '@/components/ui/Container';
import { VanyaProductCard } from '@/components/catalog/VanyaProductCard';
import type { Metadata } from 'next';
import { getPublicCollection } from '@/lib/lookups';
import { absoluteUrl, sharing } from '@/lib/seo';

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const collection = await getPublicCollection(slug);
  if (!collection) return { title: 'Not found', robots: { index: false, follow: false } };
  const description = collection.description ?? `The ${collection.name} collection from VANYA.`;
  return {
    title: collection.name,
    description,
    alternates: { canonical: absoluteUrl(`/collections/${slug}`) },
    ...sharing(`${collection.name} | VANYA`, description, `/collections/${slug}`, collection.styleThumbnails[0]),
  };
}

export default async function CollectionPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const collection = await getPublicCollection(slug);
  if (!collection) notFound();

  return (
    <>
      <section className="border-b border-border bg-canvas">
        <Container className="py-10 md:py-16">
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-accent">VANYA collection</p>
          <h1 className="mt-2 font-display text-4xl tracking-[-0.035em] text-ink md:text-6xl">{collection.name}</h1>
          {collection.description && <p className="mt-4 max-w-2xl text-sm leading-6 text-ink-muted">{collection.description}</p>}
        </Container>
      </section>
      <Container className="py-8 md:py-10">
        {collection.styles.length === 0 ? (
          <p className="text-sm text-ink-muted">No published styles in this collection right now.</p>
        ) : (
          <ul className="grid grid-cols-2 gap-x-3 gap-y-10 sm:gap-x-5 md:grid-cols-3 lg:grid-cols-4">
            {collection.styles.map((style) => <li key={style.id}><VanyaProductCard product={style} /></li>)}
          </ul>
        )}
      </Container>
    </>
  );
}
