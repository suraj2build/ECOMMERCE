export const dynamic = 'force-dynamic';

import Image from 'next/image';
import Link from 'next/link';
import { Container } from '@/components/ui/Container';
import { getPublicCollections } from '@/lib/api';

export default async function CollectionsPage() {
  const collections = await getPublicCollections();

  return (
    <Container className="py-10 md:py-14">
      <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-accent">Curated edits</p>
      <h1 className="mt-2 font-display text-4xl tracking-[-0.035em] text-ink md:text-6xl">Collections</h1>

      {collections.length === 0 ? (
        <p className="mt-8 text-sm text-ink-muted">No published collections right now.</p>
      ) : (
        <ul className="mt-10 grid gap-8 md:grid-cols-2">
          {collections.map((collection) => (
            <li key={collection.id}>
              <Link href={`/collections/${collection.slug}`} className="group block">
                <div className="grid aspect-[16/10] grid-cols-2 overflow-hidden rounded-[24px] bg-[var(--color-surface-soft)]">
                  {collection.styleThumbnails.length > 0 ? (
                    collection.styleThumbnails.slice(0, 4).map((url, index) => (
                      <div key={url + index} className="relative">
                        <Image src={url} alt="" fill sizes="(max-width: 768px) 50vw, 25vw" className="object-cover transition-transform duration-500 group-hover:scale-[1.02]" />
                      </div>
                    ))
                  ) : (
                    <div className="col-span-2 flex items-center justify-center text-xs uppercase tracking-[0.16em] text-ink-muted">
                      Editorial coming soon
                    </div>
                  )}
                </div>
                <h2 className="mt-4 font-display text-2xl text-ink">{collection.name}</h2>
                {collection.description && <p className="mt-2 max-w-xl text-sm leading-6 text-ink-muted">{collection.description}</p>}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Container>
  );
}
