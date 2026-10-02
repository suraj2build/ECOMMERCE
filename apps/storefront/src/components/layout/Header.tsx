'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { getCart, getWishlist } from '@/lib/cart';
import { useDepartment } from './DepartmentContext';
import { VanyaBagDrawer } from './VanyaBagDrawer';
import { VanyaSearchOverlay } from './VanyaSearchOverlay';

export function Header() {
  const { department, clearDepartment } = useDepartment();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [cartCount, setCartCount] = useState(0);
  const [wishlistCount, setWishlistCount] = useState(0);
  const [bagOpen, setBagOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function refreshCart() {
      try {
        const cart = await getCart();
        if (!cancelled) setCartCount(cart.itemCount);
      } catch {
        // Navigation remains usable if cart state cannot be refreshed.
      }
    }
    async function refreshWishlist() {
      try {
        const items = await getWishlist();
        if (!cancelled) setWishlistCount(items.length);
      } catch {
        // Navigation remains usable if wishlist state cannot be refreshed.
      }
    }
    void refreshCart();
    void refreshWishlist();
    window.addEventListener('fcp:cart-updated', refreshCart);
    window.addEventListener('fcp:wishlist-updated', refreshWishlist);
    return () => {
      cancelled = true;
      window.removeEventListener('fcp:cart-updated', refreshCart);
      window.removeEventListener('fcp:wishlist-updated', refreshWishlist);
    };
  }, []);

  const isMen = department === 'men';
  const departmentHref = department ? `/category/${department}` : '/';

  return (
    <header className="sticky top-0 z-40 border-b border-[#f0ece4] bg-white/95 text-[#181716] backdrop-blur-md">
      <a href="#main-content" className="sr-only-focusable absolute left-2 top-2 z-50 rounded-full bg-[#181716] px-4 py-2 text-sm text-white">Skip to content</a>

      <div className="hidden border-b border-[#f4efe6] bg-[#faf8f5]/90 py-1.5 text-[10px] uppercase tracking-[0.15em] text-[#7a7065] lg:block">
        <div className="mx-auto flex max-w-[1440px] items-center justify-between px-8">
          <button
            type="button"
            onClick={clearDepartment}
            className="min-h-[32px] transition-colors hover:text-[#181716]"
          >
            ← Choose department
          </button>
          <p>Indian roots · modern form · delivery across India</p>
          <Link href="/orders" className="min-h-[32px] py-2 hover:text-[#181716]">Track order</Link>
        </div>
      </div>

      <div className="mx-auto flex h-16 max-w-[1440px] items-center justify-between gap-3 px-gutter sm:h-20">
        <button
          type="button"
          onClick={() => setMobileOpen((value) => !value)}
          className="flex h-11 w-11 flex-col items-center justify-center gap-1.5 lg:hidden"
          aria-expanded={mobileOpen}
          aria-controls="vanya-mobile-nav"
          aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
        >
          <span className="h-px w-5 bg-[#181716]" />
          <span className="h-px w-5 bg-[#181716]" />
        </button>

        <nav aria-label="Primary" className="hidden flex-1 items-center gap-5 text-[11px] font-medium uppercase tracking-[0.15em] lg:flex xl:gap-6">
          <Link href={departmentHref} className="py-3 hover:text-[var(--color-primary)]">{isMen ? 'Men' : department === 'women' ? 'Women' : 'Shop'}</Link>
          <Link href="/category/new" className="py-3 hover:text-[var(--color-primary)]">New In</Link>
          <Link href="/category/sale" className="py-3 hover:text-[var(--color-primary)]">Sale</Link>
          <Link href="/collections" className="py-3 hover:text-[var(--color-primary)]">Collections</Link>
        </nav>

        <Link href="/" aria-label="VANYA home" className="shrink-0 text-center">
          <span className="block font-display text-2xl uppercase leading-none tracking-[0.28em] text-[#181716] sm:text-3xl lg:text-[34px]">VANYA</span>
          <span className="mt-1 hidden text-[8px] font-light uppercase tracking-[0.26em] text-[#73685c] sm:block">Indian roots · modern today</span>
        </Link>

        <div className="flex flex-1 items-center justify-end gap-2 sm:gap-3">
          <Link href="/watch-and-shop" className="hidden py-3 text-[11px] font-medium uppercase tracking-[0.15em] hover:text-[var(--color-primary)] xl:block">Watch &amp; Shop</Link>
          <button type="button" onClick={() => setSearchOpen(true)} className="hidden min-h-[36px] min-w-[150px] items-center rounded-full border border-[#e5dfd5] bg-[#f6f4f0] px-4 text-left text-[11px] text-[#6e6359] hover:bg-[#efece5] lg:flex">Search garments…</button>
          <Link href="/account" className="hidden min-h-[44px] items-center px-2 text-xs hover:text-[var(--color-primary)] sm:flex">Account</Link>
          <Link href="/wishlist" className="relative flex min-h-[44px] items-center px-2 text-xs hover:text-[var(--color-primary)]" aria-label={`Wishlist, ${wishlistCount} item${wishlistCount === 1 ? '' : 's'}`}>
            ♡<span className="ml-1 hidden sm:inline">Wishlist</span>{wishlistCount > 0 ? <span className="ml-1">({wishlistCount})</span> : null}
          </Link>
          <button type="button" onClick={() => setBagOpen(true)} className="relative flex min-h-[44px] items-center px-2 text-xs font-medium hover:text-[var(--color-primary)]" aria-label={`Shopping bag, ${cartCount} item${cartCount === 1 ? '' : 's'}`}>
            Bag{cartCount > 0 ? ` (${cartCount})` : ''}
          </button>
        </div>
      </div>

      <div className={`h-[1.5px] w-full bg-gradient-to-r from-transparent via-[var(--color-primary)] to-transparent transition-opacity ${department ? 'opacity-80' : 'opacity-30'}`} />

      <VanyaBagDrawer open={bagOpen} onClose={() => setBagOpen(false)} />
      <VanyaSearchOverlay open={searchOpen} onClose={() => setSearchOpen(false)} />

      {mobileOpen && (
        <nav id="vanya-mobile-nav" aria-label="Primary mobile" className="border-t border-[#efece6] bg-white lg:hidden">
          <div className="border-b border-[#efece6] px-gutter py-3">
            <button type="button" onClick={() => { setMobileOpen(false); setSearchOpen(true); }} className="flex min-h-[44px] w-full items-center rounded-full bg-[#f6f4f0] px-4 text-left text-sm text-[#6e6359]">Search garments…</button>
          </div>
          <ul className="divide-y divide-[#f4f1ea] px-gutter">
            <li><Link href={departmentHref} onClick={() => setMobileOpen(false)} className="block py-4 text-sm uppercase tracking-[0.14em]">Shop {department ?? 'VANYA'}</Link></li>
            <li><Link href="/category/new" onClick={() => setMobileOpen(false)} className="block py-4 text-sm uppercase tracking-[0.14em]">New In</Link></li>
            <li><Link href="/category/sale" onClick={() => setMobileOpen(false)} className="block py-4 text-sm uppercase tracking-[0.14em]">Sale</Link></li>
            <li><Link href="/collections" onClick={() => setMobileOpen(false)} className="block py-4 text-sm uppercase tracking-[0.14em]">Collections</Link></li>
            <li><Link href="/watch-and-shop" onClick={() => setMobileOpen(false)} className="block py-4 text-sm uppercase tracking-[0.14em]">Watch &amp; Shop</Link></li>
            <li><Link href="/orders" onClick={() => setMobileOpen(false)} className="block py-4 text-sm uppercase tracking-[0.14em]">Track Order</Link></li>
          </ul>
          <button type="button" onClick={() => { clearDepartment(); setMobileOpen(false); }} className="mx-gutter my-5 min-h-[44px] rounded-full border border-[#ddd3c5] px-5 text-xs uppercase tracking-[0.12em]">Choose Men / Women</button>
        </nav>
      )}
    </header>
  );
}
