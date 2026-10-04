export const dynamic = 'force-dynamic';

import Image from 'next/image';
import Link from 'next/link';
import type { Metadata } from 'next';
import { getAllPublicCollections } from '@/lib/api';
import { absoluteUrl, sharing } from '@/lib/seo';

const DESCRIPTION = 'Curated VANYA edits: workday, everyday, business casual and party collections.';

export const metadata: Metadata = {
  title: 'Collections',
  description: DESCRIPTION,
  alternates: { canonical: absoluteUrl('/collections') },
  ...sharing('Collections | VANYA', DESCRIPTION, '/collections'),
};

export default async function CollectionsPage() {
  // Every active collection, paged (the API caps one page at 60).
  const collections = await getAllPublicCollections();

  return (
    <div className="max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-10">
      <div className="border-b border-[#EAE3D7] pb-6">
        <div className="flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-[#756A5E] font-semibold">
          <span>Atelier Catalog</span>
          <span aria-hidden="true">•</span>
          <span className="text-[var(--color-primary)] font-bold">Curated Edits</span>
        </div>
        <h1 className="font-editorial text-3xl sm:text-5xl text-[#1A1816] font-normal mt-1">Collections</h1>
        <p className="text-xs text-[#7A6F64] mt-1.5 max-w-xl">{DESCRIPTION}</p>
      </div>

      {collections.length === 0 ? (
        <p className="mt-8 text-sm text-[#7A6F64]">No published collections right now.</p>
      ) : (
        <ul className="mt-10 grid gap-8 md:grid-cols-2">
          {collections.map((collection) => (
            <li key={collection.id}>
              <Link href={`/collections/${collection.slug}`} className="group block">
                <div className="grid aspect-[16/10] grid-cols-2 overflow-hidden rounded-2xl bg-[#F1ECE2] shadow-sm">
                  {collection.styleThumbnails.length > 0 ? (
                    collection.styleThumbnails.slice(0, 4).map((url, index) => (
                      <div key={url + index} className="relative">
                        <Image src={url} alt="" fill sizes="(max-width: 768px) 50vw, 25vw" className="object-cover transition-transform duration-500 group-hover:scale-[1.02]" />
                      </div>
                    ))
                  ) : (
                    <div className="col-span-2 flex items-center justify-center text-xs uppercase tracking-[0.16em] text-[#756A5E]">
                      Styles coming soon
                    </div>
                  )}
                </div>
                <h2 className="mt-4 font-editorial text-2xl text-[#1A1816] group-hover:text-[var(--color-primary)] transition-colors">{collection.name}</h2>
                {collection.description && <p className="mt-1 max-w-xl text-xs leading-5 text-[#7A6F64]">{collection.description}</p>}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
