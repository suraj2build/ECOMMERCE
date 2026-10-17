'use client';

/**
 * The reel video + tagged-products rack, shared by the full /watch-and-shop
 * page and the reel-viewing modal (specs/35-watch-and-shop.md's 2026-10-17
 * addendum). Navigation is horizontal (left/right), superseding the
 * approved AI Studio design's vertical chevrons per that addendum - nothing
 * else about the approved visual design changes. `onClose` is only passed
 * when this is rendered inside a modal; the full page omits it.
 */
import React, { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Play, Volume2, VolumeX, ChevronLeft, ChevronRight, ShoppingBag, X, Check } from 'lucide-react';
import type { ProductDetail } from '@/lib/api';
import type { ShoppableReel } from '../types';
import { useModalFocus } from '@/components/layout/useModalFocus';
import { formatPrice } from '../utils/format';
import { detailToProduct, NO_SWATCH } from '../bridge/adapters';
import { useShop } from '../bridge/shop';

export function ReelViewer({
  reels,
  activeIndex,
  onNavigate,
  onClose,
}: {
  reels: ShoppableReel[];
  activeIndex: number;
  onNavigate: (index: number) => void;
  onClose?: () => void;
}) {
  const shop = useShop();
  const [isPlaying, setIsPlaying] = useState(true);
  const [isMuted, setIsMuted] = useState(true);
  const [details, setDetails] = useState<Record<string, ProductDetail>>({});
  const [sheetFor, setSheetFor] = useState<ProductDetail | null>(null);

  const currentReel = reels[activeIndex] || reels[0];
  const taggedProducts = (currentReel?.taggedProductIds ?? [])
    .map((id) => details[id])
    .filter((d): d is ProductDetail => Boolean(d))
    .map((d) => ({ detail: d, product: detailToProduct(d) }));

  useEffect(() => {
    if (!currentReel) return;
    let active = true;
    for (const id of currentReel.taggedProductIds) {
      if (details[id]) continue;
      shop.loadProduct(id).then((d) => { if (active) setDetails((prev) => ({ ...prev, [id]: d })); }).catch(() => {});
    }
    return () => { active = false; };
  }, [currentReel?.id]);

  const videoRef = useRef<HTMLVideoElement>(null);

  const togglePlay = () => {
    if (videoRef.current) {
      if (isPlaying) videoRef.current.pause();
      else videoRef.current.play().catch(() => {});
    }
    setIsPlaying(!isPlaying);
  };

  const toggleMute = () => {
    if (videoRef.current) videoRef.current.muted = !isMuted;
    setIsMuted(!isMuted);
  };

  const go = (index: number) => {
    setIsPlaying(true);
    setSheetFor(null);
    onNavigate(index);
  };

  if (!currentReel) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center text-center space-y-2">
        <div>
          <h1 className="font-editorial text-3xl font-normal text-white">Watch &amp; Shop</h1>
          <p className="text-xs text-[#9E9084]">New styling stories are on their way.</p>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Main 9:16 Vertical Video Frame */}
        <div className="lg:col-span-7 flex items-center justify-center gap-3">
          {/* Left arrow (outer edge, not overlaid on the video) */}
          <button
            type="button"
            disabled={activeIndex === 0}
            onClick={() => go(activeIndex - 1)}
            className="hidden sm:flex w-11 h-11 shrink-0 rounded-full bg-black/40 backdrop-blur-md items-center justify-center text-white border border-white/20 disabled:opacity-20 hover:bg-black transition-colors"
            aria-label="Previous reel"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>

          <div className="relative w-full max-w-[380px] sm:max-w-[420px] aspect-[9/16] bg-black rounded-2xl overflow-hidden shadow-2xl border border-[#2B2621]">
            {currentReel.videoUrl ? (
              // Styling clips without speech; no caption files exist for them.
              // eslint-disable-next-line jsx-a11y/media-has-caption
              <video
                key={currentReel.id}
                ref={videoRef}
                src={currentReel.videoUrl}
                poster={currentReel.thumbnail}
                loop
                autoPlay
                muted={isMuted}
                playsInline
                aria-label={currentReel.title}
                className="w-full h-full object-cover"
              />
            ) : (
              <img src={currentReel.thumbnail} alt={currentReel.title} className="w-full h-full object-cover" />
            )}
            {currentReel.videoUrl && (
              <button type="button" onClick={togglePlay} aria-label={isPlaying ? 'Pause video' : 'Play video'} className="absolute inset-0 z-[5] cursor-pointer" />
            )}

            {/* Top Bar with Creator Info, Sound Control, and Close (modal only) */}
            <div className="absolute top-4 inset-x-4 flex items-center justify-between z-20 pointer-events-none">
              <div className="flex items-center gap-2.5 bg-black/40 backdrop-blur-md px-3 py-1.5 rounded-full border border-white/15">
                <span className="w-7 h-7 rounded-full border border-white/50 bg-[#2B2621] flex items-center justify-center text-[11px] font-semibold" aria-hidden="true">
                  {currentReel.creator.name.charAt(0)}
                </span>
                <div>
                  <span className="text-xs font-semibold block leading-tight">{currentReel.creator.name}</span>
                  {currentReel.creator.handle && <span className="text-[10px] text-[#D8CEBF]">{currentReel.creator.handle}</span>}
                </div>
              </div>

              <div className="flex items-center gap-2 pointer-events-auto">
                {currentReel.videoUrl && (
                  <button
                    type="button"
                    onClick={toggleMute}
                    className="w-10 h-10 rounded-full bg-black/40 backdrop-blur-md flex items-center justify-center text-white border border-white/15 hover:bg-black/60 transition-colors"
                    aria-label={isMuted ? 'Unmute' : 'Mute'}
                  >
                    {isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
                  </button>
                )}
                {onClose && (
                  <button
                    type="button"
                    onClick={onClose}
                    className="w-10 h-10 rounded-full bg-black/40 backdrop-blur-md flex items-center justify-center text-white border border-white/15 hover:bg-black/60 transition-colors"
                    aria-label="Close"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>

            {/* Center Play/Pause Overlay Indicator */}
            {!isPlaying && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/35 z-10 pointer-events-none">
                <div className="w-16 h-16 rounded-full bg-white/25 backdrop-blur-md flex items-center justify-center text-white">
                  <Play className="w-8 h-8 fill-white ml-1" />
                </div>
              </div>
            )}

            {/* Mobile-only horizontal nav, overlaid at the lower sides of the frame
                (no outer-edge room on a full-viewport mobile layout) */}
            <div className="sm:hidden absolute inset-y-0 left-2 flex items-center z-20">
              <button
                type="button"
                disabled={activeIndex === 0}
                onClick={() => go(activeIndex - 1)}
                className="w-9 h-9 rounded-full bg-black/50 backdrop-blur-md flex items-center justify-center text-white border border-white/20 disabled:opacity-20"
                aria-label="Previous reel"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
            </div>
            <div className="sm:hidden absolute inset-y-0 right-2 flex items-center z-20">
              <button
                type="button"
                disabled={activeIndex === reels.length - 1}
                onClick={() => go(activeIndex + 1)}
                className="w-9 h-9 rounded-full bg-black/50 backdrop-blur-md flex items-center justify-center text-white border border-white/20 disabled:opacity-20"
                aria-label="Next reel"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>

            {/* Bottom Reel Caption & Tagged Items Strip */}
            <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black via-black/70 to-transparent p-4 pt-12 z-20 space-y-3">
              <div>
                <h2 className="text-sm font-semibold tracking-wide drop-shadow-md">{currentReel.title}</h2>
                {currentReel.caption && <p className="text-xs text-[#D8CEBF] font-light mt-0.5 line-clamp-2">{currentReel.caption}</p>}
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between text-[11px] text-[#A89D91]">
                  <span className="font-semibold uppercase tracking-wider text-[#FAF8F5]">
                    Shop Tagged Pieces ({currentReel.taggedProductIds.length})
                  </span>
                  <span>Tap item to select size</span>
                </div>

                <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1">
                  {taggedProducts.map(({ detail, product: p }) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setSheetFor(detail)}
                      className="flex items-center gap-2 bg-white/95 text-[#1A1816] p-2 rounded-xl shrink-0 cursor-pointer hover:bg-white transition-all shadow-md active:scale-95 text-left"
                    >
                      {p.colors[0]?.images[0] && <img src={p.colors[0].images[0]} alt="" className="w-10 h-12 object-cover rounded-xl bg-[#EFE9DF]" />}
                      <span>
                        <span className="text-[11px] font-semibold line-clamp-1 w-28 block">{p.title}</span>
                        <span className="text-xs font-bold text-[var(--color-primary)] block">{formatPrice(p.price)}</span>
                        <span className="text-[9px] text-[#554C42] uppercase tracking-wider font-semibold">Select Size →</span>
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Right arrow (outer edge) */}
          <button
            type="button"
            disabled={activeIndex === reels.length - 1}
            onClick={() => go(activeIndex + 1)}
            className="hidden sm:flex w-11 h-11 shrink-0 rounded-full bg-black/40 backdrop-blur-md items-center justify-center text-white border border-white/20 disabled:opacity-20 hover:bg-black transition-colors"
            aria-label="Next reel"
          >
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>

        {/* RIGHT: Desktop Tagged Product Rack & Detail View */}
        <div className="lg:col-span-5 space-y-4">
          <div className="bg-[#1C1815] p-5 rounded-2xl border border-[#2B2621]">
            <div className="flex items-center justify-between pb-3 border-b border-[#2E2823]">
              <div className="flex items-center gap-2">
                <ShoppingBag className="w-4 h-4 text-[var(--color-primary)]" />
                <h4 className="text-xs uppercase tracking-[0.2em] font-semibold text-[#EDE6DC]">Tagged Garments in This Reel</h4>
              </div>
              <span className="text-[11px] text-[#756A5E]">Reel {activeIndex + 1} of {reels.length}</span>
            </div>

            <div className="divide-y divide-[#2E2823] mt-2">
              {taggedProducts.map(({ detail, product: p }) => (
                <div key={p.id} className="py-4 first:pt-2 flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3 min-w-0">
                    <Link href={shop.hrefFor('pdp', { productId: p.id })} tabIndex={-1} aria-hidden="true" className="shrink-0">
                      {p.colors[0]?.images[0] && <img src={p.colors[0].images[0]} alt="" className="w-16 h-20 object-cover rounded-xl bg-[#24201C] hover:opacity-90" />}
                    </Link>
                    <div className="min-w-0">
                      <Link href={shop.hrefFor('pdp', { productId: p.id })} className="text-xs sm:text-sm font-medium text-white hover:text-[var(--color-primary)]">
                        {p.title}
                      </Link>
                      {p.fabric && <p className="text-[11px] text-[#A89C8F]">{p.fabric}</p>}
                      <div className="flex items-baseline gap-2 mt-1">
                        <span className="text-xs font-bold text-white">{formatPrice(p.price)}</span>
                        {p.mrp > p.price && <span className="text-[10px] text-[#756A5E] line-through">{formatPrice(p.mrp)}</span>}
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-col items-end gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => setSheetFor(detail)}
                      className="px-4 py-2 bg-[#FAF8F5] hover:bg-white text-[#1A1816] text-[11px] uppercase tracking-wider font-semibold rounded-full transition-colors cursor-pointer"
                    >
                      Quick Buy
                    </button>
                    <Link href={shop.hrefFor('pdp', { productId: p.id })} className="text-[10px] text-[#A89C8F] hover:text-white underline py-1">
                      Full Details
                    </Link>
                  </div>
                </div>
              ))}
              {taggedProducts.length < currentReel.taggedProductIds.length && (
                <p className="py-4 text-[11px] text-[#756A5E]">Loading tagged pieces…</p>
              )}
            </div>
          </div>
        </div>
      </div>

      {sheetFor && <ReelProductSheet detail={sheetFor} onClose={() => setSheetFor(null)} />}
    </>
  );
}

