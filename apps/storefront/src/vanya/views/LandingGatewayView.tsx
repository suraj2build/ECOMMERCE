'use client';

import React from 'react';
import Link from 'next/link';
import { Search, User, ShoppingBag, Truck, Package } from 'lucide-react';
import { useShop } from '../bridge/shop';
import { formatPrice } from '../utils/format';

interface LandingGatewayViewProps {
  onSelectDepartment: (gender: 'men' | 'women') => void;
  onOpenSearch?: () => void;
  onOpenBag?: () => void;
  cartCount?: number;
  /** Editorial photographs (CMS placements gateway-men / gateway-women). */
  menHeroImage?: string | null;
  womenHeroImage?: string | null;
}

/**
 * Traditional Indian 4-petal diamond floral star motif as seen in high-end Indian couture.
 */
function FloralMotif({ className = 'w-3.5 h-3.5 text-[#C5A278]' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2C12 7.2 7.2 12 2 12C7.2 12 12 16.8 12 22C12 16.8 16.8 12 22 12C16.8 12 12 7.2 12 2Z" />
      <circle cx="5" cy="5" r="1.2" />
      <circle cx="19" cy="5" r="1.2" />
      <circle cx="5" cy="19" r="1.2" />
      <circle cx="19" cy="19" r="1.2" />
      <circle cx="12" cy="12" r="1.5" fill="#0D0B0A" />
    </svg>
  );
}

