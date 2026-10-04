export const dynamic = 'force-dynamic';

import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { getPublicCollection } from '@/lib/lookups';
import { absoluteUrl, sharing } from '@/lib/seo';
import { styleSummaryToProduct } from '@/vanya/bridge/adapters';
import { ShopProductCard } from '@/vanya/bridge/ShopProductCard';
import { Breadcrumb } from '@/vanya/components/Breadcrumb';

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
    <div className="max-w-7xl 2xl:max-w-[1760px] w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-10">
      <Breadcrumb
        items={[
          { label: 'Home', href: '/' },
          { label: 'Collections', href: '/collections' },
          { label: collection.name },
        ]}
        className="text-xs text-[#756A5E] mb-2"
      />
      <div className="flex flex-wrap items-center justify-between gap-3 pb-3 mb-4 border-b border-[#EAE3D7]">
        <div className="flex items-baseline gap-2 min-w-0">
          <h1 className="font-editorial text-xl sm:text-2xl text-[#1A1816] font-normal truncate">{collection.name}</h1>
          <span className="text-xs text-[#756A5E] shrink-0" role="status">
            {count} {count === 1 ? 'style' : 'styles'}
          </span>
        </div>
      </div>
      {collection.description && (
        <details className="mb-4 text-xs text-[#7A6F64] max-w-xl">
          <summary className="cursor-pointer select-none text-[#756A5E] hover:text-[#1A1816] list-none inline-flex items-center gap-1">
            About this edit <span aria-hidden="true">▾</span>
          </summary>
          <p className="mt-1.5">{collection.description}</p>
        </details>
      )}
      {count === 0 ? (
        <div className="py-24 text-center bg-[#FAF7F2] border border-[#EAE3D7] rounded-2xl p-8">
          <p className="font-editorial text-2xl text-[#5E5246]">No styles in this collection right now</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:gap-6 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {collection.styles.map((style) => <ShopProductCard key={style.id} product={styleSummaryToProduct(style)} />)}
        </div>
      )}
    </div>
  );
}
