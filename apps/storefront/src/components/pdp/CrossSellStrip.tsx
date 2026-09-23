import Image from 'next/image';
import Link from 'next/link';
import type { CrossSellItem } from '@/lib/api';
import { Container } from '../ui/Container';

/** Cross-sell (PDP-002): real catalog styles only - see CrossSellService for the rule/override composition. */
export function CrossSellStrip({ items }: { items: CrossSellItem[] }) {
  if (items.length === 0) return null;

  return (
    <section aria-labelledby="cross-sell-heading" className="border-t border-border py-12">
      <Container>
        <h2 id="cross-sell-heading" className="font-display text-xl text-ink">
          You may also like
        </h2>
        <ul className="mt-6 grid grid-cols-2 gap-x-4 gap-y-8 md:grid-cols-4">
          {items.map((item) => (
            <li key={item.id}>
              <Link href={`/product/${item.id}`} className="group block">
                <div className="relative aspect-[3/4] overflow-hidden rounded-sm bg-surface">
                  {item.thumbnailUrl ? (
                    <Image
                      src={item.thumbnailUrl}
                      alt=""
                      fill
                      sizes="(max-width: 768px) 50vw, 25vw"
                      className="object-cover transition-transform duration-300 group-hover:scale-105"
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center text-xs text-ink-muted">No image</div>
                  )}
                </div>
                <p className="mt-3 text-xs uppercase tracking-wide text-ink-muted">{item.brandName}</p>
                <p className="text-sm text-ink">{item.name}</p>
                <p className="mt-1 text-sm text-ink">&#8377;{item.sellingPrice}</p>
              </Link>
            </li>
          ))}
        </ul>
      </Container>
    </section>
  );
}
