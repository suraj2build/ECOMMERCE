'use client';

/**
 * The approved AI Studio product page (Stitch-Spark_Ai_Studio
 * views/PdpView.tsx) over the live product. Price and stock refresh on load;
 * every add goes through the real bag. Left out or changed because the
 * prototype stated things the shop does not record or offer: the Digital
 * Product Passport, the "3-piece ensemble (15% off)" offer, restock "Notify
 * me" sign-ups (sold-out sizes are shown as sold out), the fixed delivery and
 * 7-day promises (the shop's configured terms are shown instead), and the
 * "frequently bought together" claim (the pairing is the merchandiser's own
 * cross-sell). Lighting preview starts on "Studio", the unaltered photograph.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  Heart,
  Star,
  Truck,
  ChevronDown,
  ChevronUp,
  Ruler,
  Sparkles,
  Check,
  AlertCircle,
  Plus,
  Maximize2,
  X,
} from 'lucide-react';
import {
  checkServiceability,
  getEstimatedOffers,
  getProductDetailLive,
  type CrossSellItem,
  type EstimatedOffer,
  type ProductDetail,
  type ServiceabilityResult,
  type StorefrontSearchHit,
} from '@/lib/api';
import { recordProductView } from '@/lib/account';
import { getStoredSession } from '@/lib/customer-auth';
import { track } from '@/lib/tracking';
import { useModalFocus } from '@/components/layout/useModalFocus';
import { formatPrice } from '../utils/format';
import { Breadcrumb } from '../components/Breadcrumb';
import { buildProductBreadcrumb } from '../lib/productBreadcrumb';
import { ContextualLightingControl, LightingMode, LIGHTING_CONFIGS } from '../components/ContextualLightingControl';
import { detailToProduct, hitToProduct, NO_SWATCH } from '../bridge/adapters';
import { ShopProductCard } from '../bridge/ShopProductCard';
import { useShop } from '../bridge/shop';
import type { Product } from '../types';
import { PdpReviews } from './PdpReviews';

const RECENT_KEY = 'vanya_recently_viewed';

function rememberViewed(id: string): string[] {
  try {
    const stored = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
    const previous = Array.isArray(stored) ? stored.filter((v): v is string => typeof v === 'string') : [];
    localStorage.setItem(RECENT_KEY, JSON.stringify([id, ...previous.filter((v) => v !== id)].slice(0, 8)));
    return previous.filter((v) => v !== id);
  } catch {
    return [];
  }
}

export function PdpView({ initial, similar }: { initial: ProductDetail; similar: StorefrontSearchHit[] }) {
  const shop = useShop();
  const [detail, setDetail] = useState(initial);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const product = useMemo(() => detailToProduct(detail), [detail]);

  // Live price and stock: the page HTML may be cached for a few seconds.
  useEffect(() => {
    let active = true;
    getProductDetailLive(initial.id)
      .then((fresh) => { if (active) setDetail(fresh); })
      .catch(() => { if (active) setRefreshFailed(true); });
    return () => { active = false; };
  }, [initial.id]);
  useEffect(() => {
    track.viewItem({ styleCode: initial.styleCode, name: initial.name, price: initial.sellingPrice });
    if (getStoredSession()) void recordProductView(initial.id).catch(() => {});
  }, [initial.id, initial.styleCode, initial.name, initial.sellingPrice]);

  // "Best Offers" teaser: automatic promotions this product's own price
  // alone already qualifies for (getEstimatedOffers's own doc comment) -
  // always an estimate, never a substitute for the checkout-time total.
  const [estimatedOffers, setEstimatedOffers] = useState<EstimatedOffer[]>([]);
  useEffect(() => {
    let active = true;
    getEstimatedOffers(initial.id)
      .then((offers) => { if (active) setEstimatedOffers(offers); })
      .catch(() => {});
    return () => { active = false; };
  }, [initial.id]);

  // Color and size selection state (opens on a colour that has stock)
  const firstInStock = Math.max(0, product.colors.findIndex((c) => detail.variants.some((v) => v.colourName === c.name && v.inStock)));
  const [selectedColorIndex, setSelectedColorIndex] = useState(firstInStock);
  const currentColor = product.colors[selectedColorIndex] || product.colors[0] || { name: '', hex: NO_SWATCH, images: [] };
  const colourSizes = detail.variants
    .filter((v) => v.colourName === currentColor.name)
    .map((v) => ({ size: v.sizeLabel, inStock: v.inStock, stockCount: v.availableQuantity }));

  const [selectedSize, setSelectedSize] = useState<string>('');
  const [sizeError, setSizeError] = useState(false);
  const [isAdded, setIsAdded] = useState(false);
  const [adding, setAdding] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [wishlistMessage, setWishlistMessage] = useState<string | null>(null);
  const isWishlisted = shop.wishlistIds.has(product.id);

  // Gallery zoom state
  const [activeImageIndex, setActiveImageIndex] = useState(0);
  const [zoomModalOpen, setZoomModalOpen] = useState(false);
  const zoomRef = useRef<HTMLDivElement>(null);
  useModalFocus(zoomModalOpen, zoomRef, () => setZoomModalOpen(false));

  // Contextual lighting preview
  const [lightingMode, setLightingMode] = useState<LightingMode>('studio');
  const lightingConfig = LIGHTING_CONFIGS[lightingMode];

  // Pincode Delivery State (real serviceability data)
  const [pincode, setPincode] = useState('');
  const [pincodeStatus, setPincodeStatus] = useState<'idle' | 'checking' | 'done' | 'invalid' | 'error'>('idle');
  const [serviceability, setServiceability] = useState<ServiceabilityResult | null>(null);

  // Accordions open/close state
  const [openAccordions, setOpenAccordions] = useState<{ [key: string]: boolean }>({
    details: true,
    fit: true,
    fabric: false,
    shipping: false,
    manufacturing: false,
  });
  const toggleAccordion = (key: string) => {
    setOpenAccordions((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  // Sticky Mobile Purchase Bar
  const buyButtonRef = useRef<HTMLDivElement>(null);
  const [showStickyBar, setShowStickyBar] = useState(false);
  useEffect(() => {
    const handleScroll = () => {
      if (buyButtonRef.current) {
        const rect = buyButtonRef.current.getBoundingClientRect();
        setShowStickyBar(rect.bottom < 0);
      }
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  // Recently viewed in this browser (live details, not stored copies)
  const [recentlyViewed, setRecentlyViewed] = useState<Product[]>([]);
  useEffect(() => {
    const ids = rememberViewed(initial.id).slice(0, 4);
    let active = true;
    Promise.all(ids.map((id) => shop.loadProduct(id).then(detailToProduct).catch(() => null)))
      .then((items) => { if (active) setRecentlyViewed(items.filter((p): p is Product => p !== null)); });
    return () => { active = false; };
  }, [initial.id]);

  const handleCheckPincode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!/^\d{6}$/.test(pincode.trim())) {
      setPincodeStatus('invalid');
      return;
    }
    setPincodeStatus('checking');
    try {
      setServiceability(await checkServiceability(pincode.trim()));
      setPincodeStatus('done');
    } catch {
      setPincodeStatus('error');
    }
  };

  const addSelected = async () => {
    if (refreshFailed) {
      setMessage('Unable to confirm availability. Please refresh this page.');
      return false;
    }
    if (!selectedSize) {
      setSizeError(true);
      return false;
    }
    setSizeError(false);
    setAdding(true);
    setMessage(null);
    try {
      await shop.addToBag(product.id, currentColor.name, selectedSize);
      setIsAdded(true);
      setMessage('Added to bag.');
      setTimeout(() => setIsAdded(false), 1500);
      return true;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not add this item to your bag.');
      return false;
    } finally {
      setAdding(false);
    }
  };

  const handleBuyNow = async () => {
    if (await addSelected()) shop.setBagOpen(true);
  };

  const handleWishlist = async () => {
    setWishlistMessage(null);
    try {
      await shop.toggleWishlist(product.id, currentColor.name, selectedSize || undefined);
      setWishlistMessage(isWishlisted ? 'Removed from wishlist.' : 'Saved to wishlist.');
    } catch (error) {
      setWishlistMessage(error instanceof Error ? error.message : 'Could not update your wishlist.');
    }
  };

  const policies = detail.policies;
  const shippingConfirmed = policies?.shipping.confirmed === true;
  const returns = policies?.returns;
  const images = currentColor.images;
  const ratingCount = detail.ratingSummary.reviewCount;
  const averageRating = detail.ratingSummary.averageRating ?? 0;
  const manufacturingRows = [
    ['Country of Origin', product.manufacturing.origin],
    ['Production Cluster', product.manufacturing.artisanCluster],
    ['Sustainability Note', product.manufacturing.sustainableNote],
  ].filter(([, value]) => value);

  return (
    <div id="pdp-container" className="pb-20">
      {/* Breadcrumbs */}
      <Breadcrumb
        items={buildProductBreadcrumb(detail)}
        className="max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-4 text-xs text-[#756A5E]"
      />

      {/* Main PDP Grid: Media + Purchase Panel */}
      <div className="max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 pt-2 pb-16">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-14 items-start">
          {/* LEFT: Product Media Area */}
          <div className="lg:col-span-7 space-y-4 min-w-0">
            {images.length > 0 && (
              <ContextualLightingControl currentMode={lightingMode} onChangeMode={setLightingMode} className="mb-2" />
            )}

            {images.length === 0 ? (
              <div className="aspect-[4/5] bg-[#F0EBE2] rounded-2xl flex items-center justify-center text-xs uppercase tracking-[0.16em] text-[#756A5E]">
                Photographs coming soon
              </div>
            ) : (
              <>
                {/* Desktop 2-column or large gallery */}
                <div className="hidden sm:grid grid-cols-2 gap-3">
                  {images.map((img, idx) => (
                    <button
                      key={img + idx}
                      type="button"
                      onClick={() => {
                        setActiveImageIndex(idx);
                        setZoomModalOpen(true);
                      }}
                      aria-label={`Enlarge ${product.title} view ${idx + 1}`}
                      className={`group relative aspect-[3/4] bg-[#F0EBE2] overflow-hidden rounded-2xl cursor-zoom-in ${
                        idx === 0 ? 'col-span-2 aspect-[4/5]' : ''
                      }`}
                    >
                      <img
                        src={img}
                        alt={`${product.title} view ${idx + 1}`}
                        loading={idx === 0 ? 'eager' : 'lazy'}
                        style={{ filter: lightingConfig.filter, transition: 'filter 0.4s ease' }}
                        className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-103"
                      />
                      <div className="absolute inset-0 pointer-events-none transition-all duration-500" style={lightingConfig.overlayStyle} />
                      <div className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 transition-opacity p-2 bg-white/80 rounded-full backdrop-blur-xs z-10">
                        <Maximize2 className="w-4 h-4 text-[#1A1816]" />
                      </div>
                    </button>
                  ))}
                </div>

                {/* Mobile Swipeable Gallery */}
                <div className="sm:hidden relative aspect-[3/4] bg-[#F0EBE2] overflow-hidden rounded-2xl">
                  <button type="button" onClick={() => setZoomModalOpen(true)} aria-label={`Enlarge ${product.title}`} className="block w-full h-full">
                    <img
                      src={images[activeImageIndex] || images[0]}
                      alt={product.title}
                      style={{ filter: lightingConfig.filter, transition: 'filter 0.4s ease' }}
                      className="w-full h-full object-cover"
                    />
                  </button>
                  <div className="absolute inset-0 pointer-events-none transition-all duration-500" style={lightingConfig.overlayStyle} />

                  {/* Image Indicators */}
                  {images.length > 1 && (
                    <div className="absolute bottom-1 inset-x-0 flex justify-center">
                      {images.map((_, idx) => (
                        <button
                          key={idx}
                          type="button"
                          onClick={() => setActiveImageIndex(idx)}
                          aria-label={`Show view ${idx + 1}`}
                          aria-current={activeImageIndex === idx}
                          className="p-2"
                        >
                          <span className={`block h-1.5 rounded-full transition-all ${activeImageIndex === idx ? 'w-5 bg-[#1A1816]' : 'w-1.5 bg-black/30'}`} />
                        </button>
                      ))}
                    </div>
                  )}

                  {/* Wishlist Floating Mobile */}
                  <button
                    type="button"
                    onClick={() => void handleWishlist()}
                    aria-label={isWishlisted ? 'Remove from wishlist' : 'Save to wishlist'}
                    aria-pressed={isWishlisted}
                    className="absolute top-3 right-3 w-11 h-11 rounded-full bg-white/85 backdrop-blur-xs flex items-center justify-center shadow-xs"
                  >
                    <Heart className={`w-4 h-4 stroke-[1.5] ${isWishlisted ? 'fill-[#A85B3F] text-[#A85B3F]' : 'text-[#2C2723]'}`} />
                  </button>
                </div>
              </>
            )}
          </div>

          {/* RIGHT: Purchase Panel (Sticky on Desktop) */}
          <div className="lg:col-span-5 space-y-6 lg:sticky lg:top-24 min-w-0">
            {/* Header / Brand / Title */}
            <div>
              <div className="flex items-center justify-between">
                <span className="text-[10px] uppercase tracking-[0.24em] font-semibold text-[#756A5E]">
                  VANYA ATELIER
                </span>
                {product.badges?.[0] && (
                  <span className="text-[9px] uppercase tracking-[0.2em] font-bold px-2 py-0.5 bg-[#1F1C18] text-[#FAF8F5]">
                    {product.badges[0]}
                  </span>
                )}
              </div>

              <h1 className="font-editorial text-2xl sm:text-4xl text-[#1A1816] font-normal mt-1 leading-tight">
                {product.title}
              </h1>

              {product.subtitle && (
                <p className="text-xs text-[#7A6F64] mt-1 font-light leading-relaxed">{product.subtitle}</p>
              )}

              {/* Ratings Summary (Click to scroll to reviews) */}
              {ratingCount > 0 ? (
                <button
                  type="button"
                  onClick={() => document.getElementById('pdp-reviews')?.scrollIntoView({ behavior: 'smooth' })}
                  className="flex items-center gap-2 mt-3 text-xs cursor-pointer group text-left"
                  aria-label={`Rated ${averageRating.toFixed(1)} out of 5 from ${ratingCount} ${ratingCount === 1 ? 'review' : 'reviews'}. Go to reviews`}
                >
                  <div className="flex items-center text-[#D4AF37]" aria-hidden="true">
                    {[1, 2, 3, 4, 5].map((star) => (
                      <Star key={star} className={`w-3.5 h-3.5 ${star <= Math.round(averageRating) ? 'fill-[#D4AF37] text-[#D4AF37]' : 'text-[#DDD4C6]'}`} />
                    ))}
                  </div>
                  <span className="font-semibold text-[#1A1816]">{averageRating.toFixed(1)}</span>
                  <span className="text-[#756A5E] group-hover:underline">
                    ({ratingCount} {ratingCount === 1 ? 'review' : 'reviews'})
                  </span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => document.getElementById('pdp-reviews')?.scrollIntoView({ behavior: 'smooth' })}
                  className="mt-3 text-xs text-[#756A5E] hover:underline"
                >
                  No reviews yet
                </button>
              )}

              {/* Pricing */}
              <div className="mt-4 flex flex-wrap items-baseline gap-3">
                <span className="font-editorial text-2xl sm:text-3xl font-semibold text-[#1A1816]">
                  {formatPrice(product.price)}
                </span>
                {product.mrp > product.price && (
                  <>
                    <span className="text-sm text-[#756A5E] line-through">{formatPrice(product.mrp)}</span>
                    <span className="text-xs font-bold text-[#A85B3F] bg-[#F7EBE7] px-2 py-0.5 rounded-full">
                      {product.discountPercent}% OFF
                    </span>
                  </>
                )}
              </div>
              <p className="text-[11px] text-[#756A5E] mt-0.5">Inclusive of all Indian taxes</p>

              {estimatedOffers.length > 0 && (
                <div className="mt-3 rounded-xl border border-[#EAE3D7] bg-[#FAF7F2] p-3">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-[#756A5E]">Offers</span>
                  <ul className="mt-1.5 space-y-1">
                    {estimatedOffers.map((offer) => (
                      <li key={offer.name} className="text-xs text-[#2E2823]">
                        <span className="font-medium">{offer.name}</span> — save {formatPrice(offer.discountAmount)}
                      </li>
                    ))}
                  </ul>
                  <p className="mt-1.5 text-[10px] text-[#A0978A]">
                    Estimated if this is the only item in your bag — confirmed at checkout.
                  </p>
                </div>
              )}
            </div>

            {/* Colour Variant Selection */}
            {product.colors.length > 0 && (
              <fieldset className="border-t border-[#EAE3D7] pt-5">
                <legend className="sr-only">Colour</legend>
                <div className="flex items-center justify-between text-xs mb-2" aria-hidden="true">
                  <span className="font-medium text-[#38312B]">
                    Colour: <strong className="font-semibold text-[#1A1816]">{currentColor.name}</strong>
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-2.5">
                  {product.colors.map((c, idx) => (
                    <button
                      key={c.name}
                      type="button"
                      aria-pressed={selectedColorIndex === idx}
                      onClick={() => {
                        setSelectedColorIndex(idx);
                        setActiveImageIndex(0);
                        setSelectedSize('');
                        setMessage(null);
                      }}
                      className={`flex items-center gap-1.5 px-3 py-2 rounded-full border text-xs transition-all ${
                        selectedColorIndex === idx
                          ? 'border-[#1A1816] bg-white font-semibold shadow-xs'
                          : 'border-[#DDD4C6] bg-white/50 text-[#61564C] hover:border-[#1A1816]'
                      }`}
                    >
                      <span
                        className="w-3.5 h-3.5 rounded-full border border-black/10 shrink-0"
                        style={{ backgroundColor: c.hex === NO_SWATCH ? undefined : c.hex }}
                      />
                      <span>{c.name}</span>
                    </button>
                  ))}
                </div>
              </fieldset>
            )}

            {/* Size Experience */}
            <div className="border-t border-[#EAE3D7] pt-5">
              <div className="flex items-center justify-between text-xs mb-2">
                <span className="font-medium text-[#38312B]" aria-hidden="true">Select Size</span>
                {detail.sizeChart && (
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => shop.openSizeGuide(detail)}
                      className="text-[#A85B3F] hover:underline font-semibold flex items-center gap-1 text-[11px] py-1"
                    >
                      <Ruler className="w-3.5 h-3.5" />
                      <span>Size Guide</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => shop.openSizeGuide(detail)}
                      className="text-[#A85B3F] hover:underline font-semibold flex items-center gap-1 text-[11px] py-1"
                    >
                      <Sparkles className="w-3 h-3" />
                      <span>My Size</span>
                    </button>
                  </div>
                )}
              </div>

              {/* Size Chips */}
              <fieldset>
                <legend className="sr-only">Size</legend>
                <div className="grid grid-cols-4 gap-2">
                  {colourSizes.map((s) => {
                    const isSelected = selectedSize === s.size;
                    const isAvailable = s.inStock;
                    return (
                      <button
                        key={s.size}
                        type="button"
                        disabled={!isAvailable}
                        aria-pressed={isSelected}
                        aria-label={isAvailable ? `Size ${s.size}` : `Size ${s.size}, sold out`}
                        onClick={() => {
                          setSelectedSize(s.size);
                          setSizeError(false);
                          setMessage(null);
                        }}
                        className={`py-3 text-xs font-semibold rounded-full border transition-all relative ${
                          !isAvailable
                            ? 'border-[#EBE4D8] bg-[#F5EFE6]/60 text-[#9E9184] cursor-not-allowed'
                            : isSelected
                            ? 'border-[#1A1816] bg-[#1A1816] text-[#FAF8F5] shadow-xs'
                            : 'border-[#DDD3C5] bg-white hover:border-[#1A1816] text-[#1A1816]'
                        }`}
                      >
                        <span className={!isAvailable ? 'line-through' : ''}>{s.size}</span>
                        {s.stockCount > 0 && s.stockCount <= 3 && isAvailable && (
                          <span className="block text-[8px] text-[#A85B3F] font-normal leading-none mt-0.5">
                            Only {s.stockCount} left
                          </span>
                        )}
                        {!isAvailable && (
                          <span className="block text-[7px] text-[#A85B3F] uppercase tracking-tighter font-bold leading-none mt-0.5">
                            Sold Out
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </fieldset>

              {sizeError && (
                <p role="alert" className="text-xs text-[#962E3B] mt-2 flex items-center gap-1">
                  <AlertCircle className="w-3.5 h-3.5" />
                  <span>Please select a size to proceed with purchase</span>
                </p>
              )}

              {/* Model Specification */}
              {product.modelInfo.height && product.modelInfo.wearingSize && (
                <div className="mt-3 text-[11px] text-[#7A6F64] bg-[#F2EDE4]/60 p-2.5 rounded-2xl border border-[#E5DDD1]">
                  <strong>Model Note:</strong> Model is {product.modelInfo.height} wearing size {product.modelInfo.wearingSize}.
                </div>
              )}
            </div>

            {/* Primary Purchase CTAs */}
            <div ref={buyButtonRef} className="space-y-2 pt-2">
              <div className="flex gap-3">
                <button
                  id="btn-add-to-bag"
                  type="button"
                  onClick={() => void addSelected()}
                  disabled={adding}
                  className={`flex-1 py-4 px-6 text-xs uppercase tracking-[0.2em] font-bold rounded-full transition-all flex items-center justify-center gap-2 cursor-pointer shadow-md ${
                    isAdded
                      ? 'bg-[#3F6A48] text-white'
                      : 'bg-[var(--color-primary)] text-white hover:bg-[var(--color-primary-hover)] active:scale-[0.99]'
                  }`}
                >
                  {isAdded ? (
                    <>
                      <Check className="w-4 h-4" />
                      <span>Added to Bag</span>
                    </>
                  ) : (
                    <span>{adding ? 'Adding…' : 'Add to Bag'}</span>
                  )}
                </button>

                <button
                  id="btn-pdp-wishlist"
                  type="button"
                  onClick={() => void handleWishlist()}
                  className="w-13 border border-[var(--color-border)] bg-white hover:border-[var(--color-primary)] rounded-full flex items-center justify-center transition-colors cursor-pointer"
                  aria-label={isWishlisted ? 'Remove from wishlist' : 'Save to wishlist'}
                  aria-pressed={isWishlisted}
                >
                  <Heart className={`w-5 h-5 stroke-[1.5] ${isWishlisted ? 'fill-[var(--color-primary)] text-[var(--color-primary)]' : 'text-[#1A1816]'}`} />
                </button>
              </div>

              <button
                id="btn-buy-now"
                type="button"
                onClick={() => void handleBuyNow()}
                className="w-full py-3 text-xs uppercase tracking-[0.18em] font-semibold border border-[var(--color-primary)] text-[var(--color-primary)] hover:bg-[var(--color-primary)] hover:text-white transition-colors rounded-full cursor-pointer"
              >
                Instant Buy
              </button>

              {message && <p role="status" className="text-xs text-[#5C5146]">{message}</p>}
              {wishlistMessage && <p role="status" className="text-xs text-[#5C5146]">{wishlistMessage}</p>}
            </div>

            {/* Delivery Pincode Verification Module */}
            <div className="border border-[var(--color-border)] bg-[var(--color-surface)]/40 p-4 rounded-2xl text-xs space-y-2.5">
              <div className="flex items-center gap-2 text-[#2D2722] font-semibold uppercase tracking-wider text-[11px]">
                <Truck className="w-4 h-4 text-[var(--color-primary)]" />
                <span>Delivery &amp; COD Availability</span>
              </div>

              <form onSubmit={(e) => void handleCheckPincode(e)} className="flex gap-2">
                <label htmlFor="pincode-input" className="sr-only">PIN code</label>
                <input
                  id="pincode-input"
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  placeholder="Enter 6-digit PIN code"
                  value={pincode}
                  onChange={(e) => setPincode(e.target.value.replace(/\D/g, ''))}
                  className="flex-1 min-w-0 px-3 py-2.5 bg-white border border-[#DDD4C6] rounded-xl text-sm focus:outline-none focus:border-[#1A1816]"
                />
                <button
                  type="submit"
                  disabled={pincodeStatus === 'checking'}
                  className="px-4 py-2 bg-[#1A1816] text-white uppercase text-[11px] font-semibold tracking-wider rounded-full hover:bg-black"
                >
                  {pincodeStatus === 'checking' ? 'Checking…' : 'Check'}
                </button>
              </form>

              <div role="status">
                {pincodeStatus === 'done' && serviceability?.isServiceable && (
                  <div className="p-3 bg-[#EAF2EC] border border-[#CDE1D0] rounded-2xl text-[#204928] space-y-1">
                    <div className="flex items-center gap-1.5 font-bold text-xs">
                      <Check className="w-4 h-4 text-[#3F6A48]" />
                      <span>Delivers to {serviceability.city ?? pincode}</span>
                    </div>
                    {serviceability.estimatedDaysMin !== null && serviceability.estimatedDaysMax !== null && (
                      <p className="text-[11px]">• <strong>Estimated Delivery:</strong> {serviceability.estimatedDaysMin}–{serviceability.estimatedDaysMax} days</p>
                    )}
                    <p className="text-[11px]">• <strong>Cash on Delivery:</strong> {serviceability.codAvailable ? 'Available' : 'Not available here'}</p>
                    {returns?.returnable && (
                      <p className="text-[11px]">• <strong>Returns &amp; Exchanges:</strong> within {returns.windowDays} days of delivery</p>
                    )}
                  </div>
                )}
                {pincodeStatus === 'done' && serviceability && !serviceability.isServiceable && (
                  <p className="text-[#962E3B] text-[11px] flex items-center gap-1">
                    <AlertCircle className="w-3.5 h-3.5" />
                    <span>{serviceability.known ? 'We do not deliver to this PIN code yet.' : 'We do not have delivery details for this PIN code yet.'}</span>
                  </p>
                )}
                {pincodeStatus === 'invalid' && (
                  <p className="text-[#962E3B] text-[11px] flex items-center gap-1">
                    <AlertCircle className="w-3.5 h-3.5" />
                    <span>Please enter a valid 6-digit Indian postal code.</span>
                  </p>
                )}
                {pincodeStatus === 'error' && (
                  <p className="text-[#962E3B] text-[11px]">Could not check delivery right now. Please try again.</p>
                )}
              </div>
            </div>

            {/* Progressive Disclosure Accordions */}
            <div className="border-t border-[#EAE3D7] divide-y divide-[#EAE3D7] text-xs">
              {product.details.length > 0 && (
                <Accordion id="details" title="Product Details" open={Boolean(openAccordions.details)} onToggle={toggleAccordion}>
                  <ul className="space-y-1.5 text-[#5C5146] pl-4 list-disc">
                    {product.details.map((d, i) => <li key={i}>{d}</li>)}
                  </ul>
                </Accordion>
              )}

              {(product.fit || product.fitNotes || product.styleNotes) && (
                <Accordion id="fit" title="Fit & Sizing Notes" open={Boolean(openAccordions.fit)} onToggle={toggleAccordion}>
                  <div className="text-[#5C5146] space-y-1.5">
                    {product.fit && <p><strong>Silhouette:</strong> {product.fit}</p>}
                    {product.fitNotes && <p>{product.fitNotes}</p>}
                    {product.styleNotes && <p><strong>Styling:</strong> {product.styleNotes}</p>}
                  </div>
                </Accordion>
              )}

              {(product.fabric || product.care.length > 0) && (
                <Accordion id="fabric" title="Fabric & Care" open={Boolean(openAccordions.fabric)} onToggle={toggleAccordion}>
                  <div className="text-[#5C5146] space-y-2">
                    {product.fabric && <p><strong>Textile Composition:</strong> {product.fabric}</p>}
                    {product.care.length > 0 && (
                      <ul className="space-y-1 pl-4 list-disc">
                        {product.care.map((c, i) => <li key={i}>{c}</li>)}
                      </ul>
                    )}
                  </div>
                </Accordion>
              )}

              <Accordion
                id="shipping"
                title={returns?.returnable ? `Shipping & ${returns.windowDays}-Day Returns` : 'Shipping & Returns'}
                open={Boolean(openAccordions.shipping)}
                onToggle={toggleAccordion}
              >
                <div className="text-[#5C5146] space-y-1.5">
                  {shippingConfirmed && policies ? (
                    <p>
                      • {policies.shipping.freeAboveAmount > 0
                        ? `Free delivery on orders above ${formatPrice(policies.shipping.freeAboveAmount)}; otherwise ${formatPrice(policies.shipping.flatAmount)}.`
                        : `Delivery charge: ${formatPrice(policies.shipping.flatAmount)}.`}
                    </p>
                  ) : (
                    <p>• Delivery charges and timing for your PIN code are shown before you pay.</p>
                  )}
                  {returns && (
                    <p>
                      • {returns.returnable
                        ? `Returns and size exchanges can be requested from your orders within ${returns.windowDays} days of delivery.`
                        : 'This piece cannot be returned.'}
                    </p>
                  )}
                </div>
              </Accordion>

              {manufacturingRows.length > 0 && (
                <Accordion id="manufacturing" title="Origin & Transparency" open={Boolean(openAccordions.manufacturing)} onToggle={toggleAccordion}>
                  <div className="text-[#5C5146] space-y-1.5">
                    {manufacturingRows.map(([label, value]) => (
                      <p key={label}><strong>{label}:</strong> {value}</p>
                    ))}
                  </div>
                </Accordion>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* CURATED PAIRING (the merchandiser's cross-sell) */}
      {detail.crossSell.length > 0 && (
        <CuratedEnsemble
          product={product}
          colorName={currentColor.name}
          image={images[0]}
          selectedSize={selectedSize}
          companion={detail.crossSell[0]!}
          onNeedSize={() => {
            setSizeError(true);
            buyButtonRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }}
        />
      )}

      <PdpReviews
        key={detail.id}
        styleId={detail.id}
        productTitle={product.title}
        initialReviews={initial.reviews}
        initialSummary={initial.ratingSummary}
        reviewsTotal={initial.reviewsTotal}
      />

      {/* RECOMMENDATIONS: YOU MAY ALSO LIKE & RECENTLY VIEWED */}
      {(similar.length > 0 || recentlyViewed.length > 0) && (
        <section id="recommendations-rails" className="max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-12 border-t border-[#EAE3D7] space-y-14">
          {similar.length > 0 && (
            <div>
              <div className="mb-6">
                <span className="text-[10px] uppercase tracking-[0.24em] font-semibold text-[#756A5E] block">Curated Companions</span>
                <h3 className="font-editorial text-2xl sm:text-3xl text-[#1A1816] font-normal mt-0.5">You May Also Like</h3>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                {similar.slice(0, 4).map((item) => <ShopProductCard key={item.id} product={hitToProduct(item)} />)}
              </div>
            </div>
          )}

          {recentlyViewed.length > 0 && (
            <div>
              <div className="mb-6">
                <span className="text-[10px] uppercase tracking-[0.24em] font-semibold text-[#756A5E] block">Session History</span>
                <h3 className="font-editorial text-2xl sm:text-3xl text-[#1A1816] font-normal mt-0.5">Recently Viewed</h3>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                {recentlyViewed.map((item) => <ShopProductCard key={item.id} product={item} />)}
              </div>
            </div>
          )}
        </section>
      )}

      {/* MOBILE STICKY PURCHASE BAR */}
      {showStickyBar && (
        <div
          id="mobile-sticky-purchase-bar"
          className="fixed bottom-0 inset-x-0 bg-[#FAF8F5]/95 backdrop-blur-md border-t border-[#EAE3D7] p-3 z-40 sm:hidden shadow-lg"
        >
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 overflow-hidden">
              {images[0] && <img src={images[0]} alt="" className="w-10 h-12 object-cover rounded-2xl bg-[#EFE9DF] shrink-0" />}
              <div className="overflow-hidden">
                <span className="text-xs font-semibold text-[#1A1816] truncate block leading-tight">{product.title}</span>
                <span className="text-xs font-bold text-[#A85B3F]">{formatPrice(product.price)}</span>
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                if (selectedSize) void addSelected();
                else buyButtonRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
              }}
              className="px-5 py-3 bg-[#1F1C18] text-white text-xs uppercase tracking-wider font-semibold rounded-full shrink-0"
            >
              {selectedSize ? `Add ${selectedSize}` : 'Select Size'}
            </button>
          </div>
        </div>
      )}

      {/* FULLSCREEN IMAGE ZOOM MODAL */}
      {zoomModalOpen && images.length > 0 && (
        <div ref={zoomRef} role="dialog" aria-modal="true" aria-label={`${product.title}, enlarged`} tabIndex={-1} className="fixed inset-0 z-[80] flex items-center justify-center p-4">
          <button type="button" tabIndex={-1} aria-hidden="true" onClick={() => setZoomModalOpen(false)} className="absolute inset-0 cursor-default bg-black/90 backdrop-blur-md" />
          <div className="contents">
            <button
              type="button"
              onClick={() => setZoomModalOpen(false)}
              aria-label="Close enlarged photo"
              className="absolute z-10 top-4 right-4 text-white p-2 rounded-full bg-white/10 hover:bg-white/20"
            >
              <X className="w-6 h-6" />
            </button>
            <img
              src={images[activeImageIndex] || images[0]}
              alt={`${product.title}, enlarged`}
              className="relative max-h-[90vh] max-w-[90vw] object-contain"
            />
          </div>
        </div>
      )}
    </div>
  );
}

function Accordion({ id, title, open, onToggle, children }: { id: string; title: string; open: boolean; onToggle: (id: string) => void; children: React.ReactNode }) {
  return (
    <div className="py-3.5">
      <button
        type="button"
        onClick={() => onToggle(id)}
        aria-expanded={open}
        aria-controls={`pdp-accordion-${id}`}
        className="w-full flex items-center justify-between font-semibold uppercase tracking-wider text-[11px] text-[#1A1816] py-1"
      >
        <span>{title}</span>
        {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
      </button>
      {open && <div id={`pdp-accordion-${id}`} className="mt-3">{children}</div>}
    </div>
  );
}

/**
 * The design's "Curated Ensemble" bundle, pairing this piece with the
 * merchandiser's first cross-sell style. Each piece is added in a size the
 * shopper chooses; prices are the live selling prices.
 */
function CuratedEnsemble({
  product,
  colorName,
  image,
  selectedSize,
  companion,
  onNeedSize,
}: {
  product: Product;
  colorName: string;
  image: string | undefined;
  selectedSize: string;
  companion: CrossSellItem;
  onNeedSize: () => void;
}) {
  const shop = useShop();
  const [companionDetail, setCompanionDetail] = useState<ProductDetail | null>(null);
  const [companionSize, setCompanionSize] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([product.id, companion.id]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    shop.loadProduct(companion.id).then((d) => { if (active) setCompanionDetail(d); }).catch(() => {});
    return () => { active = false; };
  }, [companion.id]);

  const companionColour = companionDetail?.variants.find((v) => v.inStock)?.colourName ?? companionDetail?.variants[0]?.colourName ?? '';
  const companionSizes = companionDetail?.variants.filter((v) => v.colourName === companionColour) ?? [];
  const companionPrice = companionDetail?.sellingPrice ?? Number(companion.sellingPrice);
  const toggle = (id: string) => setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  const total = (selectedIds.includes(product.id) ? product.price : 0) + (selectedIds.includes(companion.id) ? companionPrice : 0);

  const addSelected = async () => {
    setNotice(null);
    if (selectedIds.includes(product.id) && !selectedSize) { onNeedSize(); return; }
    if (selectedIds.includes(companion.id) && !companionSize) { setNotice(`Choose a size for ${companion.name}.`); return; }
    setBusy(true);
    try {
      if (selectedIds.includes(product.id)) await shop.addToBag(product.id, colorName, selectedSize);
      if (selectedIds.includes(companion.id)) await shop.addToBag(companion.id, companionColour, companionSize);
      shop.setBagOpen(true);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not add to bag.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section id="curated-ensemble" aria-labelledby="curated-ensemble-heading" className="max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-14">
      <div className="border border-[#DFD6C8] bg-white p-6 sm:p-8 rounded-3xl">
        <span className="text-[10px] uppercase tracking-[0.24em] font-semibold text-[#A85B3F] block">Curated Ensemble</span>
        <h3 id="curated-ensemble-heading" className="font-editorial text-2xl sm:text-3xl text-[#1A1816] font-normal mt-1 mb-6">
          Wear It With
        </h3>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
          <div className="lg:col-span-8 flex flex-wrap items-center gap-3 sm:gap-4">
            <label className="flex items-center gap-3 cursor-pointer">
              <input type="checkbox" checked={selectedIds.includes(product.id)} onChange={() => toggle(product.id)} className="accent-[#1A1816] w-4 h-4" />
              {image ? <img src={image} alt="" className="w-16 h-20 sm:w-20 sm:h-26 object-cover rounded-2xl bg-[#EFE9DF]" /> : null}
              <span className="text-xs">
                <span className="font-semibold text-[#1A1816] line-clamp-1 block">{product.title}</span>
                <span className="text-[#A85B3F] font-bold block">{formatPrice(product.price)}</span>
                <span className="text-[#756A5E] block">{selectedSize ? `Size ${selectedSize}` : 'Size: choose above'}</span>
              </span>
            </label>

            <Plus className="w-4 h-4 text-[#756A5E] hidden sm:block" aria-hidden="true" />

            <div className="flex items-center gap-3">
              <input
                type="checkbox"
                id="ensemble-companion"
                checked={selectedIds.includes(companion.id)}
                onChange={() => toggle(companion.id)}
                className="accent-[#1A1816] w-4 h-4"
              />
              <Link href={shop.hrefFor('pdp', { productId: companion.id })} tabIndex={-1} aria-hidden="true">
                {companion.thumbnailUrl ? <img src={companion.thumbnailUrl} alt="" className="w-16 h-20 sm:w-20 sm:h-26 object-cover rounded-2xl bg-[#EFE9DF]" /> : <span className="block w-16 h-20 rounded-2xl bg-[#EFE9DF]" />}
              </Link>
              <div className="text-xs space-y-1">
                <label htmlFor="ensemble-companion" className="font-semibold text-[#1A1816] line-clamp-1 block cursor-pointer">{companion.name}</label>
                <p className="text-[#A85B3F] font-bold">{formatPrice(companionPrice)}</p>
                <label htmlFor="ensemble-companion-size" className="sr-only">Size for {companion.name}</label>
                <select
                  id="ensemble-companion-size"
                  value={companionSize}
                  onChange={(e) => setCompanionSize(e.target.value)}
                  className="px-2 py-1.5 bg-white border border-[#DDD5C7] rounded-full text-xs text-[#1A1816]"
                >
                  <option value="">Choose size</option>
                  {companionSizes.map((v) => (
                    <option key={v.skuId} value={v.sizeLabel} disabled={!v.inStock}>
                      {v.sizeLabel}{v.inStock ? '' : ' (sold out)'}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          <div className="lg:col-span-4 bg-[#FAF7F2] p-5 border border-[#E3DBD0] rounded-2xl text-xs space-y-3">
            <div>
              <span className="text-[#7A6E63]">Total for {selectedIds.length} {selectedIds.length === 1 ? 'item' : 'items'}:</span>
              <div className="text-xl font-bold text-[#1A1816] mt-0.5">{formatPrice(total)}</div>
            </div>
            <button
              type="button"
              disabled={selectedIds.length === 0 || busy}
              onClick={() => void addSelected()}
              className="w-full py-3 bg-[#1F1C18] hover:bg-black text-[#FAF8F5] uppercase tracking-[0.16em] font-semibold rounded-full transition-colors disabled:opacity-50"
            >
              {busy ? 'Adding…' : 'Add Selected to Bag'}
            </button>
            {notice && <p role="alert" className="text-[11px] text-[#962E3B]">{notice}</p>}
          </div>
        </div>
      </div>
    </section>
  );
}
