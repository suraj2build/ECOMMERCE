export const dynamic = 'force-dynamic';

import { notFound } from 'next/navigation';
import { Container } from '@/components/ui/Container';
import { ProductCard } from '@/components/catalog/ProductCard';
import { getPublicCollection } from '@/lib/api';

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
            {collection.styles.map((style) => <li key={style.id}><ProductCard product={style} /></li>)}
          </ul>
        )}
      </Container>
    </>
  );
}
