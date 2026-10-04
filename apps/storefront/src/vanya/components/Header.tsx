'use client';

/**
 * The approved AI Studio header (Stitch-Spark_Ai_Studio components/Header.tsx),
 * with the approved separate VANYA brand row ("Vanya Luxury Fashion
 * Header.png") above the desktop navigation. Classes are the design's own.
 * Changes from the prototype, each for a real-data or accessibility reason:
 * links instead of in-memory view switches; real bag, wishlist and rewards
 * counts; the phone header keeps search and bag on screen at 390px. The
 * former separate utility row (department switch / tagline / track order /
 * rewards) was folded into the icon cluster to keep the header compact -
 * see desktopUtilityIcons.
 */
import React, { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { motion, AnimatePresence } from 'motion/react';
import { Search, Heart, ShoppingBag, User, Menu, X, Truck, Coins, Compass } from 'lucide-react';
import { useModalFocus } from '@/components/layout/useModalFocus';
import { useShop } from '../bridge/shop';

// Launch assortment (Product Owner approved, 2026-10-04): Men's daily
// wear/premium shirts/business casual, Women's daily/work/casual/
// partywear. No ethnicwear/ceremonial/wedding for men; no sarees/
// lehengas/bridalwear/festive ethnicwear for women (everyday kurtis stay).
// The top nav shows a representative subset so the row keeps fitting at
// 1024-1279px (see the header-compaction pass); the drawer lists every
// approved category.
const MEN_NAV = [
  { label: 'NEW IN', category: 'new' },
  { label: 'SHIRTS', category: 'Formal Shirts' },
  { label: 'POLOS', category: 'Polo T-Shirts' },
  { label: 'DENIMS', category: 'Denims' },
  { label: 'CHINOS', category: 'Casual Trousers / Chinos' },
  { label: 'SHOES', category: 'Business Casual Shoes' },
];
const WOMEN_NAV = [
  { label: 'NEW IN', category: 'new' },
  { label: 'KURTIS', category: 'Everyday Kurtis' },
  { label: 'DRESSES', category: 'Dresses' },
  { label: 'TOPS', category: 'Tops' },
  { label: 'DENIMS', category: 'Denims' },
  { label: 'SKIRTS', category: 'Skirts' },
];
const MEN_DRAWER = [
  ['Formal Shirts', 'Formal Shirts'],
  ['Casual Shirts', 'Casual Shirts'],
  ['Polo T-Shirts', 'Polo T-Shirts'],
  ['Denims', 'Denims'],
  ['Casual Trousers / Chinos', 'Casual Trousers / Chinos'],
  ['Formal Trousers', 'Formal Trousers'],
  ['Business Casual Shoes', 'Business Casual Shoes'],
  ['Business Casual Belts', 'Business Casual Belts'],
  ['Perfume', 'Perfume'],
];
const WOMEN_DRAWER = [
  ['Tops', 'Tops'],
  ['Tees', 'Tees'],
  ['Everyday Kurtis', 'Everyday Kurtis'],
  ['Denims', 'Denims'],
  ['Dresses', 'Dresses'],
  ['Trousers', 'Trousers'],
  ['Shirts', 'Shirts'],
  ['Skirts', 'Skirts'],
  ['Hotpants / Shorts', 'Hotpants / Shorts'],
];

export function Header() {
  const pathname = usePathname();
  const { gender: currentGender, hrefFor, navigate, cartCount, wishlistIds, loyaltyPoints, setBagOpen, setSearchOpen } = useShop();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [isScrolled, setIsScrolled] = useState(false);
  const drawerRef = useRef<HTMLDivElement>(null);
  useModalFocus(mobileMenuOpen, drawerRef, () => setMobileMenuOpen(false));
  const wishlistCount = wishlistIds.size;

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 20);
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);
  useEffect(() => setMobileMenuOpen(false), [pathname]);

  const isMen = currentGender === 'men';
  const nav = isMen ? MEN_NAV : WOMEN_NAV;
  const isHome = pathname === '/';
  const isReels = pathname.startsWith('/watch-and-shop');
  const homeLabel = isMen ? 'MEN' : 'WOMEN';

  const searchPill = (
    <button
      type="button"
      onClick={() => setSearchOpen(true)}
      aria-label="Search"
      className="hidden lg:flex items-center gap-2 bg-[#F6F4F0] hover:bg-[#EFECE5] px-3 py-1.5 rounded-full border border-[#E5DFD5] transition-colors cursor-pointer w-36 xl:w-56 text-[#5F564C]"
    >
      <Search className="w-3.5 h-3.5 shrink-0 text-[#9E9488]" />
      <span className="text-[11px] truncate tracking-normal font-light">
        {isMen ? 'Search shirts, chinos...' : 'Search kurtis, dresses...'}
      </span>
    </button>
  );

  const icons = (
    <>
      {/* Mobile Search Icon */}
      <button
        type="button"
        onClick={() => setSearchOpen(true)}
        className="lg:hidden p-2 text-[#59534C] hover:text-[#181716] transition-colors cursor-pointer"
        aria-label="Search"
      >
        <Search className="w-4 h-4 text-[#7A7065]" />
      </button>

      {/* User Account Icon */}
      <Link
        href="/account"
        className="hidden sm:inline-flex p-1.5 text-[#3D3732] hover:text-[#181716] transition-colors cursor-pointer"
        title="Account &amp; Orders"
        aria-label="Account"
      >
        <User className="w-4 h-4 stroke-[1.6]" />
      </Link>

      {/* Wishlist Heart Icon */}
      <Link
        id="btn-header-wishlist"
        href="/wishlist"
        className="p-1.5 text-[#3D3732] hover:text-[#181716] relative transition-colors cursor-pointer"
        title="Wishlist"
        aria-label={`Wishlist, ${wishlistCount} ${wishlistCount === 1 ? 'item' : 'items'}`}
      >
        <Heart className="w-4 h-4 stroke-[1.6]" />
        {wishlistCount > 0 && (
          <span aria-hidden="true" className="absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full bg-[#181716] text-white text-[9px] font-bold flex items-center justify-center">
            {wishlistCount}
          </span>
        )}
      </Link>

      {/* Shopping Bag Button with Badge */}
      <motion.button
        id="btn-header-bag"
        type="button"
        whileTap={{ scale: 0.92 }}
        onClick={() => setBagOpen(true)}
        className="p-1.5 text-[#3D3732] hover:text-[#181716] relative transition-colors cursor-pointer shrink-0"
        title="Shopping Bag"
        aria-label={`Shopping bag, ${cartCount} ${cartCount === 1 ? 'item' : 'items'}`}
      >
        <ShoppingBag className="w-4 h-4 stroke-[1.6]" />
        <span aria-hidden="true" className="absolute -top-0.5 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-[#181716] text-white text-[9px] font-bold flex items-center justify-center font-mono">
          {cartCount}
        </span>
      </motion.button>
    </>
  );

  const desktopUtilityIcons = (
    <>
      {/* Choose Department */}
      <button
        type="button"
        onClick={() => navigate('gateway')}
        className="hidden xl:inline-flex p-1.5 text-[#3D3732] hover:text-[#181716] transition-colors cursor-pointer"
        title="Choose Department (Men / Women)"
        aria-label="Choose Department"
      >
        <Compass className="w-4 h-4 stroke-[1.6]" />
      </button>

      {/* Track Order */}
      <Link
        href="/orders"
        className="hidden xl:inline-flex p-1.5 text-[#3D3732] hover:text-[#181716] transition-colors cursor-pointer"
        title="Track Order"
        aria-label="Track Order"
      >
        <Truck className="w-4 h-4 stroke-[1.6]" />
      </Link>

      {/* Rewards */}
      <Link
        href="/account/loyalty"
        className="hidden xl:inline-flex p-1.5 text-[#3D3732] hover:text-[#181716] transition-colors cursor-pointer"
        title={`Rewards${loyaltyPoints !== null ? ` (${loyaltyPoints.toLocaleString('en-IN')} Pts)` : ''}`}
        aria-label="Rewards"
      >
        <Coins className="w-4 h-4 stroke-[1.6]" />
      </Link>
    </>
  );

  return (
    <>
      <header
        id="main-header"
        className={`sticky top-0 z-40 transition-all duration-300 ${
          isScrolled
            ? 'bg-white/98 backdrop-blur-md shadow-2xs border-b border-[#EFECE6]'
            : 'bg-white border-b border-[#F0ECE4]'
        }`}
      >
        {/* Main Navigation Bar */}
        <div className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-8">
          {/* Brand row (desktop); on phones the original single row. */}
          <div className="flex items-center justify-between h-14 sm:h-16 gap-4 lg:justify-center lg:border-b lg:border-[#F4EFE6]">
            {/* Mobile menu button */}
            <button
              id="btn-mobile-menu-toggle"
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              className="lg:hidden p-2 -ml-2 text-[#221D19] hover:opacity-70 transition-opacity"
              aria-label="Open menu"
              aria-expanded={mobileMenuOpen}
              aria-controls="vanya-mobile-nav"
            >
              <Menu className="w-5 h-5" />
            </button>

            {/* Center Column: Prominent Luxury Brand Logo with Tagline.
                A plain unmodified left-click switches department (same
                navigate('gateway') the Compass icon button uses); Ctrl/Cmd/
                Shift/middle-click fall through to the real href so opening
                in a new tab still works normally. */}
            <Link
              href="/"
              aria-label="VANYA — choose Men or Women"
              onClick={(e) => {
                if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
                e.preventDefault();
                navigate('gateway');
              }}
              className="text-center cursor-pointer select-none px-2 lg:px-4 shrink-0"
              title="Switch Department (Men / Women)"
            >
              <span className="font-editorial text-xl sm:text-2xl lg:text-[28px] tracking-[0.28em] font-normal uppercase text-[#181716] block hover:opacity-90 transition-opacity leading-none">
                VANYA
              </span>
              <span className="hidden sm:block text-[8px] sm:text-[9px] tracking-[0.28em] uppercase text-[#73685C] font-light mt-1">
                — INDIAN ROOTS · MODERN TODAY —
              </span>
            </Link>

            <div className="flex lg:hidden items-center gap-2 sm:gap-4">{icons}</div>
          </div>

          {/* Desktop navigation row */}
          <div className="hidden lg:flex items-center justify-between h-12 gap-4">
            {/* Left Nav: Primary Categories */}
            <nav aria-label="Primary" className="flex items-center gap-5 xl:gap-6 text-[11px] xl:text-[12px] tracking-[0.16em] uppercase font-medium whitespace-nowrap">
              <Link
                href="/"
                className={`py-2 transition-colors relative cursor-pointer ${
                  isHome ? 'text-[#181716] font-semibold' : 'text-[#60554A] hover:text-[#181716]'
                }`}
              >
                {homeLabel}
                {isHome && (
                  <motion.div
                    layoutId="activeNavIndicator"
                    className="absolute bottom-0 inset-x-0 h-0.5 bg-[#181716]"
                    transition={{ type: 'spring', stiffness: 350, damping: 30 }}
                  />
                )}
              </Link>
              {nav.map((item) => (
                <Link
                  key={item.label}
                  href={hrefFor('plp', { gender: currentGender, category: item.category })}
                  className="py-2 text-[#60554A] hover:text-[#181716] transition-colors cursor-pointer"
                >
                  {item.label}
                </Link>
              ))}
              <Link
                href="/watch-and-shop"
                className={`py-2 transition-colors flex items-center gap-1.5 cursor-pointer ${
                  isReels ? 'text-[#181716] font-semibold' : 'text-[#60554A] hover:text-[#181716]'
                }`}
              >
                <span>WATCH &amp; SHOP</span>
              </Link>
            </nav>

            {/* Right Column: Integrated Search, and Icons */}
            <div className="flex items-center gap-3 sm:gap-4 lg:gap-5 xl:gap-3 2xl:gap-5">
              {searchPill}
              {desktopUtilityIcons}
              {icons}
            </div>
          </div>
        </div>

        {/* Dynamic Atmosphere Glow Accent Line */}
        <div
          className={`h-[1.5px] w-full transition-all duration-500 ${
            isMen
              ? 'bg-gradient-to-r from-transparent via-[#8F6B4E] to-transparent opacity-80'
              : 'bg-gradient-to-r from-transparent via-[#866791] to-transparent opacity-80'
          }`}
        />
      </header>

      {/* Mobile Slide-Over Drawer */}
      <AnimatePresence>
        {mobileMenuOpen && (
          <div
            id="mobile-nav-backdrop"
            className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex lg:hidden"
            onClick={() => setMobileMenuOpen(false)}
            role="presentation"
          >
            <motion.div
              ref={drawerRef}
              role="dialog"
              aria-modal="true"
              aria-label="Menu"
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={{ type: 'spring', damping: 28, stiffness: 280 }}
              className="w-4/5 max-w-sm bg-white h-full shadow-2xl flex flex-col justify-between rounded-r-3xl overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Drawer Header */}
              <div className="overflow-y-auto">
                <div className="p-5 border-b border-[#EFECE6] flex items-center justify-between">
                  <div>
                    <span className="font-editorial text-2xl tracking-[0.22em] font-normal uppercase text-[#181716] block">
                      VANYA
                    </span>
                    <span className="text-[9px] tracking-[0.25em] uppercase text-[var(--color-primary)] font-light">
                      {isMen ? 'Pour Homme · Men' : 'Pour Femme · Women'}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setMobileMenuOpen(false)}
                    className="p-2.5 -mr-1.5 text-[#665F58] hover:text-black cursor-pointer"
                    aria-label="Close menu"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                {/* Drawer Links */}
                <nav id="vanya-mobile-nav" aria-label="Primary mobile" className="p-5 space-y-3.5 text-xs font-medium uppercase tracking-[0.16em] text-[#2E2A27]">
                  <Link href="/" className="block w-full text-left py-2 border-b border-[#F4F1EA]">
                    Home
                  </Link>
                  <Link href={hrefFor('plp', { gender: currentGender })} className="block w-full text-left py-2 border-b border-[#F4F1EA]">
                    New In
                  </Link>
                  {(isMen ? MEN_DRAWER : WOMEN_DRAWER).map(([label, category]) => (
                    <Link key={label} href={hrefFor('plp', { gender: currentGender, category })} className="block w-full text-left py-2 border-b border-[#F4F1EA]">
                      {label}
                    </Link>
                  ))}
                  <Link href="/collections" className="block w-full text-left py-2 border-b border-[#F4F1EA]">
                    Collections
                  </Link>
                  <Link href="/watch-and-shop" className="block w-full text-left py-2 border-b border-[#F4F1EA]">
                    Watch &amp; Shop
                  </Link>
                  <Link href="/orders" className="block w-full text-left py-2 border-b border-[#F4F1EA]">
                    Track Order
                  </Link>
                  <Link href="/account" className="block w-full text-left py-2 border-b border-[#F4F1EA]">
                    Account
                  </Link>
                </nav>
              </div>

              {/* Drawer Footer Actions */}
              <div className="p-5 bg-[#FAF8F5] border-t border-[#EFECE6] space-y-2.5">
                <button
                  type="button"
                  onClick={() => {
                    navigate('gateway');
                    setMobileMenuOpen(false);
                  }}
                  className="w-full py-3 px-4 bg-white hover:bg-[#F5EFE6] border border-[#DDD3C5] hover:border-[#1A1816] text-xs uppercase tracking-wider font-semibold text-[#181716] rounded-full flex items-center justify-between cursor-pointer shadow-xs transition-colors"
                >
                  <span>← Choose Department (Main Portal)</span>
                  <Compass className="w-3.5 h-3.5 text-[var(--color-primary)]" />
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </>
  );
}
