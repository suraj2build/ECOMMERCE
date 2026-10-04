'use client';

/**
 * The approved AI Studio header (Stitch-Spark_Ai_Studio components/Header.tsx),
 * with the approved separate VANYA brand row ("Vanya Luxury Fashion
 * Header.png") above the desktop navigation. Classes are the design's own.
 * Changes from the prototype, each for a real-data or accessibility reason:
 * links instead of in-memory view switches; real bag, wishlist and rewards
 * counts; the utility announcement uses the design's own department line
 * (AnnouncementBar.tsx) instead of an unapproved delivery/tailoring promise;
 * the phone header keeps search and bag on screen at 390px.
 */
import React, { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { motion, AnimatePresence } from 'motion/react';
import { Search, Heart, ShoppingBag, User, Menu, X, Truck, Coins, Compass } from 'lucide-react';
import { useModalFocus } from '@/components/layout/useModalFocus';
import { useShop } from '../bridge/shop';

const MEN_NAV = [
  { label: 'FESTIVE', category: 'Festive & Ceremonial' },
  { label: 'NEW IN', category: 'new' },
  { label: 'BANDHGALAS', category: 'Bandhgalas & Jackets' },
  { label: 'SHIRTS', category: 'Linen & Silk Shirts' },
  { label: 'KURTAS', category: 'Kurtas' },
  { label: 'TROUSERS', category: 'Pleated Trousers' },
];
const WOMEN_NAV = [
  { label: 'FESTIVE', category: 'Festive Silk Edit' },
  { label: 'NEW IN', category: 'new' },
  { label: 'SAREES', category: 'Modern Sarees' },
  { label: 'CO-ORDS', category: 'Co-ords & Sets' },
  { label: 'DRESSES', category: 'Dresses' },
  { label: 'SETS', category: 'Co-ords & Sets' },
];
const MEN_DRAWER = [
  ['Bandhgalas & Jackets', 'Bandhgalas & Jackets'],
  ['Linen & Silk Shirts', 'Linen & Silk Shirts'],
  ['Handloom Kurtas', 'Kurtas'],
  ['Pleated Trousers', 'Pleated Trousers'],
];
const WOMEN_DRAWER = [
  ['Modern Sarees', 'Modern Sarees'],
  ['Co-ords & Sets', 'Co-ords & Sets'],
  ['Dresses & Drapes', 'Dresses'],
  ['Festive Silk Edit', 'Festive Silk Edit'],
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
        {isMen ? 'Search kurtas, bandhgalas...' : 'Search sarees, dresses...'}
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
        {/* Tier 1: Slim, Airy Utility Bar (Removes clutter from main row) */}
        <div className="hidden lg:block border-b border-[#F4EFE6] bg-[#FAF8F5]/80 text-[#7A7065] text-[11px] py-1.5 px-4 sm:px-8">
          <div className="max-w-7xl mx-auto flex items-center justify-between">
            {/* Left: Direct gateway link */}
            <button
              type="button"
              onClick={() => navigate('gateway')}
              className="flex items-center gap-1.5 hover:text-[#181716] transition-colors cursor-pointer tracking-wider uppercase font-light"
              title="Return to Main Department Gateway to choose Men or Women"
            >
              <Compass className="w-3 h-3 text-[var(--color-primary)]" />
              <span>← Atelier Portals (Choose Department)</span>
            </button>

            {/* Center: the design's department line (AnnouncementBar) */}
            <p className="text-[11px] tracking-[0.16em] uppercase font-light text-[#756A5E]">
              {isMen ? 'A Modern Indian Menswear Brand' : 'A Modern Indian Womenswear Atelier'}
            </p>

            {/* Right: Quick Utilities */}
            <div className="flex items-center gap-5 tracking-wider uppercase font-light">
              <Link
                href="/orders"
                className="flex items-center gap-1 hover:text-[#181716] transition-colors cursor-pointer"
              >
                <Truck className="w-3 h-3 text-[var(--color-primary)]" />
                <span>Track Order</span>
              </Link>

              <Link
                href="/account/loyalty"
                className="flex items-center gap-1 hover:text-[#181716] transition-colors cursor-pointer font-medium text-[#705139]"
              >
                <Coins className="w-3 h-3 text-[var(--color-primary)]" />
                <span>Rewards{loyaltyPoints !== null ? ` (${loyaltyPoints.toLocaleString('en-IN')} Pts)` : ''}</span>
              </Link>
            </div>
          </div>
        </div>

        {/* Tier 2: Main Spacious Haute Couture Navigation Bar */}
        <div className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-8">
          {/* Approved separate brand row (desktop); on phones the original single row. */}
          <div className="flex items-center justify-between h-16 sm:h-20 lg:h-24 gap-4 lg:justify-center lg:border-b lg:border-[#F4EFE6]">
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

            {/* Center Column: Prominent Luxury Brand Logo with Tagline */}
            <Link
              href="/"
              aria-label="VANYA home"
              className="text-center cursor-pointer select-none px-2 lg:px-4 shrink-0"
              title="Return to Atelier Home"
            >
              <span className="font-editorial text-2xl sm:text-3xl lg:text-[42px] tracking-[0.28em] font-normal uppercase text-[#181716] block hover:opacity-90 transition-opacity leading-none">
                VANYA
              </span>
              <span className="hidden sm:block text-[8px] sm:text-[9px] tracking-[0.28em] uppercase text-[#73685C] font-light mt-1">
                — INDIAN ROOTS · MODERN TODAY —
              </span>
            </Link>

            <div className="flex lg:hidden items-center gap-2 sm:gap-4">{icons}</div>
          </div>

          {/* Desktop navigation row */}
          <div className="hidden lg:flex items-center justify-between h-14 gap-4">
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
            <div className="flex items-center gap-3 sm:gap-4 lg:gap-5">
              {searchPill}
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
