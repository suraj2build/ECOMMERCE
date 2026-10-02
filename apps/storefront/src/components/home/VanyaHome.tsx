'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useDepartment } from '@/components/layout/DepartmentProvider';
import { ProductCard } from '@/components/catalog/ProductCard';
import type { PublicCollectionSummary, ShoppableMediaSummary, StorefrontSearchHit } from '@/lib/api';

const CATEGORY_LINKS = {
  men: [
    ['Bandhgalas & Jackets', '/category/bandhgalas-jackets'],
    ['Linen & Silk Shirts', '/category/linen-silk-shirts'],
    ['Kurtas', '/category/kurtas'],
    ['Pleated Trousers', '/category/pleated-trousers'],
  ],
  women: [
    ['Modern Sarees', '/category/modern-sarees'],
    ['Co-ords & Sets', '/category/co-ords-sets'],
    ['Dresses & Drapes', '/category/dresses'],
    ['Festive Silk Edit', '/category/festive-silk-edit'],
  ],
} as const;

export function VanyaHome({
  men,
  women,
  collections,
  watch,
}: {
  men: StorefrontSearchHit[];
  women: StorefrontSearchHit[];
  collections: PublicCollectionSummary[];
  watch: ShoppableMediaSummary[];
}) {
  const { department } = useDepartment();
  const products = department === 'men' ? men : women;
  const hero = products.find((item) => item.thumbnailUrl) ?? products[0];
  const categories = CATEGORY_LINKS[department];

  return (
    <div className="pb-20">
      <section className="relative flex min-h-[72svh] items-end overflow-hidden bg-[#181716] text-white sm:min-h-[80svh] lg:min-h-[84svh]">
        {hero?.thumbnailUrl ? (
          <Image src={hero.thumbnailUrl} alt="" fill priority sizes="100vw" className="object-cover object-top brightness-[.78]" />
        ) : null}
        <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/40 to-black/20 sm:bg-gradient-to-r sm:from-black/90 sm:via-black/45 sm:to-transparent" />
        <div className="relative z-10 mx-auto flex w-full max-w-container items-end justify-between gap-8 px-gutter pb-12 pt-28 sm:pb-16">
          <div className="max-w-xl">
            <p className="text-[10px] uppercase tracking-[0.26em] text-[#e5dcd0]">The Festive Edit</p>
            <h1 className="mt-3 font-display text-5xl uppercase leading-[.95] tracking-[0.08em] sm:text-6xl lg:text-7xl">
              VANYA
            </h1>
            <p className="mt-3 text-[11px] uppercase tracking-[0.22em] text-[#ddd3c5] sm:text-xs">
              Modern Indian {department === 'men' ? 'Menswear' : 'Womenswear'}
            </p>
            <p className="mt-4 max-w-md text-sm font-light leading-6 text-[#ddd2c4]">
              Timeless silhouettes. Contemporary craftsmanship. For every occasion that matters.
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <Link href={department === 'men' ? '/category/men' : '/category/women'} className="inline-flex min-h-[46px] items-center gap-3 rounded-full bg-white px-7 text-[10px] font-semibold uppercase tracking-[0.18em] text-[#181716]">
                Shop {department === 'men' ? 'Men' : 'Women'} <span aria-hidden>→</span>
              </Link>
              <Link href="/category/new" className="inline-flex min-h-[46px] items-center gap-3 rounded-full border border-white/75 bg-black/20 px-7 text-[10px] font-semibold uppercase tracking-[0.18em] text-white">
                Explore New In <span aria-hidden>→</span>
              </Link>
            </div>
          </div>
          <div className="hidden text-right text-[10px] uppercase tracking-[0.28em] text-white/80 lg:block">
            <p>Tradition</p><p>Tailored</p><p>For a</p><p className="font-semibold text-white">Modern {department === 'men' ? 'Man' : 'Woman'}</p>
          </div>
        </div>
      </section>

      <section className="mx-auto -mt-1 max-w-container px-gutter py-7">
        <div className="grid grid-cols-2 gap-3 rounded-[22px] border border-border bg-surface p-4 shadow-subtle md:grid-cols-4 md:p-6">
          {[
            ['Complimentary delivery', 'On eligible orders'],
            ['Easy returns', 'Simple post-purchase flow'],
            ['Secure payments', 'COD & online'],
            ['Authentic availability', 'Live inventory'],
          ].map(([title, body]) => (
            <div key={title} className="px-2 py-2">
              <p className="text-[9px] font-semibold uppercase tracking-[0.15em] text-ink">{title}</p>
              <p className="mt-1 text-[10px] text-ink-muted">{body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-container px-gutter py-8 sm:py-12">
        <div className="flex items-end justify-between gap-4">
          <div>
            <p className="text-[9px] font-semibold uppercase tracking-[0.18em] text-accent">Curated for you</p>
            <h2 className="mt-1 font-display text-3xl text-ink sm:text-4xl">New arrivals</h2>
          </div>
          <Link href={department === 'men' ? '/category/men' : '/category/women'} className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ink underline underline-offset-4">
            View all
          </Link>
        </div>
        {products.length > 0 ? (
          <ul className="mt-7 grid grid-cols-2 gap-x-3 gap-y-10 sm:gap-x-5 md:grid-cols-3 lg:grid-cols-4">
            {products.slice(0, 8).map((item) => <li key={item.id}><ProductCard product={item} /></li>)}
          </ul>
        ) : (
          <p className="mt-6 text-sm text-ink-muted">Published styles will appear here when available.</p>
        )}
      </section>

      <section className="border-y border-border bg-[var(--color-surface-soft)] py-10 sm:py-14">
        <div className="mx-auto max-w-container px-gutter">
          <p className="text-[9px] font-semibold uppercase tracking-[0.18em] text-accent">Explore</p>
          <h2 className="mt-1 font-display text-3xl text-ink sm:text-4xl">Shop by category</h2>
          <div className="mt-7 grid grid-cols-2 gap-3 lg:grid-cols-4">
            {categories.map(([label, href], index) => {
              const image = products[index]?.thumbnailUrl ?? null;
              return (
                <Link key={href} href={href} className="group relative aspect-[4/5] overflow-hidden rounded-[20px] bg-surface">
                  {image ? <Image src={image} alt="" fill sizes="(max-width: 768px) 50vw, 25vw" className="object-cover transition-transform duration-500 group-hover:scale-[1.03]" /> : null}
                  <span className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/10 to-transparent" />
                  <span className="absolute inset-x-0 bottom-0 p-4 text-sm font-medium text-white sm:p-5">{label}</span>
                </Link>
              );
            })}
          </div>
        </div>
      </section>

      {watch.length > 0 && (
        <section className="mx-auto max-w-container px-gutter py-10 sm:py-14">
          <div className="flex items-end justify-between">
            <div>
              <p className="text-[9px] font-semibold uppercase tracking-[0.18em] text-accent">Watch. Shop. Wear.</p>
              <h2 className="mt-1 font-display text-3xl text-ink sm:text-4xl">VANYA stories</h2>
            </div>
            <Link href="/watch-and-shop" className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ink underline underline-offset-4">View all</Link>
          </div>
          <div className="mt-7 flex gap-3 overflow-x-auto pb-2 sm:gap-4">
            {watch.slice(0, 6).map((item) => (
              <Link key={item.id} href={`/watch-and-shop?media=${item.id}`} className="group w-40 shrink-0 sm:w-48">
                <div className="relative aspect-[9/16] overflow-hidden rounded-[20px] bg-black">
                  {item.thumbnailUrl ? <Image src={item.thumbnailUrl} alt={item.title} fill sizes="192px" className="object-cover transition-transform duration-500 group-hover:scale-[1.03]" /> : null}
                  <span className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent" />
                  <span className="absolute inset-x-0 bottom-0 p-3 text-xs font-medium text-white">{item.title}</span>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {collections.length > 0 && (
        <section className="mx-auto max-w-container px-gutter py-10">
          <p className="text-[9px] font-semibold uppercase tracking-[0.18em] text-accent">VANYA edits</p>
          <h2 className="mt-1 font-display text-3xl text-ink sm:text-4xl">Collections</h2>
          <div className="mt-7 grid gap-5 md:grid-cols-2">
            {collections.slice(0, 4).map((collection) => (
              <Link key={collection.id} href={`/collections/${collection.slug}`} className="group">
                <div className="relative aspect-[16/10] overflow-hidden rounded-[22px] bg-[var(--color-surface-soft)]">
                  {collection.styleThumbnails[0] ? <Image src={collection.styleThumbnails[0]} alt="" fill sizes="(max-width:768px) 100vw,50vw" className="object-cover transition-transform duration-500 group-hover:scale-[1.025]" /> : null}
                </div>
                <h3 className="mt-3 font-display text-2xl text-ink">{collection.name}</h3>
                {collection.description && <p className="mt-1 line-clamp-2 text-xs leading-5 text-ink-muted">{collection.description}</p>}
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
