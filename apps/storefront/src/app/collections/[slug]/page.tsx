import { notFound } from 'next/navigation';
import { getPublicCollection, type StorefrontSearchHit } from '@/lib/api';
import { VanyaProductCard } from '@/components/catalog/VanyaProductCard';

export default async function CollectionDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const collection = await getPublicCollection(slug);
  if (!collection) notFound();

  const products: StorefrontSearchHit[] = collection.styles.map((style) => ({
    id: style.id,
    styleCode: style.styleCode,
    name: style.name,
    brandName: style.brandName,
    categoryName: collection.name,
    categorySlug: collection.slug,
    gender: null,
    colours: [],
    sizes: [],
    mrp: Number(style.mrp),
    sellingPrice: Number(style.sellingPrice),
    currency: 'INR',
    isMarkdown: style.isMarkdown,
    availableQuantity: 0,
    inStock: true,
    publishedAt: style.publishedAt ? new Date(style.publishedAt).getTime() : 0,
    thumbnailUrl: style.thumbnailUrl,
  }));

  return (
    <>
      <section className="border-b border-border bg-[var(--color-bg)]">
        <div className="mx-auto max-w-[1440px] px-gutter py-10 sm:py-14">
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--color-primary)]">VANYA collection</p>
          <h1 className="mt-2 font-display text-4xl tracking-[-0.02em] text-[#181716] md:text-6xl">{collection.name}</h1>
          {collection.description ? <p className="mt-4 max-w-2xl text-sm leading-6 text-[#6e6359]">{collection.description}</p> : null}
        </div>
      </section>
      <div className="mx-auto max-w-[1440px] px-gutter py-8 sm:py-10">
        {products.length === 0 ? (
          <p className="py-16 text-center text-sm text-[#6e6359]">No published styles in this collection right now.</p>
        ) : (
          <ul className="grid grid-cols-2 gap-3 gap-y-8 sm:gap-5 md:grid-cols-3 lg:grid-cols-4">
            {products.map((product) => <li key={product.id}><VanyaProductCard product={product} /></li>)}
          </ul>
        )}
      </div>
    </>
  );
}