/** The design's in-reel mini sheet: choose colour and size, add to the real bag. */
function ReelProductSheet({ detail, onClose }: { detail: ProductDetail; onClose: () => void }) {
  const shop = useShop();
  const product = detailToProduct(detail);
  const sheetRef = useRef<HTMLDivElement>(null);
  useModalFocus(true, sheetRef, onClose);
  const firstInStock = detail.variants.find((v) => v.inStock)?.colourName ?? product.colors[0]?.name ?? '';
  const [sheetColor, setSheetColor] = useState(firstInStock);
  const [sheetSize, setSheetSize] = useState('');
  const [added, setAdded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const colour = product.colors.find((c) => c.name === sheetColor) ?? product.colors[0];
  const sizes = detail.variants.filter((v) => v.colourName === sheetColor);

  const add = async () => {
    if (!sheetSize) { setError('Choose a size first.'); return; }
    setBusy(true);
    setError(null);
    try {
      await shop.addToBag(product.id, sheetColor, sheetSize);
      setAdded(true);
      setTimeout(onClose, 1200);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add to bag.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div id="reel-product-sheet-backdrop" className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center p-0 sm:p-4">
      <button type="button" tabIndex={-1} aria-hidden="true" onClick={onClose} className="absolute inset-0 cursor-default bg-black/70 backdrop-blur-xs" />
      <div
        id="reel-product-sheet"
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Shop ${product.title}`}
        tabIndex={-1}
        className="relative w-full sm:max-w-md bg-[#FAF8F5] text-[#1A1816] rounded-t-3xl sm:rounded-3xl p-6 shadow-2xl"
      >
        <div className="flex items-start justify-between pb-3 border-b border-[#EAE3D7]">
          <div className="flex gap-3 min-w-0">
            {colour?.images[0] && <img src={colour.images[0]} alt="" className="w-14 h-18 object-cover rounded-xl bg-[#EFE9DF]" />}
            <div className="min-w-0">
              <span className="text-[10px] uppercase tracking-[0.2em] font-semibold text-[#A85B3F]">Shop In-Reel</span>
              <h4 className="text-xs sm:text-sm font-semibold text-[#1A1816] line-clamp-1 mt-0.5">{product.title}</h4>
              <div className="mt-1 flex items-baseline gap-2">
                <span className="font-bold text-sm text-[#1A1816]">{formatPrice(product.price)}</span>
                {product.mrp > product.price && <span className="text-[11px] text-[#756A5E] line-through">{formatPrice(product.mrp)}</span>}
              </div>
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="p-2 -m-1">
            <X className="w-5 h-5 text-[#655A50]" />
          </button>
        </div>

        {product.colors.length > 0 && (
          <div className="mt-4">
            <span className="text-xs font-medium text-[#443B33] block mb-1.5">Colour: <strong>{sheetColor}</strong></span>
            <div className="flex flex-wrap gap-2">
              {product.colors.map((c) => (
                <button
                  key={c.name}
                  type="button"
                  aria-pressed={sheetColor === c.name}
                  onClick={() => { setSheetColor(c.name); setSheetSize(''); }}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs ${
                    sheetColor === c.name ? 'border-[#1A1816] bg-white font-semibold' : 'border-[#DDD3C5] bg-white/50 text-[#6B5E51]'
                  }`}
                >
                  <span className="w-2.5 h-2.5 rounded-full border border-black/10" style={{ backgroundColor: c.hex === NO_SWATCH ? undefined : c.hex }} />
                  <span>{c.name}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="mt-4">
          <span className="text-xs font-medium text-[#443B33] block mb-1.5">Select Size</span>
          <div className="grid grid-cols-4 gap-2">
            {sizes.map((s) => (
              <button
                key={s.skuId}
                type="button"
                disabled={!s.inStock}
                aria-pressed={sheetSize === s.sizeLabel}
                aria-label={s.inStock ? `Size ${s.sizeLabel}` : `Size ${s.sizeLabel}, sold out`}
                onClick={() => { setSheetSize(s.sizeLabel); setError(null); }}
                className={`py-2.5 text-xs font-semibold rounded-full border transition-all ${
                  !s.inStock
                    ? 'border-[#EAE3D7] bg-[#F2ECE1] text-[#9E9184] line-through'
                    : sheetSize === s.sizeLabel
                    ? 'border-[#1A1816] bg-[#1A1816] text-white'
                    : 'border-[#DDD3C5] bg-white hover:border-[#1A1816]'
                }`}
              >
                {s.sizeLabel}
              </button>
            ))}
          </div>
        </div>

        {error && <p role="alert" className="mt-3 text-xs text-[#962E3B]">{error}</p>}

        <div className="mt-6 flex gap-2">
          <button
            type="button"
            disabled={busy || added}
            onClick={() => void add()}
            className={`flex-1 py-3 px-4 text-xs font-semibold uppercase tracking-[0.16em] rounded-full transition-all flex items-center justify-center gap-2 cursor-pointer ${
              added ? 'bg-[#3F6A48] text-white' : 'bg-[#1F1C18] text-white hover:bg-black'
            }`}
          >
            {added ? (<><Check className="w-4 h-4" /><span role="status">Added to Bag!</span></>) : <span>{busy ? 'Adding…' : 'Add to Bag'}</span>}
          </button>
          <Link
            href={shop.hrefFor('pdp', { productId: product.id })}
            onClick={onClose}
            className="px-5 py-3 border border-[#1A1816] text-[#1A1816] text-xs uppercase tracking-wider font-semibold rounded-full hover:bg-[#1A1816] hover:text-white transition-colors cursor-pointer"
          >
            Details
          </Link>
        </div>
      </div>
    </div>
  );
}
