import Image from 'next/image';
import Link from 'next/link';
import type { ShoppableMediaSummary } from '@/lib/api';
import { Container } from '../ui/Container';

/**
 * Home preview strip for Watch & Shop (specs/35-watch-and-shop.md).
 * The full immersive experience lives at /watch-and-shop; this is a
 * horizontally-scrollable teaser linking into it. No fabricated
 * engagement counts are ever shown here or on the full page.
 */
export function WatchAndShop({ items }: { items: ShoppableMediaSummary[] }) {
  if (items.length === 0) {
    return null;
  }

  return (
    <section aria-labelledby="watch-and-shop-heading" className="py-12">
      <Container>
        <div className="flex items-baseline justify-between">
          <h2 id="watch-and-shop-heading" className="font-display text-2xl text-ink">
            Watch &amp; Shop
          </h2>
          <Link href="/watch-and-shop" className="text-sm text-ink-muted hover:text-ink">
            View all
          </Link>
        </div>
        <ul className="mt-6 flex gap-4 overflow-x-auto pb-2">
          {items.map((item) => (
            <li key={item.id} className="w-40 flex-shrink-0 md:w-48">
              <Link href={`/watch-and-shop?media=${item.id}`} className="group block">
                <div className="relative aspect-[9/16] overflow-hidden rounded-sm bg-ink">
                  {item.thumbnailUrl ? (
                    <Image
                      src={item.thumbnailUrl}
                      alt={item.title}
                      fill
                      sizes="192px"
                      className="object-cover transition-transform duration-300 group-hover:scale-105"
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center text-xs text-canvas/70">
                      {item.title}
                    </div>
                  )}
                </div>
                {item.creatorAttribution && (
                  <p className="mt-2 text-xs text-ink-muted">{item.creatorAttribution}</p>
                )}
              </Link>
            </li>
          ))}
        </ul>
      </Container>
    </section>
  );
}
