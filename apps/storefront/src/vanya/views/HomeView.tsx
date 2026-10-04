'use client';

import React from 'react';
import Link from 'next/link';
import {
  ArrowRight,
  Heart,
  Truck,
  RotateCcw,
  ShieldCheck,
  Leaf,
  Play,
  Instagram,
  Gem,
  Ruler,
  Package,
} from 'lucide-react';
import { Product, ShoppableReel, StyledLook, Gender } from '../types';
import { ProductCard } from '../components/ProductCard';
import { StoryBubbles, type StoryBubble } from '../components/StoryBubbles';
import { formatPrice } from '../utils/format';

/** Editorial photographs placed in the CMS (see bridge/editorial.ts). */
export interface HomeEditorial {
  hero: string | null;
  feature: string | null;
  categories: StoryBubble[];
  occasions: { image: string | null; href: string | null }[];
  tastemakers: { id: string; image: string; caption: string }[];
}

/** Real delivery/returns defaults (GET /storefront/policies), when known. */
export interface HomePolicies {
  freeDeliveryAbove: number | null;
  returnWindowDays: number | null;
}

interface HomeViewProps {
  products: Product[];
  reels: ShoppableReel[];
  styledLooks: StyledLook[];
  activeGender?: Gender;
  onSelectProduct: (productId: string) => void;
  onNavigate: (route: string, params?: { gender?: Gender; category?: string; productId?: string }) => void;
  wishlistIds: Set<string>;
  onToggleWishlist: (productId: string) => void;
  onQuickAdd: (product: Product, selectedColor: string) => void;
  onInstantAddSize?: (product: Product, colorName: string, size: string) => void;
  onOpenReel: (reelId: string) => void;
  recentlyViewedIds: string[];
  editorial: HomeEditorial;
  policies: HomePolicies;
  hrefFor: (route: string, params?: { gender?: Gender; category?: string; productId?: string; reelId?: string }) => string;
}

