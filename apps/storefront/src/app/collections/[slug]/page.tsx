export const dynamic = 'force-dynamic';

import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { getPublicCollection } from '@/lib/lookups';
import { absoluteUrl, sharing } from '@/lib/seo';
import { styleSummaryToProduct } from '@/vanya/bridge/adapters';
import { ShopProductCard } from '@/vanya/bridge/ShopProductCard';

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

/** A collection, in the design's listing layout (views/PlpView.tsx header and cards). */
export default async function CollectionPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const collection = await getPublicCollection(slug);
  if (!collection) notFound();
  const count = collection.styles.length;

  return (
    <div className="max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-10">
      <div className="mb-8 border-b border-[#EAE3D7] pb-6">
        <div className="flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-[#756A5E] font-semibold">
          <span>Atelier Catalog</span>
          <span aria-hidden="true">•</span>
          <span className="text-[var(--color-primary)] font-bold">Curated Collection</span>
        </div>
        <h1 className="font-editorial text-3xl sm:text-5xl text-[#1A1816] font-normal mt-1">{collection.name}</h1>
        {collection.description && <p className="text-xs text-[#7A6F64] mt-1.5 max-w-xl">{collection.description}</p>}
        <p className="text-xs text-[#756A5E] mt-3">
          <strong className="text-[#1A1816] font-semibold">{count}</strong> {count === 1 ? 'style' : 'styles'}
        </p>
      </div>
      {count === 0 ? (
        <div className="py-24 text-center bg-[#FAF7F2] border border-[#EAE3D7] rounded-2xl p-8">
          <p className="font-editorial text-2xl text-[#5E5246]">No styles in this collection right now</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:gap-6 sm:grid-cols-3 lg:grid-cols-4">
          {collection.styles.map((style) => <ShopProductCard key={style.id} product={styleSummaryToProduct(style)} />)}
        </div>
      )}
    </div>
  );
}