export function LandingGatewayView({
  onSelectDepartment,
  onOpenSearch,
  onOpenBag,
  cartCount = 0,
  menHeroImage,
  womenHeroImage,
}: LandingGatewayViewProps) {
  // The original's "Complimentary shipping" is shown only as the confirmed free-delivery threshold.
  const { freeDeliveryAbove } = useShop().policies;

  return (
    <div className="relative w-full h-[calc(100svh-var(--preview-banner-h,0px))] min-h-[640px] bg-[#0E0C0B] text-[#FAF8F5] overflow-hidden flex flex-col justify-between select-none">
      {/* ======================================================== */}
      {/* 1. TOP HEADER BAR (OVERLAY) */}
      {/* ======================================================== */}
      <header className="absolute top-0 inset-x-0 z-30 px-6 sm:px-12 py-5 sm:py-6 flex items-center justify-between pointer-events-auto">
        {/* Left: Location */}
        <div className="w-1/4 sm:w-1/3">
          <span className="hidden sm:inline text-[11px] sm:text-xs tracking-[0.28em] uppercase font-light text-white/90">
            NEW DELHI · INDIA
          </span>
        </div>

        {/* Center: Brand Name & Tagline with Dashes */}
        <div className="flex-1 sm:w-1/3 sm:flex-none text-center flex flex-col items-center">
          <h1 className="font-editorial text-3xl sm:text-4xl lg:text-[42px] tracking-[0.32em] font-normal uppercase text-white leading-none">
            VANYA
          </h1>
          <div className="flex items-center justify-center gap-1.5 mt-1.5 text-[8px] sm:text-[10px] tracking-[0.18em] sm:tracking-[0.24em] uppercase text-[#DDD3C5] font-light whitespace-nowrap">
            <span>— INDIAN ROOTS · MODERN FORM —</span>
          </div>
        </div>

        {/* Right: Search | Account | Bag */}
        <div className="w-1/4 sm:w-1/3 flex items-center justify-end gap-2 sm:gap-4 text-[10px] sm:text-[11px] tracking-[0.18em] uppercase font-medium text-white/90">
          <button
            type="button"
            onClick={onOpenSearch}
            aria-label="Search"
            className="flex items-center gap-1.5 hover:text-white transition-colors cursor-pointer"
          >
            <Search className="w-3.5 h-3.5 stroke-[1.8]" />
            <span className="hidden sm:inline">SEARCH</span>
          </button>

          <span className="hidden sm:inline text-white/30 font-light">|</span>

          <Link
            href="/account"
            aria-label="Account"
            className="hidden sm:flex items-center gap-1.5 hover:text-white transition-colors cursor-pointer"
          >
            <User className="w-3.5 h-3.5 stroke-[1.8]" />
            <span className="hidden sm:inline">ACCOUNT</span>
          </Link>

          <span className="hidden sm:inline text-white/30 font-light">|</span>

          <button
            type="button"
            onClick={onOpenBag}
            aria-label={`Shopping bag, ${cartCount} ${cartCount === 1 ? 'item' : 'items'}`}
            className="flex items-center gap-1.5 hover:text-white transition-colors cursor-pointer"
          >
            <ShoppingBag className="w-3.5 h-3.5 stroke-[1.8]" />
            <span>BAG ({cartCount})</span>
          </button>
        </div>
      </header>

      {/* ======================================================== */}
      {/* 2. SPLIT SCREEN (MEN on Left | WOMEN on Right) */}
      {/* ======================================================== */}
      <main className="relative z-10 flex-1 w-full flex flex-col lg:flex-row overflow-hidden">
        {/* LEFT HALF: MEN */}
        {/* The whole panel is a pointer target; the ENTER button is the keyboard one. */}
        {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- the ENTER button is the keyboard control */}
        <section
          onClick={() => onSelectDepartment('men')}
          className="relative lg:w-1/2 flex-1 min-h-[50vh] lg:min-h-full overflow-hidden flex flex-col justify-end p-8 sm:p-14 lg:p-16 border-b lg:border-b-0 lg:border-r border-black/40 cursor-pointer group"
        >
          {/* Background Image */}
          <div className="absolute inset-0 z-0 overflow-hidden">
            {menHeroImage && (
              <img
                src={menHeroImage}
                alt="Modern Indian Menswear"
                className="w-full h-full object-cover object-[center_top] brightness-[0.82] transition-transform duration-1000 ease-out group-hover:scale-105"
              />
            )}
            {/* Ambient Lighting & Shadow Vignette */}
            <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/35 to-black/20" />
            <div className="absolute inset-0 bg-gradient-to-r from-black/40 via-transparent to-black/30" />
          </div>

          {/* Men's Content Overlay */}
          <div className="relative z-10 max-w-md">
            <h2 className="font-editorial text-5xl sm:text-6xl lg:text-7xl font-normal tracking-[0.14em] text-white uppercase leading-none">
              MEN
            </h2>

            <span className="text-xs sm:text-[13px] tracking-[0.24em] uppercase text-[#EDE4D5] font-light block mt-3">
              MODERN INDIAN MENSWEAR
            </span>

            {/* Delicate underline */}
            <div className="w-48 sm:w-56 h-[1px] bg-white/45 my-3.5" />

            <p className="text-sm sm:text-base text-[#DDD4C7] font-light mb-6">
              Tradition in a modern world.
            </p>

            <button
              type="button"
              aria-label="Enter MEN store"
              onClick={(e) => {
                e.stopPropagation();
                onSelectDepartment('men');
              }}
              className="group/btn inline-flex items-center gap-3.5 px-8 py-3.5 border border-white/80 bg-black/25 backdrop-blur-xs text-white text-xs uppercase tracking-[0.22em] font-medium hover:bg-white hover:text-black transition-all duration-300 cursor-pointer shadow-lg active:scale-95 rounded-full"
            >
              <span>ENTER MEN</span>
              <span className="transition-transform duration-300 group-hover/btn:translate-x-1.5 text-sm">
                →
              </span>
            </button>
          </div>
        </section>

        {/* RIGHT HALF: WOMEN */}
        {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- the ENTER button is the keyboard control */}
        <section
          onClick={() => onSelectDepartment('women')}
          className="relative lg:w-1/2 flex-1 min-h-[50vh] lg:min-h-full overflow-hidden flex flex-col justify-end p-8 sm:p-14 lg:p-16 cursor-pointer group"
        >
          {/* Background Image */}
          <div className="absolute inset-0 z-0 overflow-hidden">
            {womenHeroImage && (
              <img
                src={womenHeroImage}
                alt="Modern Indian Womenswear"
                className="w-full h-full object-cover object-[center_top] brightness-[0.82] transition-transform duration-1000 ease-out group-hover:scale-105"
              />
            )}
            {/* Ambient Lighting & Shadow Vignette */}
            <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/35 to-black/20" />
            <div className="absolute inset-0 bg-gradient-to-l from-black/40 via-transparent to-black/30" />
          </div>

          {/* Women's Content Overlay */}
          <div className="relative z-10 max-w-md">
            <h2 className="font-editorial text-5xl sm:text-6xl lg:text-7xl font-normal tracking-[0.14em] text-white uppercase leading-none">
              WOMEN
            </h2>

            <span className="text-xs sm:text-[13px] tracking-[0.24em] uppercase text-[#EDE4D5] font-light block mt-3">
              MODERN INDIAN WOMENSWEAR
            </span>

            {/* Delicate underline */}
            <div className="w-48 sm:w-56 h-[1px] bg-white/45 my-3.5" />

            <p className="text-sm sm:text-base text-[#DDD4C7] font-light mb-6">
              Timeless tradition, for today.
            </p>

            <button
              type="button"
              aria-label="Enter WOMEN store"
              onClick={(e) => {
                e.stopPropagation();
                onSelectDepartment('women');
              }}
              className="group/btn inline-flex items-center gap-3.5 px-8 py-3.5 border border-white/80 bg-black/25 backdrop-blur-xs text-white text-xs uppercase tracking-[0.22em] font-medium hover:bg-white hover:text-black transition-all duration-300 cursor-pointer shadow-lg active:scale-95 rounded-full"
            >
              <span>ENTER WOMEN</span>
              <span className="transition-transform duration-300 group-hover/btn:translate-x-1.5 text-sm">
                →
              </span>
            </button>
          </div>
        </section>
      </main>

      {/* ======================================================== */}
      {/* 3. BOTTOM FOOTER STRIP / TICKER */}
      {/* ======================================================== */}
      <footer className="relative z-20 w-full bg-[#0D0B0A] border-t border-white/10 py-3.5 sm:py-4 px-6 sm:px-12 flex flex-wrap items-center justify-center gap-5 sm:gap-10 text-center select-none">
        {/* Item 1 */}
        <div className="flex items-center gap-2">
          <FloralMotif className="w-3.5 h-3.5 text-[#C5A278]" />
          <span className="text-[10px] sm:text-[11px] tracking-[0.22em] uppercase text-[#D8CFBF] font-light">
            NEW SEASON
          </span>
        </div>

        <span className="text-white/20 hidden sm:inline font-light">|</span>

        {/* Item 2 */}
        <div className="flex items-center gap-2">
          <FloralMotif className="w-3.5 h-3.5 text-[#C5A278]" />
          <span className="text-[10px] sm:text-[11px] tracking-[0.22em] uppercase text-[#D8CFBF] font-light">
            FESTIVE 2026
          </span>
        </div>

        <span className="text-white/20 hidden sm:inline font-light">|</span>

        {/* Item 3 */}
        <div className="flex items-center gap-2">
          <Truck className="w-3.5 h-3.5 text-[#C5A278] stroke-[1.8]" />
          <span className="text-[10px] sm:text-[11px] tracking-[0.22em] uppercase text-[#D8CFBF] font-light">
            {freeDeliveryAbove !== null ? `FREE DELIVERY ABOVE ${formatPrice(freeDeliveryAbove)}` : 'DELIVERY CHECKED BY PIN CODE'}
          </span>
        </div>

        <span className="text-white/20 hidden sm:inline font-light">|</span>

        {/* Item 4 */}
        <div className="flex items-center gap-2">
          <Package className="w-3.5 h-3.5 text-[#C5A278] stroke-[1.8]" />
          <span className="text-[10px] sm:text-[11px] tracking-[0.22em] uppercase text-[#D8CFBF] font-light">
            EASY RETURNS
          </span>
        </div>
      </footer>
    </div>
  );
}
