'use client';

import { useEffect, useMemo, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import type { ProductDetail, ShoppableMediaSummary } from '@/lib/api';
import { getProductDetailLive, recordWatchAndShopEvent } from '@/lib/api';
import { addToCart, addToWishlist, getGuestSessionId } from '@/lib/cart';

export function VanyaWatchAndShop({ items }: { items: ShoppableMediaSummary[] }) {
  const [preview, setPreview] = useState<ProductDetail | null>(null);
  const [previewMediaId, setPreviewMediaId] = useState<string | null>(null);
  const [selectedColourId, setSelectedColourId] = useState<string | null>(null);
  const [selectedSizeId, setSelectedSizeId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const recorded = new Set<string>();
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting || entry.intersectionRatio < 0.55) continue;
        const id = (entry.target as HTMLElement).dataset.mediaId;
        if (!id || recorded.has(id)) continue;
        recorded.add(id);
        void getGuestSessionId()
          .then((sessionRef) => recordWatchAndShopEvent(id, 'VIEW', sessionRef))
          .catch(() => {});
      }
    }, { threshold: [0.55] });

    const nodes = document.querySelectorAll<HTMLElement>('[data-media-id]');
    nodes.forEach((node) => observer.observe(node));
    return () => observer.disconnect();
  }, []);

  const variants = useMemo(
    () => preview?.variants.filter((variant) => !selectedColourId || variant.colourId === selectedColourId) ?? [],
    [preview, selectedColourId],
  );
  const selectedVariant = variants.find((variant) => variant.sizeId === selectedSizeId) ?? null;

  async function openProduct(mediaId: string, styleId: string) {
    setMessage(null);
    try {
      const [product, sessionRef] = await Promise.all([getProductDetailLive(styleId), getGuestSessionId()]);
      setPreview(product);
      setPreviewMediaId(mediaId);
      const first = product.variants.find((variant) => variant.inStock) ?? product.variants[0];
      setSelectedColourId(first?.colourId ?? null);
      setSelectedSizeId(null);
      void recordWatchAndShopEvent(mediaId, 'TAG_TAP', sessionRef).catch(() => {});
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not load this product.');
    }
  }

  async function handleAddToBag() {
    if (!preview || !previewMediaId || !selectedVariant) {
      setMessage('Select an available size first.');
      return;
    }
    if (!selectedVariant.inStock) {
      setMessage('This size is currently out of stock.');
      return;
    }
    try {
      await addToCart(selectedVariant.skuId, 1);
      window.dispatchEvent(new Event('fcp:cart-updated'));
      const sessionRef = await getGuestSessionId();
      void recordWatchAndShopEvent(previewMediaId, 'ADD_TO_BAG', sessionRef).catch(() => {});
      setMessage('Added to bag.');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not add this item to your bag.');
    }
  }

  async function handleWishlist() {
    if (!selectedVariant) {
      setMessage('Select an available size first.');
      return;
    }
    try {
      await addToWishlist(selectedVariant.skuId);
      window.dispatchEvent(new Event('fcp:wishlist-updated'));
      setMessage('Saved to wishlist.');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not save this item.');
    }
  }

  if (items.length === 0) {
    return (
      <div className="mx-auto max-w-[1440px] px-gutter py-20 text-center">
        <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--color-primary)]">Watch &amp; Shop</p>
        <h1 className="mt-2 font-display text-4xl text-[#181716]">Stories are being prepared</h1>
        <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-[#6e6359]">Published shoppable media will appear here as soon as it is available.</p>
      </div>
    );
  }

  return (
    <>
      <div className="bg-[#0f0d0c]">
        {items.map((item, index) => (
          <section
            key={item.id}
            data-media-id={item.id}
            className="min-h-[calc(100svh-80px)] snap-start border-b border-white/10 text-white lg:min-h-0"
          >
            <div className="mx-auto grid min-h-[calc(100svh-80px)] max-w-[1440px] items-center gap-0 lg:min-h-0 lg:grid-cols-[minmax(0,1.2fr)_minmax(340px,.8fr)] lg:gap-12 lg:px-gutter lg:py-12">
              <div className="relative min-h-[68svh] overflow-hidden bg-black lg:min-h-0 lg:aspect-[4/5] lg:rounded-[24px]">
                {item.mediaUrl.match(/\.(mp4|webm|mov)(\?|$)/i) ? (
                  <video src={item.mediaUrl} poster={item.thumbnailUrl ?? undefined} controls playsInline preload={index === 0 ? 'metadata' : 'none'} className="absolute inset-0 h-full w-full object-cover" />
                ) : item.thumbnailUrl || item.mediaUrl ? (
                  <Image src={item.thumbnailUrl ?? item.mediaUrl} alt={item.title} fill priority={index === 0} sizes="(max-width: 1024px) 100vw, 60vw" className="object-cover" />
                ) : null}
                <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-transparent to-black/15" />
                <div className="absolute inset-x-0 bottom-0 p-6 lg:hidden">
                  <p className="text-[10px] uppercase tracking-[0.18em] text-white/75">{item.creatorAttribution ?? 'VANYA edit'}</p>
                  <h1 className="mt-2 font-display text-3xl leading-tight">{item.title}</h1>
                </div>
              </div>

              <div className="bg-[#faf8f5] p-5 text-[#181716] lg:rounded-[24px] lg:p-8">
                <p className="hidden text-[10px] font-semibold uppercase tracking-[0.20em] text-[var(--color-primary)] lg:block">{item.creatorAttribution ?? 'VANYA edit'}</p>
                <h2 className="hidden mt-2 font-display text-4xl leading-tight lg:block">{item.title}</h2>
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#6e6359] lg:mt-8">Shop this story</p>
                <ul className="mt-3 divide-y divide-border border-y border-border">
                  {item.tags.map((tag) => (
                    <li key={tag.id}>
                      <button
                        type="button"
                        onClick={() => void openProduct(item.id, tag.style.id)}
                        className="flex min-h-[64px] w-full items-center justify-between gap-4 py-3 text-left text-sm text-[#181716] transition-colors hover:text-[var(--color-primary)]"
                      >
                        <span>{tag.style.name}{tag.colour ? ' · ' + tag.colour.name : ''}{tag.size ? ' · ' + tag.size.label : ''}</span>
                        <span aria-hidden>&rarr;</span>
                      </button>
                    </li>
                  ))}
                </ul>
                {item.tags.length === 0 ? <p className="mt-4 text-sm text-[#6e6359]">No products are tagged in this story yet.</p> : null}
              </div>
            </div>
          </section>
        ))}
      </div>

      {preview ? (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/45 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="Product preview" onClick={() => setPreview(null)}>
          <div className="h-full w-full max-w-lg overflow-y-auto bg-[#faf8f5] p-5 shadow-2xl sm:p-7" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-start justify-between">
              <div>
                <p className="text-[10px] uppercase tracking-[0.18em] text-[var(--color-primary)]">Shop the story</p>
                <h2 className="mt-1 font-display text-3xl text-[#181716]">{preview.name}</h2>
              </div>
              <button type="button" onClick={() => setPreview(null)} className="min-h-[44px] min-w-[44px] text-xl" aria-label="Close product preview">×</button>
            </div>

            {preview.media[0]?.url ? (
              <div className="relative mt-5 aspect-[4/5] overflow-hidden rounded-[20px] bg-white">
                <Image src={preview.media[0].url} alt={preview.name} fill sizes="500px" className="object-cover" />
              </div>
            ) : null}

            <div className="mt-5 flex items-baseline gap-2">
              <span className="text-lg font-semibold">&#8377;{preview.sellingPrice}</span>
              {preview.isMarkdown ? <span className="text-sm text-[#73685c] line-through">&#8377;{preview.mrp}</span> : null}
            </div>

            <fieldset className="mt-6">
              <legend className="text-xs font-semibold uppercase tracking-[0.12em]">Colour</legend>
              <div className="mt-3 flex flex-wrap gap-2">
                {[...new Map(preview.variants.map((variant) => [variant.colourId, variant])).values()].map((variant) => (
                  <button
                    key={variant.colourId}
                    type="button"
                    onClick={() => { setSelectedColourId(variant.colourId); setSelectedSizeId(null); }}
                    className={'rounded-full border px-4 py-2 text-xs ' + (selectedColourId === variant.colourId ? 'border-[#181716] bg-[#181716] text-white' : 'border-[#d8d0c6] bg-white')}
                  >
                    {variant.colourName}
                  </button>
                ))}
              </div>
            </fieldset>

            <fieldset className="mt-6">
              <legend className="text-xs font-semibold uppercase tracking-[0.12em]">Size</legend>
              <div className="mt-3 flex flex-wrap gap-2">
                {variants.map((variant) => (
                  <button
                    key={variant.sizeId}
                    type="button"
                    disabled={!variant.inStock}
                    onClick={() => setSelectedSizeId(variant.sizeId)}
                    className={'min-h-[42px] min-w-[50px] rounded-full border px-3 text-xs ' + (selectedSizeId === variant.sizeId ? 'border-[#181716] bg-[#181716] text-white' : 'border-[#d8d0c6] bg-white') + (!variant.inStock ? ' opacity-40 line-through' : '')}
                  >
                    {variant.sizeLabel}
                  </button>
                ))}
              </div>
            </fieldset>

            {message ? <p role="status" className="mt-4 text-sm text-[#5f554c]">{message}</p> : null}

            <div className="mt-6 grid grid-cols-[1fr_auto] gap-2">
              <button type="button" onClick={() => void handleAddToBag()} className="min-h-[50px] rounded-full bg-[var(--color-primary)] px-6 text-xs font-semibold uppercase tracking-[0.14em] text-white">Add to Bag</button>
              <button type="button" onClick={() => void handleWishlist()} className="min-h-[50px] rounded-full border border-[#d8d0c6] px-5 text-xs font-semibold uppercase tracking-[0.10em]">Save</button>
            </div>
            <Link href={'/product/' + preview.id} className="mt-4 inline-flex min-h-[44px] items-center text-xs font-semibold uppercase tracking-[0.12em] underline underline-offset-4">View full details &rarr;</Link>
          </div>
        </div>
      ) : null}
    </>
  );
}
