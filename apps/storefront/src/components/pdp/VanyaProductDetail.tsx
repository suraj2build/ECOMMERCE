'use client';

import Image from 'next/image';
import { useMemo, useState } from 'react';
import type { ProductDetail } from '@/lib/api';
import { addToCart, addToWishlist } from '@/lib/cart';

export function VanyaProductDetail({ product }: { product: ProductDetail }) {
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

  const defaultColourId =
    product.variants.find((variant) => variant.inStock)?.colourId ??
    product.variants[0]?.colourId ??
    null;

  const [selectedColourId, setSelectedColourId] = useState<string | null>(defaultColourId);
  const [selectedSizeId, setSelectedSizeId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [wishlistMessage, setWishlistMessage] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [sizeGuideOpen, setSizeGuideOpen] = useState(false);

  const variants = product.variants.filter((variant) => variant.colourId === selectedColourId);
  const selectedVariant = variants.find((variant) => variant.sizeId === selectedSizeId) ?? null;
  const gallery = product.media.filter((item) => item.colourId === selectedColourId || item.colourId === null);
  const visibleGallery = gallery.length > 0 ? gallery : product.media;
  const selectedColour = colours.find((colour) => colour.id === selectedColourId);

  async function handleAddToBag() {
    if (!selectedSizeId) {
      setMessage('Please select a size before adding to bag.');
      return;
    }
    if (!selectedVariant?.inStock) {
      setMessage('This size is currently out of stock.');
      return;
    }

    setAdding(true);
    setMessage(null);
    try {
      await addToCart(selectedVariant.skuId, 1);
      window.dispatchEvent(new Event('fcp:cart-updated'));
      setMessage('Added to bag.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not add this item to your bag.');
    } finally {
      setAdding(false);
    }
  }

  async function handleWishlist() {
    if (!selectedVariant) {
      setWishlistMessage('Please select a colour and size first.');
      return;
    }
    setWishlistMessage(null);
    try {
      await addToWishlist(selectedVariant.skuId);
      window.dispatchEvent(new Event('fcp:wishlist-updated'));
      setWishlistMessage('Saved to wishlist.');
    } catch (error) {
      setWishlistMessage(error instanceof Error ? error.message : 'Could not save this item.');
    }
  }

  return (
    <>
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1.15fr)_minmax(360px,.85fr)] lg:gap-12">
        <div>
          {visibleGallery.length > 0 ? (
            <div className="grid grid-cols-2 gap-2 sm:gap-3">
              {visibleGallery.map((item, index) => (
                <div
                  key={item.url + index}
                  className={`relative overflow-hidden rounded-[20px] bg-[var(--color-surface-soft)] ${index === 0 ? 'col-span-2 aspect-[4/5] sm:aspect-[6/5]' : 'aspect-[3/4]'}`}
                >
                  <Image
                    src={item.url}
                    alt={item.altText ?? product.name}
                    fill
                    priority={index === 0}
                    sizes={index === 0 ? '(max-width:1024px) 100vw, 58vw' : '(max-width:1024px) 50vw, 29vw'}
                    className="object-cover"
                  />
                </div>
              ))}
            </div>
          ) : (
            <div className="flex aspect-[4/5] items-center justify-center rounded-[20px] bg-[var(--color-surface-soft)] text-xs uppercase tracking-[0.16em] text-ink-muted">
              Product imagery coming soon
            </div>
          )}
        </div>

        <aside className="lg:sticky lg:top-28 lg:h-fit">
          <p className="text-[9px] font-semibold uppercase tracking-[0.18em] text-accent">{product.brandName}</p>
          <h1 className="mt-2 font-display text-3xl leading-tight tracking-[-0.025em] text-ink sm:text-4xl">{product.name}</h1>

          <div className="mt-4 flex items-baseline gap-3">
            <span className={`text-xl font-semibold ${product.isMarkdown ? 'text-danger' : 'text-ink'}`}>&#8377;{product.sellingPrice}</span>
            {product.isMarkdown && <span className="text-sm text-ink-muted line-through">&#8377;{product.mrp}</span>}
          </div>

          {product.ratingSummary.reviewCount > 0 && product.ratingSummary.averageRating !== null && (
            <p className="mt-2 text-xs text-ink-muted">
              ★ {product.ratingSummary.averageRating.toFixed(1)} · {product.ratingSummary.reviewCount} review{product.ratingSummary.reviewCount === 1 ? '' : 's'}
            </p>
          )}

          {colours.length > 0 && (
            <fieldset className="mt-8 border-t border-border pt-6">
              <legend className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ink">
                Colour · <span className="font-normal text-ink-muted">{selectedColour?.name}</span>
              </legend>
              <div className="mt-3 flex flex-wrap gap-2">
                {colours.map((colour) => (
                  <button
                    key={colour.id}
                    type="button"
                    onClick={() => {
                      setSelectedColourId(colour.id);
                      setSelectedSizeId(null);
                      setMessage(null);
                    }}
                    aria-pressed={selectedColourId === colour.id}
                    aria-label={colour.name}
                    title={colour.name}
                    className={`h-9 w-9 rounded-full border-2 p-0.5 transition-transform ${selectedColourId === colour.id ? 'scale-110 border-ink' : 'border-border'}`}
                  >
                    <span className="block h-full w-full rounded-full border border-black/10" style={colour.hexSwatch ? { backgroundColor: colour.hexSwatch } : undefined} />
                  </button>
                ))}
              </div>
            </fieldset>
          )}

          <fieldset className="mt-7">
            <div className="flex items-center justify-between">
              <legend className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ink">Size</legend>
              {product.sizeChart && (
                <button type="button" onClick={() => setSizeGuideOpen(true)} className="text-[10px] font-medium uppercase tracking-[0.12em] text-ink underline underline-offset-4">
                  Size guide
                </button>
              )}
            </div>
            <div className="mt-3 grid grid-cols-5 gap-2">
              {variants.map((variant) => (
                <button
                  key={variant.sizeId}
                  type="button"
                  disabled={!variant.inStock}
                  onClick={() => {
                    setSelectedSizeId(variant.sizeId);
                    setMessage(null);
                  }}
                  aria-pressed={selectedSizeId === variant.sizeId}
                  className={`min-h-[46px] rounded-full border px-3 text-xs font-semibold transition-colors ${selectedSizeId === variant.sizeId ? 'border-ink bg-ink text-canvas' : 'border-border bg-surface text-ink'} ${!variant.inStock ? 'cursor-not-allowed opacity-35 line-through' : 'hover:border-ink'}`}
                >
                  {variant.sizeLabel}
                </button>
              ))}
            </div>
          </fieldset>

          <div className="mt-7 grid grid-cols-[1fr_auto] gap-2">
            <button
              type="button"
              onClick={handleAddToBag}
              disabled={adding}
              className="min-h-[50px] rounded-full bg-accent px-6 text-[10px] font-semibold uppercase tracking-[0.17em] text-accent-ink transition-colors hover:bg-[var(--color-accent-hover)] disabled:opacity-60"
            >
              {adding ? 'Adding…' : 'Add to Bag'}
            </button>
            <button
              type="button"
              onClick={handleWishlist}
              aria-label="Save"
              className="min-h-[50px] min-w-[50px] rounded-full border border-border bg-surface px-4 text-lg text-ink hover:border-ink"
            >
              ♡
            </button>
          </div>

          {message && <p role="status" className="mt-2 text-xs text-ink-muted">{message}</p>}
          {wishlistMessage && <p role="status" className="mt-1 text-xs text-ink-muted">{wishlistMessage}</p>}

          <dl className="mt-8 space-y-5 border-t border-border pt-6">
            <EditorialDetail label="Fabric" value={product.fabric} />
            <EditorialDetail label="Fit" value={product.fit} />
            <EditorialDetail label="Occasion" value={product.occasion} />
            <EditorialDetail label="Pattern" value={product.pattern} />
            <EditorialDetail label="Care" value={product.washCare} />
            <EditorialDetail label="Made in" value={product.countryOfOrigin} />
          </dl>

          <div className="mt-8 grid grid-cols-3 gap-2 border-y border-border py-5 text-center">
            <Promise title="Live stock" body="Availability verified" />
            <Promise title="Secure" body="COD & online" />
            <Promise title="Easy" body="Returns flow" />
          </div>
        </aside>
      </div>

      {sizeGuideOpen && product.sizeChart && (
        <div className="fixed inset-0 z-[90] flex items-end justify-center bg-black/55 p-0 sm:items-center sm:p-6" role="presentation">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="size-guide-title"
            className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-t-[24px] bg-surface p-6 sm:rounded-[24px]"
          >
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[9px] font-semibold uppercase tracking-[0.18em] text-accent">VANYA fit guide</p>
                <h2 id="size-guide-title" className="mt-1 font-display text-2xl text-ink">{product.sizeChart.name}</h2>
              </div>
              <button type="button" onClick={() => setSizeGuideOpen(false)} className="h-11 w-11 rounded-full border border-border text-lg text-ink" aria-label="Close size guide">×</button>
            </div>
            <div className="mt-5 overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead><tr className="border-b border-border"><th className="py-3 pr-4 text-ink">Size</th><th className="py-3 text-ink">Measurements</th></tr></thead>
                <tbody>
                  {product.sizeChart.entries.map((entry) => (
                    <tr key={entry.sizeLabel} className="border-b border-border">
                      <td className="py-3 pr-4 font-semibold text-ink">{entry.sizeLabel}</td>
                      <td className="py-3 text-ink-muted">{Object.entries(entry.measurements).map(([key, value]) => `${key}: ${String(value)}`).join(' · ')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function EditorialDetail({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div className="grid grid-cols-[90px_1fr] gap-4 text-xs leading-5">
      <dt className="font-semibold uppercase tracking-[0.1em] text-ink">{label}</dt>
      <dd className="text-ink-muted">{value}</dd>
    </div>
  );
}

function Promise({ title, body }: { title: string; body: string }) {
  return (
    <div>
      <p className="text-[9px] font-semibold uppercase tracking-[0.13em] text-ink">{title}</p>
      <p className="mt-1 text-[9px] text-ink-muted">{body}</p>
    </div>
  );
}
