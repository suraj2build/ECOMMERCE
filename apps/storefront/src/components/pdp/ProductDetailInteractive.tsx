'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Image from 'next/image';
import type { ProductDetail } from '@/lib/api';
import { addToCart, addToWishlist } from '@/lib/cart';
import { getStoredSession } from '@/lib/customer-auth';
import { recordProductView } from '@/lib/account';
import { buttonClassName } from '../ui/Button';

/**
 * Owns all client-side interaction on the PDP (M11/M12, specs/10-pdp.md,
 * specs/11-wishlist-cart.md): image gallery, colour/size selection (and
 * the availability/price/image updates that follow from it), size chart,
 * and add-to-bag/save-to-wishlist. Add-to-bag calls the real Cart API
 * (M12) now that it exists - notably it never calls anything
 * inventory-reservation-related (INV-002: adding to cart must not
 * reserve stock, only checkout does, M13's own milestone).
 */
export function ProductDetailInteractive({ product }: { product: ProductDetail }) {
  const colours = useMemo(() => {
    const map = new Map<string, { id: string; name: string; hexSwatch: string | null }>();
    for (const v of product.variants) {
      if (!map.has(v.colourId)) map.set(v.colourId, { id: v.colourId, name: v.colourName, hexSwatch: v.hexSwatch });
    }
    return [...map.values()];
  }, [product.variants]);

  const defaultColourId = useMemo(() => {
    const firstInStock = product.variants.find((v) => v.inStock);
    return (firstInStock ?? product.variants[0])?.colourId ?? null;
  }, [product.variants]);

  // M22 Customer 360: authenticated-customer-only "recently viewed" log
  // (never guest-tracked) - a genuine failure here (network, expired
  // token) must never block or degrade the PDP itself, so it's a fire-
  // and-forget best-effort call.
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

  const sizesForColour = product.variants.filter((v) => v.colourId === selectedColourId);
  const selectedVariant = sizesForColour.find((v) => v.sizeId === selectedSizeId) ?? null;

  const galleryMedia = useMemo(() => {
    const forColour = product.media.filter((m) => m.colourId === selectedColourId || m.colourId === null);
    return forColour.length > 0 ? forColour : product.media;
  }, [product.media, selectedColourId]);

  const galleryRef = useRef<HTMLDivElement>(null);
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

  const allOutOfStock = product.variants.every((v) => !v.inStock);

  return (
    <div className="grid gap-8 md:grid-cols-2 md:gap-12">
      {/* Image gallery: native horizontal swipe on mobile via scroll-snap, thumbnail strip on desktop. */}
      <div className="md:flex md:gap-4">
        <div className="hidden shrink-0 flex-col gap-2 md:flex">
          {galleryMedia.map((m, i) => (
            <button
              key={m.url + i}
              type="button"
              onClick={() => scrollToImage(i)}
              className="relative h-20 w-16 overflow-hidden rounded-sm bg-surface focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
              aria-label={`View image ${i + 1}`}
            >
              <Image src={m.url} alt={m.altText ?? ''} fill sizes="64px" className="object-cover" />
            </button>
          ))}
        </div>
        <div
          ref={galleryRef}
          className="flex snap-x snap-mandatory gap-0 overflow-x-auto rounded-sm bg-surface md:flex-1"
          style={{ scrollbarWidth: 'none' }}
        >
          {galleryMedia.length === 0 ? (
            <div className="flex aspect-[3/4] w-full shrink-0 items-center justify-center text-sm text-ink-muted">
              No image available
            </div>
          ) : (
            galleryMedia.map((m, i) => (
              <div
                key={m.url + i}
                ref={(el) => {
                  imageRefs.current[i] = el;
                }}
                className="relative aspect-[3/4] w-full shrink-0 snap-start"
              >
                <Image
                  src={m.url}
                  alt={m.altText ?? product.name}
                  fill
                  sizes="(max-width: 768px) 100vw, 50vw"
                  priority={i === 0}
                  className="object-cover"
                />
              </div>
            ))
          )}
        </div>
      </div>

      {/* Details, variant selection, add-to-bag */}
      <div>
        <p className="text-xs uppercase tracking-wide text-ink-muted">{product.brandName}</p>
        <h1 className="mt-1 font-display text-2xl text-ink">{product.name}</h1>

        <div className="mt-3 flex items-center gap-3">
          <span className={product.isMarkdown ? 'text-danger text-lg' : 'text-lg text-ink'}>
            &#8377;{product.sellingPrice}
          </span>
          {product.isMarkdown && <span className="text-ink-muted line-through">&#8377;{product.mrp}</span>}
        </div>

        {product.ratingSummary.reviewCount > 0 && product.ratingSummary.averageRating !== null && (
          <p className="mt-2 text-sm text-ink-muted">
            {product.ratingSummary.averageRating.toFixed(1)} &#9733; ({product.ratingSummary.reviewCount} review
            {product.ratingSummary.reviewCount === 1 ? '' : 's'})
          </p>
        )}

        {colours.length > 0 && (
          <fieldset className="mt-6">
            <legend className="text-sm font-medium text-ink">Colour: {colours.find((c) => c.id === selectedColourId)?.name}</legend>
            <div className="mt-2 flex flex-wrap gap-2">
              {colours.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => handleColourSelect(c.id)}
                  aria-pressed={selectedColourId === c.id}
                  className={`h-10 w-10 rounded-full border-2 ${selectedColourId === c.id ? 'border-ink' : 'border-border'}`}
                  style={c.hexSwatch ? { backgroundColor: c.hexSwatch } : undefined}
                  aria-label={c.name}
                  title={c.name}
                >
                  {!c.hexSwatch && <span className="sr-only">{c.name}</span>}
                </button>
              ))}
            </div>
          </fieldset>
        )}

        <fieldset className="mt-6">
          <div className="flex items-center justify-between">
            <legend className="text-sm font-medium text-ink">Size</legend>
            {product.sizeChart && (
              <button type="button" onClick={() => setShowSizeChart(true)} className="text-sm text-ink underline">
                Size chart
              </button>
            )}
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {sizesForColour.map((v) => (
              <button
                key={v.sizeId}
                type="button"
                disabled={!v.inStock}
                onClick={() => {
                  setSelectedSizeId(v.sizeId);
                  setAddToBagMessage(null);
                }}
                aria-pressed={selectedSizeId === v.sizeId}
                className={`min-h-[44px] min-w-[44px] rounded-sm border px-4 text-sm ${
                  selectedSizeId === v.sizeId ? 'border-ink bg-ink text-canvas' : 'border-border text-ink'
                } ${!v.inStock ? 'cursor-not-allowed opacity-40 line-through' : ''}`}
              >
                {v.sizeLabel}
              </button>
            ))}
          </div>
          {allOutOfStock && <p className="mt-2 text-sm text-ink-muted">Out of stock in all sizes right now.</p>}
        </fieldset>

        <div className="mt-6 hidden md:block">
          <div className="flex gap-3">
            <button
              type="button"
              onClick={handleAddToBag}
              disabled={addingToBag}
              className={buttonClassName('primary', 'flex-1')}
            >
              {addingToBag ? 'Adding...' : 'Add to Bag'}
            </button>
            <button type="button" onClick={handleSaveToWishlist} className={buttonClassName('secondary')}>
              Save
            </button>
          </div>
          {addToBagMessage && <p role="status" className="mt-2 text-sm text-ink-muted">{addToBagMessage}</p>}
          {wishlistMessage && <p role="status" className="mt-1 text-sm text-ink-muted">{wishlistMessage}</p>}
        </div>

        {(product.fabric || product.fit || product.washCare || product.countryOfOrigin) && (
          <dl className="mt-8 space-y-2 border-t border-border pt-6 text-sm">
            {product.fabric && (
              <div className="flex gap-2">
                <dt className="w-32 text-ink-muted">Fabric</dt>
                <dd className="text-ink">{product.fabric}</dd>
              </div>
            )}
            {product.fit && (
              <div className="flex gap-2">
                <dt className="w-32 text-ink-muted">Fit</dt>
                <dd className="text-ink">{product.fit}</dd>
              </div>
            )}
            {product.washCare && (
              <div className="flex gap-2">
                <dt className="w-32 text-ink-muted">Care</dt>
                <dd className="text-ink">{product.washCare}</dd>
              </div>
            )}
            {product.countryOfOrigin && (
              <div className="flex gap-2">
                <dt className="w-32 text-ink-muted">Origin</dt>
                <dd className="text-ink">{product.countryOfOrigin}</dd>
              </div>
            )}
          </dl>
        )}
      </div>

      {/* Mobile sticky add-to-bag bar (acceptance/m11-pdp.md mobile behavior). */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-canvas p-4 md:hidden">
        {addToBagMessage && <p role="status" className="mb-2 text-xs text-ink-muted">{addToBagMessage}</p>}
        <div className="flex items-center gap-4">
          <span className="text-base text-ink">&#8377;{product.sellingPrice}</span>
          <button
            type="button"
            onClick={handleAddToBag}
            disabled={addingToBag}
            className={buttonClassName('primary', 'flex-1')}
          >
            {addingToBag ? 'Adding...' : 'Add to Bag'}
          </button>
        </div>
      </div>

      {showSizeChart && product.sizeChart && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Size chart"
          className="fixed inset-0 z-40 flex items-end justify-center bg-ink/50 md:items-center"
        >
          <div className="max-h-[80vh] w-full max-w-md overflow-y-auto rounded-t-sm bg-canvas p-6 md:rounded-sm">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-lg text-ink">{product.sizeChart.name}</h2>
              <button type="button" onClick={() => setShowSizeChart(false)} aria-label="Close size chart" className="text-ink">
                &#10005;
              </button>
            </div>
            <table className="mt-4 w-full text-left text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="py-2 text-ink-muted">Size</th>
                  {Object.keys(product.sizeChart.entries[0]?.measurements ?? {}).map((key) => (
                    <th key={key} className="py-2 text-ink-muted">
                      {key}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {product.sizeChart.entries.map((entry) => (
                  <tr key={entry.sizeLabel} className="border-b border-border">
                    <td className="py-2 text-ink">{entry.sizeLabel}</td>
                    {Object.values(entry.measurements).map((val, i) => (
                      <td key={i} className="py-2 text-ink">
                        {String(val)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
