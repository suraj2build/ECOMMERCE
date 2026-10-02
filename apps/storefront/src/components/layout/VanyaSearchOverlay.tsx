'use client';

import { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { searchStorefrontLive, type StorefrontSearchHit } from '@/lib/api';
import { useDepartment } from './DepartmentContext';

export function VanyaSearchOverlay({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const { department } = useDepartment();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<StorefrontSearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKeyDown);
    const focusFrame = window.requestAnimationFrame(() => searchInputRef.current?.focus());
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.cancelAnimationFrame(focusFrame);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  useEffect(() => {
    if (!open || query.trim().length < 2) {
      setResults([]);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setLoading(true);
      searchStorefrontLive({ q: query.trim(), gender: department ?? undefined, pageSize: 8 })
        .then((result) => { if (!cancelled) setResults(result.hits); })
        .catch(() => { if (!cancelled) setResults([]); })
        .finally(() => { if (!cancelled) setLoading(false); });
    }, 250);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [open, query, department]);

  if (!open) return null;

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const value = query.trim();
    onClose();
    router.push(value ? '/search?q=' + encodeURIComponent(value) : '/search');
  }

  return (
    <div className="fixed inset-0 z-[80]">
      <button type="button" aria-label="Close search" onClick={onClose} className="absolute inset-0 bg-black/45 backdrop-blur-sm" />
      <section role="dialog" aria-modal="true" aria-label="Search VANYA" className="relative z-10 mx-auto mt-0 max-h-[92svh] w-full max-w-4xl overflow-y-auto rounded-b-[28px] bg-[#faf8f5] p-5 shadow-2xl sm:p-8">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--color-primary)]">Discover</p>
            <h2 className="mt-1 font-display text-3xl text-[#181716]">Search VANYA</h2>
          </div>
          <button type="button" onClick={onClose} className="min-h-[44px] min-w-[44px] text-xl" aria-label="Close search">×</button>
        </div>

        <form onSubmit={submit} className="mt-6 flex gap-2">
          <label htmlFor="vanya-search" className="sr-only">Search products</label>
          <input
            id="vanya-search"
            ref={searchInputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search kurtas, sarees, linen, colours…"
            className="min-h-[52px] flex-1 rounded-full border border-[#d8d0c6] bg-white px-5 text-base text-[#181716] outline-none focus:border-[#181716]"
          />
          <button type="submit" className="rounded-full bg-[#181716] px-6 text-xs font-semibold uppercase tracking-[0.12em] text-white">Search</button>
        </form>

        {query.trim().length < 2 ? (
          <div className="mt-8">
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#6e6359]">Explore</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {([
                ['Women', '/category/women'],
                ['Men', '/category/men'],
                ['New In', '/category/new'],
                ['Sale', '/category/sale'],
                ['Collections', '/collections'],
                ['Watch & Shop', '/watch-and-shop'],
              ] as const).map(([label, href]) => (
                <Link key={href} href={href} onClick={onClose} className="rounded-full border border-[#d8d0c6] bg-white px-4 py-2.5 text-xs text-[#181716] hover:border-[#181716]">
                  {label}
                </Link>
              ))}
            </div>
          </div>
        ) : (
          <div className="mt-8">
            <div className="flex items-center justify-between">
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#6e6359]">Live results</p>
              {loading ? <span className="text-[10px] uppercase tracking-[0.12em] text-[#6e6359]">Searching…</span> : null}
            </div>
            {results.length === 0 && !loading ? <p className="mt-4 text-sm text-[#6e6359]">No matching styles yet.</p> : null}
            <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {results.map((product) => (
                <li key={product.id}>
                  <Link href={'/product/' + product.id} onClick={onClose} className="group block">
                    <div className="relative aspect-[3/4] overflow-hidden rounded-[14px] bg-white">
                      {product.thumbnailUrl ? <Image src={product.thumbnailUrl} alt={product.name} fill sizes="200px" className="object-cover transition-transform duration-500 group-hover:scale-[1.025]" /> : null}
                    </div>
                    <p className="mt-2 line-clamp-1 text-xs font-medium text-[#181716]">{product.name}</p>
                    <p className="mt-1 text-xs text-[#5f554c]">&#8377;{product.sellingPrice}</p>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>
    </div>
  );
}
