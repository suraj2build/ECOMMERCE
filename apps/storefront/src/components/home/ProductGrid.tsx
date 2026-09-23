import Image from 'next/image';
import Link from 'next/link';
import type { PublicStyleSummary } from '@/lib/api';
import { Container } from '../ui/Container';

/**
 * Real product data only - never a fabricated listing. Renders an empty
 * state rather than placeholder products when nothing is published yet
 * (a genuinely empty catalog is a valid, honest state to show).
 */
export function ProductGrid({ title, styles }: { title: string; styles: PublicStyleSummary[] }) {
  if (styles.length === 0) {
    return null;
  }

  return (
    <section aria-labelledby={`${slugify(title)}-heading`} className="py-12">
      <Container>
        <h2 id={`${slugify(title)}-heading`} className="font-display text-2xl text-ink">
          {title}
        </h2>
        <ul className="mt-6 grid grid-cols-2 gap-x-4 gap-y-8 md:grid-cols-4">
          {styles.map((style) => (
            <li key={style.id}>
              <Link href={`/product/${style.id}`} className="group block">
                <div className="relative aspect-[3/4] overflow-hidden rounded-sm bg-surface">
                  {style.thumbnailUrl ? (
                    <Image
                      src={style.thumbnailUrl}
                      alt=""
                      fill
                      sizes="(max-width: 768px) 50vw, 25vw"
                      className="object-cover transition-transform duration-300 group-hover:scale-105"
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center text-xs text-ink-muted">No image</div>
                  )}
                </div>
                <p className="mt-3 text-xs uppercase tracking-wide text-ink-muted">{style.brandName}</p>
                <p className="text-sm text-ink">{style.name}</p>
                <p className="mt-1 flex items-center gap-2 text-sm">
                  <span className={style.isMarkdown ? 'text-danger' : 'text-ink'}>&#8377;{style.sellingPrice}</span>
                  {style.isMarkdown && (
                    <span className="text-ink-muted line-through">&#8377;{style.mrp}</span>
                  )}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      </Container>
    </section>
  );
}

function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-');
}
