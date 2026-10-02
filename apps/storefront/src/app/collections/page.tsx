import Image from 'next/image';
import Link from 'next/link';
import { getPublicCollections } from '@/lib/api';

export default async function CollectionsPage() {
  const collections = await getPublicCollections();

  return (
    <div className="mx-auto max-w-[1440px] px-gutter py-10 sm:py-14">
      <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--color-primary)]">Curated edits</p>
      <h1 className="mt-2 font-display text-4xl tracking-[-0.02em] text-[#181716] md:text-6xl">Collections</h1>
      <p className="mt-4 max-w-2xl text-sm leading-6 text-[#6e6359]">Seasonal stories built from the live VANYA catalog. Only published, actively priced styles appear here.</p>

      {collections.length === 0 ? (
        <p className="mt-10 text-sm text-[#6e6359]">No published collections right now.</p>
      ) : (
        <ul className="mt-10 grid gap-8 md:grid-cols-2">
          {collections.map((collection) => (
            <li key={collection.id}>
              <Link href={'/collections/' + collection.slug} className="group block">
                <div className="grid aspect-[16/10] grid-cols-2 overflow-hidden rounded-[22px] bg-[var(--color-surface-soft)]">
                  {collection.styleThumbnails.length > 0 ? collection.styleThumbnails.slice(0, 4).map((url, index) => (
                    <div key={url + index} className="relative">
                      <Image src={url} alt="" fill sizes="(max-width: 768px) 50vw, 25vw" className="object-cover transition-transform duration-700 group-hover:scale-[1.025]" />
                    </div>
                  )) : (
                    <div className="col-span-2 flex h-full items-center justify-center text-[10px] uppercase tracking-[0.16em] text-[#6e6359]">Editorial imagery coming soon</div>
                  )}
                </div>
                <h2 className="mt-4 font-display text-2xl text-[#181716]">{collection.name}</h2>
                {collection.description ? <p className="mt-2 max-w-xl text-sm leading-6 text-[#6e6359]">{collection.description}</p> : null}
                <span className="mt-3 inline-block text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--color-primary)]">Explore collection &rarr;</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