export function HomeView({
  products,
  reels,
  activeGender = 'men',
  onSelectProduct,
  wishlistIds,
  onToggleWishlist,
  onQuickAdd,
  onInstantAddSize,
  editorial,
  policies,
  hrefFor,
}: HomeViewProps) {
  const isMen = activeGender === 'men';

  // Strictly dedicated department products
  const departmentProducts = products.filter((p) =>
    isMen ? p.gender === 'men' || p.gender === 'unisex' : p.gender === 'women' || p.gender === 'unisex'
  );

  // New arrivals items (first 6 products)
  const newArrivals = departmentProducts.slice(0, 6);

  // Curated Reels for the "Watch. Shop. Wear." section
  const curatedReels = reels.slice(0, 6);

  const tastemakerPhotos = editorial.tastemakers;

  return (
    <div className="space-y-12 sm:space-y-16 pb-20 select-none">
      {/* ======================================================== */}
      {/* 1. HERO 1: THE FESTIVE EDIT (Matches Mockup Top Hero) */}
      {/* ======================================================== */}
      <section className="relative w-full overflow-hidden bg-[#181716] min-h-[75vh] sm:min-h-[82vh] lg:min-h-[86vh] flex items-center">
        {/* Full-bleed background image with subtle warm tone */}
        <div className="absolute inset-0">
          {editorial.hero && (
            <img
              src={editorial.hero}
              alt="The Festive Edit"
              className="w-full h-full object-cover object-[center_top] brightness-[0.80]"
            />
          )}
          {/* Subtle gradient vignette */}
          <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/35 to-black/20 sm:bg-gradient-to-r sm:from-black/85 sm:via-black/45 sm:to-transparent" />
        </div>

        {/* Hero Content */}
        <div className="relative z-10 max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-8 py-16 w-full flex flex-col md:flex-row md:items-end justify-between gap-8">
          {/* Left Block */}
          <div className="max-w-xl text-white space-y-3.5 sm:space-y-4">
            <span className="text-[11px] tracking-[0.26em] uppercase font-light text-[#E5DCD0] block">
              {isMen ? 'THE FESTIVE EDIT' : 'THE FESTIVE EDIT'}
            </span>

            <h1 className="font-editorial text-4xl sm:text-6xl lg:text-7xl text-white font-normal leading-[1.05] tracking-wide uppercase">
              VANYA
            </h1>

            <h2 className="text-xs sm:text-sm tracking-[0.24em] uppercase text-[#DDD3C5] font-light">
              {isMen ? 'MODERN INDIAN MENSWEAR' : 'MODERN INDIAN WOMENSWEAR'}
            </h2>

            <p className="text-xs sm:text-sm text-[#DDD2C4] font-light leading-relaxed max-w-md pt-1">
              Timeless silhouettes. Contemporary craftsmanship. For every occasion that matters.
            </p>

            {/* Dual CTA Buttons */}
            <div className="flex flex-wrap items-center gap-3.5 pt-3">
              <Link
                href={hrefFor('plp', { gender: activeGender })}
                className="inline-flex items-center gap-2.5 px-8 py-3.5 bg-white text-[#181716] hover:bg-[#F3EFE9] text-xs uppercase tracking-[0.20em] font-medium transition-all shadow-md cursor-pointer rounded-full"
              >
                <span>{isMen ? 'SHOP MEN' : 'SHOP WOMEN'}</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </Link>

              <Link
                href={hrefFor('plp', { gender: activeGender, category: isMen ? 'Festive & Ceremonial' : 'Festive Silk Edit' })}
                className="inline-flex items-center gap-2.5 px-8 py-3.5 border border-white/80 bg-black/25 backdrop-blur-xs text-white hover:bg-white hover:text-[#181716] text-xs uppercase tracking-[0.20em] font-medium transition-all cursor-pointer rounded-full"
              >
                <span>EXPLORE FESTIVE</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </Link>
            </div>
          </div>

          {/* Right Editorial Watermark (as seen in mockup) */}
          <div className="hidden lg:block text-right pb-2">
            <div className="text-xs tracking-[0.32em] uppercase font-light text-white/85 space-y-1">
              <p>TRADITION</p>
              <p>TAILORED</p>
              <p>FOR A</p>
              <p className="font-medium text-white">{isMen ? 'MODERN MAN' : 'MODERN WOMAN'}</p>
            </div>
          </div>
        </div>
      </section>

      {/* ======================================================== */}
      {/* 2. TRUST BADGES BAR (4 Columns) */}
      {/* ======================================================== */}
      <section className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-8">
        <div className="bg-white rounded-2xl border border-[#EAE3D7] py-6 px-8 max-[359px]:px-5 shadow-sm">
          <div className="grid grid-cols-2 max-[359px]:grid-cols-1 md:grid-cols-4 gap-6 sm:gap-8">
            {/* Perk 1 */}
            <div className="flex items-center gap-3.5">
              <div className="p-2.5 rounded-full bg-[#FAF7F2] text-[#876448]">
                <Truck className="w-5 h-5 stroke-[1.6]" />
              </div>
              <div>
                <h4 className="text-xs uppercase tracking-wider font-semibold text-[#181716]">
                  {policies.freeDeliveryAbove !== null ? 'FREE DELIVERY' : 'DELIVERY TO YOUR PIN CODE'}
                </h4>
                <p className="text-[11px] text-[#7A7065] font-light">
                  {policies.freeDeliveryAbove !== null ? `On orders above ${formatPrice(policies.freeDeliveryAbove)}` : 'PIN code checked before you pay'}
                </p>
              </div>
            </div>

            {/* Perk 2 */}
            <div className="flex items-center gap-3.5">
              <div className="p-2.5 rounded-full bg-[#FAF7F2] text-[#876448]">
                <RotateCcw className="w-5 h-5 stroke-[1.6]" />
              </div>
              <div>
                <h4 className="text-xs uppercase tracking-wider font-semibold text-[#181716]">
                  {policies.returnWindowDays !== null ? `${policies.returnWindowDays} DAY RETURNS` : 'EASY RETURNS'}
                </h4>
                <p className="text-[11px] text-[#7A7065] font-light">On eligible items, from delivery</p>
              </div>
            </div>

            {/* Perk 3 */}
            <div className="flex items-center gap-3.5">
              <div className="p-2.5 rounded-full bg-[#FAF7F2] text-[#876448]">
                <ShieldCheck className="w-5 h-5 stroke-[1.6]" />
              </div>
              <div>
                <h4 className="text-xs uppercase tracking-wider font-semibold text-[#181716]">
                  SECURE PAYMENTS
                </h4>
                <p className="text-[11px] text-[#7A7065] font-light">Razorpay · UPI · Cards · COD</p>
              </div>
            </div>

            {/* Perk 4 */}
            <div className="flex items-center gap-3.5">
              <div className="p-2.5 rounded-full bg-[#FAF7F2] text-[#876448]">
                <Leaf className="w-5 h-5 stroke-[1.6]" />
              </div>
              <div>
                <h4 className="text-xs uppercase tracking-wider font-semibold text-[#181716]">
                  HANDCRAFTED FABRICS
                </h4>
                <p className="text-[11px] text-[#7A7065] font-light">Thoughtful fabrics &amp; modern fits</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ======================================================== */}
      {/* 3. CATEGORY STORY BUBBLES (8 Circular Silhouettes) */}
      {/* ======================================================== */}
      <StoryBubbles categories={editorial.categories} />

      {/* ======================================================== */}
      {/* 4. HERO 2: ELEVATED EVERYDAY (Tradition Tailored for Today) */}
      {/* ======================================================== */}
      <section className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-8">
        <div className="relative rounded-3xl overflow-hidden bg-[#1F1C18] min-h-[420px] sm:min-h-[480px] lg:min-h-[520px] flex items-center shadow-xl">
          {/* Background image of model in linen shirt with sunglasses */}
          <div className="absolute inset-0">
            {editorial.feature && (
              <img
                src={editorial.feature}
                alt="Tradition Tailored for Today"
                className="w-full h-full object-cover object-[center_20%] brightness-[0.78]"
              />
            )}
            {/* Ambient gradients */}
            <div className="absolute inset-0 bg-gradient-to-r from-black/85 via-black/45 to-transparent" />
          </div>

          <div className="relative z-10 p-8 sm:p-14 lg:p-18 max-w-xl text-white space-y-4">
            <span className="text-[11px] tracking-[0.28em] uppercase font-light text-[#E5DCD0] block">
              ELEVATED EVERYDAY
            </span>

            <h2 className="font-editorial text-3xl sm:text-5xl lg:text-6xl text-white font-normal leading-[1.1]">
              Tradition Tailored for Today
            </h2>

            <p className="text-xs sm:text-sm text-[#DDD3C5] font-light leading-relaxed max-w-md">
              {isMen
                ? 'From refined staples to statement styles. Discover modern Indian menswear for work, celebrations and beyond.'
                : 'From sculpted wrap co-ords to effortless sarees. Discover modern Indian womenswear for celebrations and beyond.'}
            </p>

            <div className="pt-2">
              <Link
                href={hrefFor('plp', { gender: activeGender })}
                className="inline-flex items-center gap-2.5 px-8 py-3.5 bg-white text-[#181716] hover:bg-[#F3EFE9] text-xs uppercase tracking-[0.20em] font-medium transition-all shadow-md cursor-pointer rounded-full"
              >
                <span>{isMen ? "EXPLORE MEN'S COLLECTION" : "EXPLORE WOMEN'S COLLECTION"}</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </Link>
            </div>
          </div>

          {/* Right Column Editorial Callout */}
          <div className="hidden lg:block absolute right-12 bottom-12 text-right text-xs tracking-[0.30em] uppercase font-light text-white/80 space-y-1.5">
            <p>MODERN SILHOUETTES</p>
            <p>GENUINE CRAFT</p>
            <p>TIMELESS APPEAL</p>
          </div>
        </div>
      </section>

      {/* ======================================================== */}
      {/* 5. NEW ARRIVALS CAROUSEL / GRID (6 Products) */}
      {/* ======================================================== */}
      <section className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between border-b border-[#EAE3D7] pb-4 mb-8">
          <div>
            <h3 className="font-editorial text-2xl sm:text-3xl lg:text-4xl text-[#181716] font-normal uppercase tracking-wider">
              NEW ARRIVALS
            </h3>
          </div>
          <Link
            href={hrefFor('plp', { gender: activeGender })}
            className="text-xs uppercase tracking-[0.18em] font-medium text-[#181716] hover:text-[var(--color-primary)] flex items-center gap-1.5 cursor-pointer"
          >
            <span>View All</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>

        {/* 6 Product Cards Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4 sm:gap-5">
          {newArrivals.map((prod) => (
            <ProductCard
              key={prod.id}
              product={prod}
              onSelectProduct={onSelectProduct}
              isWishlisted={wishlistIds.has(prod.id)}
              onToggleWishlist={onToggleWishlist}
              onQuickAdd={onQuickAdd}
              onInstantAddSize={onInstantAddSize}
            />
          ))}
        </div>
      </section>

      {/* ======================================================== */}
      {/* 6. VANYA ON INSTAGRAM: Watch. Shop. Wear. (Reels Carousel) */}
      {/* ======================================================== */}
      <section className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
          {/* Left Instagram Callout Card */}
          <div className="lg:col-span-3 bg-[#FAF8F5] border border-[#EAE3D7] p-8 rounded-2xl flex flex-col justify-between space-y-6 shadow-xs">
            <div className="space-y-3">
              <span className="text-[10px] tracking-[0.28em] uppercase font-light text-[#876448] block">
                VANYA ON INSTAGRAM
              </span>
              <h3 className="font-editorial text-3xl sm:text-4xl text-[#181716] font-normal leading-tight">
                Watch.<br />Shop. Wear.
              </h3>
              <p className="text-xs text-[#7A7065] font-light leading-relaxed">
                Real {isMen ? 'men' : 'women'}. Real moments. Curated looks from our latest reels.
              </p>
            </div>

            <div>
              <Link
                href={hrefFor('reels')}
                className="w-full inline-flex items-center justify-center gap-2 px-6 py-3.5 bg-[#181716] text-white hover:bg-black text-xs uppercase tracking-[0.18em] font-medium transition-all rounded-full cursor-pointer shadow-md"
              >
                <Instagram className="w-3.5 h-3.5" />
                <span>{isMen ? 'VIEW @VANYA.MEN' : 'VIEW @VANYA.WOMEN'}</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </Link>
            </div>
          </div>

          {/* Right Reel Cards (6 Vertical Video Cards) */}
          <div className="lg:col-span-9 grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3.5">
            {curatedReels.map((reel) => {
              const taggedProd = departmentProducts.find((p) => reel.taggedProductIds.includes(p.id));
              return (
                <div
                  key={reel.id}
                  className="group relative aspect-[9/16] rounded-2xl overflow-hidden bg-black cursor-pointer shadow-sm border border-black/10 flex flex-col justify-between p-3.5"
                >
                  <Link href={hrefFor('reels', { reelId: reel.id })} aria-label={`Shop the look: ${reel.title}`} className="absolute inset-0 z-[5]" />
                  <img
                    src={reel.thumbnail}
                    alt={reel.title}
                    loading="lazy"
                    className="absolute inset-0 w-full h-full object-cover brightness-[0.85] transition-transform duration-700 ease-out group-hover:scale-105"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-transparent to-black/30" />

                  {/* Top: View count badge */}
                  <div className="relative z-10 flex items-center justify-between">
                    <span className="inline-flex items-center gap-1 px-2.5 py-0.8 bg-black/60 backdrop-blur-xs rounded-full text-[9px] font-mono text-white/90">
                      <Play className="w-2.5 h-2.5 fill-current" />
                      {reel.views && <span>{reel.views}</span>}
                    </span>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (taggedProd) onToggleWishlist(taggedProd.id);
                      }}
                      className="relative z-10 p-1.5 rounded-full bg-white/20 hover:bg-white/40 text-white transition-colors"
                      aria-label="Wishlist tagged product"
                    >
                      <Heart className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  {/* Bottom: Title & Shop button */}
                  <div className="relative z-10 space-y-1.5">
                    <h5 className="text-white text-xs font-medium leading-tight truncate">
                      {reel.title}
                    </h5>
                    <span className="text-[10px] tracking-[0.16em] uppercase font-medium text-[#EADFCB] group-hover:underline flex items-center gap-1">
                      <span>SHOP THIS LOOK</span>
                      <ArrowRight className="w-3 h-3 group-hover:translate-x-1 transition-transform" />
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ======================================================== */}
      {/* 7. OCCASION TRIO BANNERS (3 Columns) */}
      {/* ======================================================== */}
      <section className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {/* Banner 1: Workwear */}
          <Link
            href={editorial.occasions[0]?.href ?? hrefFor('plp', { gender: activeGender, category: isMen ? 'Linen & Silk Shirts' : 'Co-ords & Sets' })}
            className="group relative aspect-[4/3] rounded-2xl overflow-hidden cursor-pointer shadow-md bg-[#181716] flex flex-col justify-end p-6 sm:p-8"
          >
            {editorial.occasions[0]?.image && <img
              src={editorial.occasions[0]?.image ?? undefined}
              alt="For Work"
              className="absolute inset-0 w-full h-full object-cover object-top brightness-[0.75] transition-transform duration-700 group-hover:scale-105"
            />}
            <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/30 to-transparent" />
            <div className="relative z-10 text-white space-y-2">
              <span className="text-[10px] tracking-[0.24em] uppercase font-light text-[#E0D5C7] block">
                FOR WORK
              </span>
              <h4 className="font-editorial text-2xl sm:text-3xl text-white font-normal leading-tight">
                Refined Staples
              </h4>
              <span
                className="mt-2 inline-flex items-center gap-2 px-6 py-2.5 bg-white text-[#181716] hover:bg-[#F3EFE9] text-[11px] uppercase tracking-[0.18em] font-medium transition-all rounded-full shadow-sm"
              >
                <span>SHOP WORKWEAR</span>
                <ArrowRight className="w-3 h-3" />
              </span>
            </div>
          </Link>

          {/* Banner 2: Celebration */}
          <Link
            href={editorial.occasions[1]?.href ?? hrefFor('plp', { gender: activeGender, category: isMen ? 'Festive & Ceremonial' : 'Festive Silk Edit' })}
            className="group relative aspect-[4/3] rounded-2xl overflow-hidden cursor-pointer shadow-md bg-[#181716] flex flex-col justify-end p-6 sm:p-8"
          >
            {editorial.occasions[1]?.image && <img
              src={editorial.occasions[1]?.image ?? undefined}
              alt="For Celebration"
              className="absolute inset-0 w-full h-full object-cover object-top brightness-[0.75] transition-transform duration-700 group-hover:scale-105"
            />}
            <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/30 to-transparent" />
            <div className="relative z-10 text-white space-y-2">
              <span className="text-[10px] tracking-[0.24em] uppercase font-light text-[#E0D5C7] block">
                FOR CELEBRATION
              </span>
              <h4 className="font-editorial text-2xl sm:text-3xl text-white font-normal leading-tight">
                Festive Tailoring
              </h4>
              <span
                className="mt-2 inline-flex items-center gap-2 px-6 py-2.5 bg-white text-[#181716] hover:bg-[#F3EFE9] text-[11px] uppercase tracking-[0.18em] font-medium transition-all rounded-full shadow-sm"
              >
                <span>SHOP FESTIVE</span>
                <ArrowRight className="w-3 h-3" />
              </span>
            </div>
          </Link>

          {/* Banner 3: Travel / Resort */}
          <Link
            href={editorial.occasions[2]?.href ?? hrefFor('plp', { gender: activeGender, category: isMen ? 'Pleated Trousers' : 'Dresses' })}
            className="group relative aspect-[4/3] rounded-2xl overflow-hidden cursor-pointer shadow-md bg-[#181716] flex flex-col justify-end p-6 sm:p-8"
          >
            {editorial.occasions[2]?.image && <img
              src={editorial.occasions[2]?.image ?? undefined}
              alt="For Travel"
              className="absolute inset-0 w-full h-full object-cover object-top brightness-[0.75] transition-transform duration-700 group-hover:scale-105"
            />}
            <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/30 to-transparent" />
            <div className="relative z-10 text-white space-y-2">
              <span className="text-[10px] tracking-[0.24em] uppercase font-light text-[#E0D5C7] block">
                FOR TRAVEL
              </span>
              <h4 className="font-editorial text-2xl sm:text-3xl text-white font-normal leading-tight">
                Relaxed Linen
              </h4>
              <span
                className="mt-2 inline-flex items-center gap-2 px-6 py-2.5 bg-white text-[#181716] hover:bg-[#F3EFE9] text-[11px] uppercase tracking-[0.18em] font-medium transition-all rounded-full shadow-sm"
              >
                <span>SHOP LINEN</span>
                <ArrowRight className="w-3 h-3" />
              </span>
            </div>
          </Link>
        </div>
      </section>

      {/* ======================================================== */}
      {/* 8. AS SEEN ON TASTEMAKERS (6 Editorial Photos) */}
      {/* ======================================================== */}
      {tastemakerPhotos.length > 0 && (
      <section className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center max-w-xl mx-auto mb-8 space-y-1">
          <h3 className="font-editorial text-2xl sm:text-3xl text-[#181716] font-normal uppercase tracking-wider">
            AS SEEN ON TASTEMAKERS
          </h3>
          <p className="text-xs text-[#7A7065] font-light">
            Modern {isMen ? 'men' : 'women'}, meaningful moments. VANYA in real life.
          </p>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3.5">
          {tastemakerPhotos.map((item) => (
            <div
              key={item.id}
              className="group relative aspect-[4/5] rounded-2xl overflow-hidden bg-[#FAF8F5] shadow-xs border border-[#EAE3D7]"
            >
              <img
                src={item.image}
                alt={item.caption}
                loading="lazy"
                className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity p-3 flex items-end">
                <span className="text-[10px] text-white leading-tight font-light">
                  {item.caption}
                </span>
              </div>
            </div>
          ))}
        </div>
      </section>
      )}

      {/* ======================================================== */}
      {/* 9. BRAND PILLARS BAR (4 Value Propositions) */}
      {/* ======================================================== */}
      <section className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-8 pt-4">
        <div className="border-t border-[#EAE3D7] pt-10">
          <div className="grid grid-cols-2 max-[359px]:grid-cols-1 md:grid-cols-4 gap-6 sm:gap-8">
            {/* Pillar 1 */}
            <div className="flex items-start gap-3.5 p-3 rounded-2xl bg-white border border-[#F0ECE4] shadow-xs">
              <div className="p-2 rounded-full bg-[#FAF7F2] text-[#876448]">
                <Gem className="w-5 h-5 stroke-[1.6]" />
              </div>
              <div>
                <h5 className="text-xs uppercase tracking-wider font-semibold text-[#181716]">
                  Premium Craftsmanship
                </h5>
                <p className="text-[11px] text-[#7A7065] font-light mt-0.5">
                  Modern silhouettes with Indian roots
                </p>
              </div>
            </div>

            {/* Pillar 2 */}
            <div className="flex items-start gap-3.5 p-3 rounded-2xl bg-white border border-[#F0ECE4] shadow-xs">
              <div className="p-2 rounded-full bg-[#FAF7F2] text-[#876448]">
                <Ruler className="w-5 h-5 stroke-[1.6]" />
              </div>
              <div>
                <h5 className="text-xs uppercase tracking-wider font-semibold text-[#181716]">
                  Thoughtful Fits
                </h5>
                <p className="text-[11px] text-[#7A7065] font-light mt-0.5">
                  Designed for the modern {isMen ? 'man' : 'woman'}
                </p>
              </div>
            </div>

            {/* Pillar 3 */}
            <div className="flex items-start gap-3.5 p-3 rounded-2xl bg-white border border-[#F0ECE4] shadow-xs">
              <div className="p-2 rounded-full bg-[#FAF7F2] text-[#876448]">
                <Leaf className="w-5 h-5 stroke-[1.6]" />
              </div>
              <div>
                <h5 className="text-xs uppercase tracking-wider font-semibold text-[#181716]">
                  Natural Fabrics
                </h5>
                <p className="text-[11px] text-[#7A7065] font-light mt-0.5">
                  Linen, cotton, silk blends &amp; more
                </p>
              </div>
            </div>

            {/* Pillar 4 */}
            <div className="flex items-start gap-3.5 p-3 rounded-2xl bg-white border border-[#F0ECE4] shadow-xs">
              <div className="p-2 rounded-full bg-[#FAF7F2] text-[#876448]">
                <Package className="w-5 h-5 stroke-[1.6]" />
              </div>
              <div>
                <h5 className="text-xs uppercase tracking-wider font-semibold text-[#181716]">
                  The VANYA Experience
                </h5>
                <p className="text-[11px] text-[#7A7065] font-light mt-0.5">
                  A more thoughtful today
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
