'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Image from 'next/image';
import type { ProductDetail } from '@/lib/api';
import { addToCart, addToWishlist } from '@/lib/cart';
import { getStoredSession } from '@/lib/customer-auth';
import { recordProductView } from '@/lib/account';

export function ProductDetailInteractive({ product }: { product: ProductDetail }) {
  const colours = useMemo(() => {
    const map = new Map<string, { id: string; name: string; hexSwatch: string | null }>();
    for (const variant of product.variants) {
      if (!map.has(variant.colourId)) {
        map.set(variant.colourId, {
          id: variant.colourId,
          name: variant.colourName,
          hexSwatch: variant.hexSwatch,
        });
      }
    }
    return [...map.values()];
  }, [product.variants]);

  const defaultColourId = useMemo(() => {
    const firstInStock = product.variants.find((variant) => variant.inStock);
    return (firstInStock ?? product.variants[0])?.colourId ?? null;
  }, [product.variants]);

  useEffect(() => {
    if (getStoredSession()) {
      void recordProductView(product.id).catch(() => {});
    }
  }, [product.id]);

  const [selectedColourId, setSelectedColourId] = useState<string | null>(defaultColourId);
  const [selectedSizeId, setSelectedSizeId] = useState<string | null>(null);
  const [addToBagMessage, setAddToBagMessage] = useState<string | null>(null);
  const [addingToBag, setAddingToBag] = useState(false);
  const [wishlistMessage, setWishlistMessage] = useState<string | null>(null);
  const [showSizeChart, setShowSizeChart] = useState(false);

  const sizesForColour = product.variants.filter((variant) => variant.colourId === selectedColourId);
  const selectedVariant = sizesForColour.find((variant) => variant.sizeId === selectedSizeId) ?? null;

  const galleryMedia = useMemo(() => {
    const forColour = product.media.filter((media) => media.colourId === selectedColourId || media.colourId === null);
    return forColour.length > 0 ? forColour : product.media;
  }, [product.media, selectedColourId]);

  const imageRefs = useRef<(HTMLDivElement | null)[]>([]);

  function scrollToImage(index: number) {
    imageRefs.current[index]?.scrollIntoView({ behavior: 'smooth', inline: 'start', block: 'nearest' });
  }

  function handleColourSelect(colourId: string) {
    setSelectedColourId(colourId);
    setSelectedSizeId(null);
    setAddToBagMessage(null);
  }

  async function handleAddToBag() {
    if (!selectedSizeId) {
      setAddToBagMessage('Please select a size before adding to bag.');
      return;
    }
    if (!selectedVariant || !selectedVariant.inStock) {
      setAddToBagMessage('This size is currently out of stock.');
      return;
    }
    setAddingToBag(true);
    setAddToBagMessage(null);
    try {
      await addToCart(selectedVariant.skuId, 1);
      window.dispatchEvent(new Event('fcp:cart-updated'));
      setAddToBagMessage('Added to bag.');
    } catch (err) {
      setAddToBagMessage(err instanceof Error ? err.message : 'Could not add this item to your bag.');
    } finally {
      setAddingToBag(false);
    }
  }

  async function handleSaveToWishlist() {
    if (!selectedVariant) {
      setWishlistMessage('Please select a colour and size first.');
      return;
    }
    try {
      await addToWishlist(selectedVariant.skuId);
      window.dispatchEvent(new Event('fcp:wishlist-updated'));
      setWishlistMessage('Saved to wishlist.');
    } catch (err) {
      setWishlistMessage(err instanceof Error ? err.message : 'Could not save this item.');
    }
  }

  const allOutOfStock = product.variants.every((variant) => !variant.inStock);
  const selectedColourName = colours.find((colour) => colour.id === selectedColourId)?.name;

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1.25fr)_minmax(360px,.75fr)] lg:gap-12">
      <div className="min-w-0">
        <div className="flex gap-3 overflow-x-auto snap-x snap-mandatory pb-2 lg:grid lg:grid-cols-2 lg:overflow-visible">
          {galleryMedia.length === 0 ? (
            <div className="flex aspect-[3/4] w-full shrink-0 items-center justify-center rounded-[20px] bg-[var(--color-surface-soft)] text-sm text-ink-muted lg:col-span-2">
              No image available
            </div>
          ) : (
            galleryMedia.map((media, index) => (
              <div
                key={media.url + index}
                ref={(element) => { imageRefs.current[index] = element; }}
                className="relative aspect-[3/4] w-[88vw] shrink-0 snap-center overflow-hidden rounded-[20px] bg-[var(--color-surface-soft)] sm:w-[70vw] lg:w-auto"
              >
                {media.type === 'IMAGE' ? (
                  <Image
                    src={media.url}
                    alt={media.altText ?? product.name}
                    fill
                    sizes="(max-width: 1024px) 90vw, 38vw"
                    priority={index === 0}
                    className="object-cover"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center bg-[#181716] p-6 text-center text-white">
                    <a
                      href={media.url}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded-full border border-white/70 px-6 py-3 text-xs font-semibold uppercase tracking-[0.14em] hover:bg-white hover:text-black"
                    >
                      View product video
                    </a>
                  </div>
                )}
              </div>
            ))
          )}
        </div>

        {galleryMedia.length > 1 ? (
          <div className="mt-3 hidden flex-wrap gap-2 lg:flex">
            {galleryMedia.map((media, index) => (
              <button
                key={media.url + index}
                type="button"
                onClick={() => scrollToImage(index)}
                className="relative h-20 w-16 overflow-hidden rounded-[10px] border border-border bg-white transition-opacity hover:opacity-80"
                aria-label={'View image ' + (index + 1)}
              >
                {media.type === 'IMAGE' ? <Image src={media.url} alt="" fill sizes="64px" className="object-cover" /> : <span className="text-[10px]">Video</span>}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <aside className="lg:sticky lg:top-28 lg:h-fit">
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--color-primary)]">{product.brandName}</p>
        <h1 className="mt-2 font-display text-3xl leading-tight text-[#181716] sm:text-4xl">{product.name}</h1>
        <p className="mt-2 text-xs uppercase tracking-[0.12em] text-[#6e6359]">{product.categoryName}</p>

        <div className="mt-5 flex items-baseline gap-3">
          <span className={product.isMarkdown ? 'text-xl font-semibold text-danger' : 'text-xl font-semibold text-[#181716]'}>
            &#8377;{product.sellingPrice}
          </span>
          {product.isMarkdown ? <span className="text-sm text-[#73685c] line-through">&#8377;{product.mrp}</span> : null}
          <span className="text-[10px] uppercase tracking-[0.12em] text-[#6e6359]">Tax included</span>
        </div>

        {product.ratingSummary.reviewCount > 0 && product.ratingSummary.averageRating !== null ? (
          <p className="mt-3 text-sm text-[#6e6359]">
            {product.ratingSummary.averageRating.toFixed(1)} &#9733; · {product.ratingSummary.reviewCount} review{product.ratingSummary.reviewCount === 1 ? '' : 's'}
          </p>
        ) : null}

        {colours.length > 0 ? (
          <fieldset className="mt-8 border-t border-border pt-6">
            <legend className="text-xs font-semibold uppercase tracking-[0.12em] text-[#181716]">Colour · {selectedColourName}</legend>
            <div className="mt-3 flex flex-wrap gap-3">
              {colours.map((colour) => (
                <button
                  key={colour.id}
                  type="button"
                  onClick={() => handleColourSelect(colour.id)}
                  aria-pressed={selectedColourId === colour.id}
                  className={
                    'h-11 w-11 rounded-full border-2 p-1 transition-transform hover:scale-105 ' +
                    (selectedColourId === colour.id ? 'border-[#181716]' : 'border-[#d8d0c6]')
                  }
                  aria-label={colour.name}
                  title={colour.name}
                >
                  <span
                    className="block h-full w-full rounded-full border border-black/10 bg-[var(--color-surface-soft)]"
                    style={colour.hexSwatch ? { backgroundColor: colour.hexSwatch } : undefined}
                  />
                </button>
              ))}
            </div>
          </fieldset>
        ) : null}

        <fieldset className="mt-7">
          <div className="flex items-center justify-between">
            <legend className="text-xs font-semibold uppercase tracking-[0.12em] text-[#181716]">Select size</legend>
            {product.sizeChart ? (
              <button type="button" onClick={() => setShowSizeChart(true)} className="min-h-[36px] text-xs text-[#5f554c] underline underline-offset-4">
                Size guide
              </button>
            ) : null}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {sizesForColour.map((variant) => (
              <button
                key={variant.sizeId}
                type="button"
                disabled={!variant.inStock}
                onClick={() => {
                  setSelectedSizeId(variant.sizeId);
                  setAddToBagMessage(null);
                }}
                aria-pressed={selectedSizeId === variant.sizeId}
                className={
                  'min-h-[46px] min-w-[54px] rounded-full border px-4 text-sm font-medium transition-all ' +
                  (selectedSizeId === variant.sizeId
                    ? 'border-[#181716] bg-[#181716] text-white'
                    : 'border-[#d8d0c6] bg-white text-[#181716] hover:border-[#181716]') +
                  (!variant.inStock ? ' cursor-not-allowed opacity-40 line-through' : '')
                }
              >
                {variant.sizeLabel}
              </button>
            ))}
          </div>
          {allOutOfStock ? <p className="mt-3 text-sm text-danger">Out of stock in all sizes right now.</p> : null}
        </fieldset>

        <div className="mt-7 hidden gap-3 md:flex">
          <button
            type="button"
            onClick={handleAddToBag}
            disabled={addingToBag}
            className="min-h-[50px] flex-1 rounded-full bg-[var(--color-primary)] px-6 text-xs font-semibold uppercase tracking-[0.16em] text-white transition-all hover:bg-[var(--color-primary-hover)] disabled:opacity-60"
          >
            {addingToBag ? 'Adding…' : 'Add to Bag'}
          </button>
          <button
            type="button"
            onClick={handleSaveToWishlist}
            className="min-h-[50px] rounded-full border border-[#d7cec2] bg-white px-5 text-xs font-semibold uppercase tracking-[0.12em] text-[#181716] hover:border-[#181716]"
          >
            Save
          </button>
        </div>

        {addToBagMessage ? <p role="status" className="mt-3 text-sm text-[#5f554c]">{addToBagMessage}</p> : null}
        {wishlistMessage ? <p role="status" className="mt-2 text-sm text-[#5f554c]">{wishlistMessage}</p> : null}

        <div className="mt-8 grid grid-cols-2 gap-2 border-y border-border py-5 text-[10px] uppercase tracking-[0.12em] text-[#5f554c]">
          <span>Real-time availability</span>
          <span>Secure checkout</span>
          <span>Delivery serviceability</span>
          <span>Easy returns</span>
        </div>

        {(product.fabric || product.fit || product.pattern || product.occasion || product.washCare || product.countryOfOrigin) ? (
          <dl className="mt-6 divide-y divide-border border-y border-border text-sm">
            {product.fabric ? <div className="grid grid-cols-[110px_1fr] gap-3 py-3"><dt className="text-[#6e6359]">Fabric</dt><dd className="text-[#181716]">{product.fabric}</dd></div> : null}
            {product.fit ? <div className="grid grid-cols-[110px_1fr] gap-3 py-3"><dt className="text-[#6e6359]">Fit</dt><dd className="text-[#181716]">{product.fit}</dd></div> : null}
            {product.pattern ? <div className="grid grid-cols-[110px_1fr] gap-3 py-3"><dt className="text-[#6e6359]">Pattern</dt><dd className="text-[#181716]">{product.pattern}</dd></div> : null}
            {product.occasion ? <div className="grid grid-cols-[110px_1fr] gap-3 py-3"><dt className="text-[#6e6359]">Occasion</dt><dd className="text-[#181716]">{product.occasion}</dd></div> : null}
            {product.washCare ? <div className="grid grid-cols-[110px_1fr] gap-3 py-3"><dt className="text-[#6e6359]">Care</dt><dd className="text-[#181716]">{product.washCare}</dd></div> : null}
            {product.countryOfOrigin ? <div className="grid grid-cols-[110px_1fr] gap-3 py-3"><dt className="text-[#6e6359]">Origin</dt><dd className="text-[#181716]">{product.countryOfOrigin}</dd></div> : null}
          </dl>
        ) : null}
      </aside>

      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-[#ddd4c8] bg-white/95 p-3 backdrop-blur-md md:hidden">
        {addToBagMessage ? <p role="status" className="mb-2 text-xs text-[#5f554c]">{addToBagMessage}</p> : null}
        <div className="flex items-center gap-3">
          <span className="min-w-fit text-base font-semibold text-[#181716]">&#8377;{product.sellingPrice}</span>
          <button
            type="button"
            onClick={handleAddToBag}
            disabled={addingToBag}
            className="min-h-[48px] flex-1 rounded-full bg-[var(--color-primary)] px-5 text-xs font-semibold uppercase tracking-[0.14em] text-white disabled:opacity-60"
          >
            {addingToBag ? 'Adding…' : 'Add to Bag'}
          </button>
          <button type="button" onClick={handleSaveToWishlist} className="min-h-[48px] min-w-[48px] rounded-full border border-[#d7cec2] text-lg" aria-label="Save to wishlist">♡</button>
        </div>
      </div>

      {showSizeChart && product.sizeChart ? (
        <div role="dialog" aria-modal="true" aria-label="Size chart" className="fixed inset-0 z-50 flex items-end justify-center bg-black/55 p-0 md:items-center md:p-6">
          <div className="max-h-[82vh] w-full max-w-lg overflow-y-auto rounded-t-[24px] bg-white p-6 shadow-2xl md:rounded-[24px]">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[10px] uppercase tracking-[0.18em] text-[var(--color-primary)]">VANYA fit guide</p>
                <h2 className="mt-1 font-display text-2xl text-[#181716]">{product.sizeChart.name}</h2>
              </div>
              <button type="button" onClick={() => setShowSizeChart(false)} aria-label="Close size chart" className="min-h-[44px] min-w-[44px] text-xl text-[#181716]">×</button>
            </div>
            <table className="mt-5 w-full text-left text-sm">
              <thead><tr className="border-b border-border"><th className="py-2 text-[#5f554c]">Size</th>{Object.keys(product.sizeChart.entries[0]?.measurements ?? {}).map((key) => <th key={key} className="py-2 text-[#5f554c]">{key}</th>)}</tr></thead>
              <tbody>
                {product.sizeChart.entries.map((entry) => (
                  <tr key={entry.sizeLabel} className="border-b border-border">
                    <td className="py-3 font-medium text-[#181716]">{entry.sizeLabel}</td>
                    {Object.values(entry.measurements).map((value, index) => <td key={index} className="py-3 text-[#181716]">{String(value)}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </div>
  );
}
