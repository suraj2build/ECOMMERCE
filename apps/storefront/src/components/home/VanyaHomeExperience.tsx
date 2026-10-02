'use client';

import Image from 'next/image';
import Link from 'next/link';
import { DepartmentGateway } from '@/components/layout/DepartmentGateway';
import { useDepartment } from '@/components/layout/DepartmentContext';
import { VanyaProductCard } from '@/components/catalog/VanyaProductCard';
import type { PublicCollectionSummary, ShoppableMediaSummary, StorefrontSearchHit } from '@/lib/api';

export function VanyaHomeExperience({
  menProducts,
  womenProducts,
  collections,
  watchAndShop,
}: {
  menProducts: StorefrontSearchHit[];
  womenProducts: StorefrontSearchHit[];
  collections: PublicCollectionSummary[];
  watchAndShop: ShoppableMediaSummary[];
}) {
  const { department, hydrated } = useDepartment();

  if (!hydrated) {
    return <div className="min-h-screen bg-[#0e0c0b]" aria-hidden />;
  }

  if (!department) {
    return (
      <DepartmentGateway
        menImageUrl={menProducts.find((item) => item.thumbnailUrl)?.thumbnailUrl ?? null}
        womenImageUrl={womenProducts.find((item) => item.thumbnailUrl)?.thumbnailUrl ?? null}
      />
    );
  }

  const isMen = department === 'men';
  const products = isMen ? menProducts : womenProducts;
  const hero = products.find((item) => item.thumbnailUrl) ?? products[0];

  return (
    <div className="pb-16">
      <section className="relative flex min-h-[72svh] items-end overflow-hidden bg-[#181716] text-white sm:min-h-[82svh]">
        {hero?.thumbnailUrl ? (
          <Image
            src={hero.thumbnailUrl}
            alt=""
            fill
            priority
            sizes="100vw"
            className="object-cover object-top"
          />
        ) : null}
        <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/40 to-black/20 sm:bg-gradient-to-r sm:from-black/85 sm:via-black/45 sm:to-black/15" />
        <div className="relative z-10 mx-auto flex w-full max-w-[1440px] items-end justify-between gap-8 px-gutter pb-12 pt-28 sm:pb-16 lg:pb-20">
          <div className="max-w-2xl">
            <span className="text-[10px] font-light uppercase tracking-[0.26em] text-[#e5dcd0]">The festive edit</span>
            <h1 className="mt-4 font-display text-5xl font-normal uppercase leading-[.95] tracking-[0.12em] sm:text-6xl lg:text-7xl">VANYA</h1>
            <p className="mt-3 text-xs font-light uppercase tracking-[0.22em] text-[#ddd3c5] sm:text-sm">
              {isMen ? 'Modern Indian Menswear' : 'Modern Indian Womenswear'}
            </p>
            <p className="mt-4 max-w-md text-sm font-light leading-6 text-[#ddd2c4]">
              Timeless silhouettes. Contemporary craftsmanship. For every occasion that matters.
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <Link href={`/category/${department}`} className="inline-flex min-h-[46px] items-center gap-3 rounded-full bg-white px-7 text-xs font-medium uppercase tracking-[0.18em] text-[#181716] transition-transform hover:-translate-y-0.5">
                Shop {department} <span aria-hidden>&rarr;</span>
              </Link>
              <Link href="/collections" className="inline-flex min-h-[46px] items-center gap-3 rounded-full border border-white/80 bg-black/20 px-7 text-xs font-medium uppercase tracking-[0.18em] text-white backdrop-blur-sm transition-colors hover:bg-white hover:text-black">
                Explore collections <span aria-hidden>&rarr;</span>
              </Link>
            </div>
          </div>
          <div className="hidden pb-2 text-right text-[10px] font-light uppercase tracking-[0.30em] text-white/80 lg:block">
            <p>Tradition</p><p>Tailored</p><p>For a</p><p className="font-semibold text-white">Modern {isMen ? 'Man' : 'Woman'}</p>
          </div>
        </div>
      </section>

      <section className="mx-auto -mt-1 max-w-[1440px] px-gutter py-8 sm:py-10">
        <div className="grid grid-cols-2 gap-3 rounded-[20px] border border-[#eae3d7] bg-white p-5 shadow-sm md:grid-cols-4 md:gap-8 md:p-6">
          {[
            ['Delivery across India', 'Serviceability checked before checkout'],
            ['Easy returns', 'Policy shown before you buy'],
            ['Secure checkout', 'COD and verified online payment'],
            ['Real availability', 'Stock revalidated before order'],
          ].map(([title, text]) => (
            <div key={title}>
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#181716]">{title}</p>
              <p className="mt-1 text-[11px] leading-4 text-[#7a7065]">{text}</p>
            </div>
          ))}
        </div>
      </section>

      {products.length > 0 ? (
        <section className="mx-auto max-w-[1440px] px-gutter py-8 sm:py-12">
          <div className="mb-6 flex items-end justify-between gap-4">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--color-primary)]">Curated now</p>
              <h2 className="mt-1 font-display text-3xl text-[#181716] sm:text-4xl">New arrivals</h2>
            </div>
            <Link href={`/category/${department}`} className="text-xs font-medium uppercase tracking-[0.12em] text-[#6d6258] hover:text-[#181716]">View all &rarr;</Link>
          </div>
          <ul className="grid grid-cols-2 gap-3 sm:gap-5 md:grid-cols-3 lg:grid-cols-4">
            {products.slice(0, 8).map((product) => <li key={product.id}><VanyaProductCard product={product} /></li>)}
          </ul>
        </section>
      ) : null}

      {watchAndShop.length > 0 ? (
        <section className="bg-[#171411] py-12 text-white sm:py-16">
          <div className="mx-auto max-w-[1440px] px-gutter">
            <div className="flex items-end justify-between">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#bfae9a]">VANYA stories</p>
                <h2 className="mt-1 font-display text-3xl sm:text-4xl">Watch. Shop. Wear.</h2>
              </div>
              <Link href="/watch-and-shop" className="text-xs uppercase tracking-[0.12em] text-[#d4c7b9] hover:text-white">Watch all &rarr;</Link>
            </div>
            <ul className="mt-7 flex gap-3 overflow-x-auto pb-3 sm:gap-4">
              {watchAndShop.slice(0, 6).map((item) => (
                <li key={item.id} className="w-[46vw] max-w-[230px] shrink-0">
                  <Link href={`/watch-and-shop?media=${item.id}`} className="group block">
                    <div className="relative aspect-[9/16] overflow-hidden rounded-[18px] bg-black">
                      {item.thumbnailUrl ? <Image src={item.thumbnailUrl} alt={item.title} fill sizes="230px" className="object-cover transition-transform duration-700 group-hover:scale-[1.03]" /> : null}
                      <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent" />
                      <div className="absolute inset-x-0 bottom-0 p-4">
                        <p className="line-clamp-2 font-display text-lg leading-tight text-white">{item.title}</p>
                        {item.creatorAttribution ? <p className="mt-1 text-[10px] uppercase tracking-[0.12em] text-white/70">{item.creatorAttribution}</p> : null}
                      </div>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </section>
      ) : null}

      {collections.length > 0 ? (
        <section className="mx-auto max-w-[1440px] px-gutter py-12 sm:py-16">
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--color-primary)]">Editorial curation</p>
          <h2 className="mt-1 font-display text-3xl text-[#181716] sm:text-4xl">Collections &amp; stories</h2>
          <ul className="mt-7 grid gap-5 md:grid-cols-2">
            {collections.slice(0, 4).map((collection) => (
              <li key={collection.id}>
                <Link href={`/collections/${collection.slug}`} className="group block">
                  <div className="grid aspect-[16/10] grid-cols-2 overflow-hidden rounded-[20px] bg-[var(--color-surface-soft)]">
                    {collection.styleThumbnails.slice(0, 4).map((url, index) => (
                      <div key={url + index} className="relative">
                        <Image src={url} alt="" fill sizes="(max-width: 768px) 50vw, 25vw" className="object-cover transition-transform duration-700 group-hover:scale-[1.025]" />
                      </div>
                    ))}
                  </div>
                  <h3 className="mt-4 font-display text-2xl text-[#181716]">{collection.name}</h3>
                  {collection.description ? <p className="mt-1 max-w-xl text-sm leading-6 text-[#7a7065]">{collection.description}</p> : null}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
