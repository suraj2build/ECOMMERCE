import Image from 'next/image';
import Link from 'next/link';
import type { PublicCollectionSummary } from '@/lib/api';
import { Container } from '../ui/Container';

export function CollectionsStrip({ collections }: { collections: PublicCollectionSummary[] }) {
  if (collections.length === 0) {
    return null;
  }

  return (
    <section aria-labelledby="collections-heading" className="py-12">
      <Container>
        <h2 id="collections-heading" className="font-display text-2xl text-ink">
          Collections &amp; Stories
        </h2>
        <ul className="mt-6 flex gap-4 overflow-x-auto pb-2">
          {collections.map((collection) => (
            <li key={collection.id} className="w-56 flex-shrink-0">
              <Link href={`/collections/${collection.slug}`} className="group block">
                <div className="relative aspect-[4/5] overflow-hidden rounded-sm bg-surface">
                  {collection.styleThumbnails[0] ? (
                    <Image
                      src={collection.styleThumbnails[0]}
                      alt=""
                      fill
                      sizes="224px"
                      className="object-cover transition-transform duration-300 group-hover:scale-105"
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center text-xs text-ink-muted">No image</div>
                  )}
                </div>
                <p className="mt-3 text-sm text-ink">{collection.name}</p>
              </Link>
            </li>
          ))}
        </ul>
      </Container>
    </section>
  );
}
