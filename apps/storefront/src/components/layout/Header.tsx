'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { getCart } from '@/lib/cart';
import { Container } from '../ui/Container';
import { useDepartment } from './DepartmentContext';
import { VanyaBagDrawer } from './VanyaBagDrawer';
import { VanyaSearchOverlay } from './VanyaSearchOverlay';

const MEN_NAV = [
  { label: 'Festive', href: '/category/festive-ceremonial' },
  { label: 'New In', href: '/category/new' },
  { label: 'Bandhgalas', href: '/category/bandhgalas-jackets' },
  { label: 'Shirts', href: '/category/linen-silk-shirts' },
  { label: 'Kurtas', href: '/category/kurtas' },
];

const WOMEN_NAV = [
  { label: 'Festive', href: '/category/festive-silk-edit' },
  { label: 'New In', href: '/category/new' },
  { label: 'Sarees', href: '/category/modern-sarees' },
  { label: 'Co-ords', href: '/category/co-ords-sets' },
  { label: 'Dresses', href: '/category/dresses' },
];

export function Header() {
  const { department, chooseDepartment, clearDepartment } = useDepartment();
  const activeDepartment = department ?? 'women';
  const [cartCount, setCartCount] = useState(0);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [bagOpen, setBagOpen] = useState(false);
  const nav = activeDepartment === 'men' ? MEN_NAV : WOMEN_NAV;

  useEffect(() => {
    let cancelled = false;
    async function refresh() {
      try {
        const cart = await getCart();
        if (!cancelled) setCartCount(cart.itemCount);
      } catch {
        // Navigation remains usable if cart count cannot be refreshed.
      }
    }
    void refresh();
    window.addEventListener('fcp:cart-updated', refresh);
    return () => {
      cancelled = true;
      window.removeEventListener('fcp:cart-updated', refresh);
    };
  }, []);

  return (
    <>
      <header className="sticky top-0 z-40 border-b border-border bg-surface/95 backdrop-blur-md">
        <a href="#main-content" className="sr-only-focusable absolute left-2 top-2 z-[60] rounded-full bg-ink px-4 py-2 text-xs text-canvas">
          Skip to content
        </a>

        <div className="hidden border-b border-border bg-canvas/80 lg:block">
          <Container className="flex h-8 items-center justify-between text-[9px] uppercase tracking-[0.18em] text-ink-muted">
            <button type="button" onClick={clearDepartment} className="hover:text-ink">← Choose department</button>
            <div className="flex items-center gap-5">
              <button type="button" onClick={() => chooseDepartment('women')} className="hover:text-ink">Shop Women</button>
              <button type="button" onClick={() => chooseDepartment('men')} className="hover:text-ink">Shop Men</button>
            </div>
            <Link href="/orders" className="hover:text-ink">Track order</Link>
          </Container>
        </div>

        <Container className="grid h-16 grid-cols-[44px_1fr_auto] items-center gap-2 sm:h-20 lg:grid-cols-[1fr_auto_1fr]">
          <button
            type="button"
            className="flex h-11 w-11 flex-col items-center justify-center gap-1.5 lg:hidden"
            aria-expanded={mobileOpen}
            aria-controls="vanya-mobile-nav"
            aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
            onClick={() => setMobileOpen((value) => !value)}
          >
            <span className="h-px w-5 bg-ink" />
            <span className="h-px w-5 bg-ink" />
          </button>

          <nav aria-label="Primary" className="hidden lg:block">
            <ul className="flex items-center gap-5 xl:gap-6">
              <li>
                <Link href={activeDepartment === 'men' ? '/category/men' : '/category/women'} className="text-[10px] font-semibold uppercase tracking-[0.16em] text-ink">
                  {activeDepartment}
                </Link>
              </li>
              {nav.map((item) => (
                <li key={item.href}>
                  <Link href={item.href} className="text-[10px] font-medium uppercase tracking-[0.14em] text-ink-muted transition-colors hover:text-ink">
                    {item.label}
                  </Link>
                </li>
              ))}
              <li>
                <Link href="/collections" className="text-[10px] font-medium uppercase tracking-[0.14em] text-ink-muted transition-colors hover:text-ink">
                  Collections
                </Link>
              </li>
              <li className="hidden xl:list-item">
                <Link href="/watch-and-shop" className="text-[10px] font-medium uppercase tracking-[0.14em] text-ink-muted transition-colors hover:text-ink">
                  Watch & Shop
                </Link>
              </li>
            </ul>
          </nav>

          <Link href="/" aria-label="VANYA home" className="justify-self-center text-center">
            <span className="block font-display text-2xl uppercase leading-none tracking-[0.24em] text-ink sm:text-[32px]">VANYA</span>
            <span className="mt-1 hidden text-[7px] uppercase tracking-[0.24em] text-ink-muted sm:block">— Indian roots · modern today —</span>
          </Link>

          <div className="flex items-center justify-end gap-1 sm:gap-2">
            <button type="button" onClick={() => setSearchOpen(true)} className="hidden min-h-[44px] rounded-full border border-border bg-canvas px-4 text-[11px] text-ink-muted transition-colors hover:text-ink md:inline-flex md:items-center" aria-label="Search">
              Search garments…
            </button>
            <Link href="/account" className="hidden min-h-[44px] items-center px-2 text-[11px] uppercase tracking-[0.1em] text-ink lg:inline-flex">Account</Link>
            <Link href="/wishlist" className="hidden min-h-[44px] items-center px-2 text-[11px] uppercase tracking-[0.1em] text-ink sm:inline-flex">Wishlist</Link>
            <button
              type="button"
              onClick={() => setBagOpen(true)}
              className="inline-flex min-h-[44px] items-center px-2 text-[11px] font-medium uppercase tracking-[0.1em] text-ink"
              aria-label={`Shopping bag, ${cartCount} item${cartCount === 1 ? '' : 's'}`}
            >
              Bag{cartCount > 0 ? ` (${cartCount})` : ''}
            </button>
          </div>
        </Container>

        {mobileOpen && (
          <nav id="vanya-mobile-nav" aria-label="Primary mobile" className="border-t border-border bg-surface lg:hidden">
            <div className="grid grid-cols-2 border-b border-border p-3">
              {(['women', 'men'] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => {
                    chooseDepartment(value);
                    setMobileOpen(false);
                  }}
                  className={`min-h-[44px] rounded-full text-[10px] font-semibold uppercase tracking-[0.16em] ${activeDepartment === value ? 'bg-ink text-canvas' : 'text-ink'}`}
                >
                  {value}
                </button>
              ))}
            </div>
            <div className="border-b border-border p-3">
              <button type="button" onClick={() => { setMobileOpen(false); setSearchOpen(true); }} className="min-h-[44px] w-full rounded-full border border-border bg-canvas px-4 text-left text-xs text-ink-muted">
                Search VANYA
              </button>
            </div>
            <ul>
              <li className="border-b border-border">
                <Link
                  href={activeDepartment === 'men' ? '/category/men' : '/category/women'}
                  onClick={() => setMobileOpen(false)}
                  className="block min-h-[48px] px-gutter py-4 text-sm font-semibold text-ink"
                >
                  Shop {activeDepartment}
                </Link>
              </li>
              {nav.map((item) => (
                <li key={item.href} className="border-b border-border">
                  <Link href={item.href} onClick={() => setMobileOpen(false)} className="block min-h-[48px] px-gutter py-4 text-sm text-ink">{item.label}</Link>
                </li>
              ))}
              <li className="border-b border-border">
                <Link href="/collections" onClick={() => setMobileOpen(false)} className="block min-h-[48px] px-gutter py-4 text-sm text-ink">Collections</Link>
              </li>
              <li className="border-b border-border">
                <Link href="/watch-and-shop" onClick={() => setMobileOpen(false)} className="block min-h-[48px] px-gutter py-4 text-sm text-ink">Watch & Shop</Link>
              </li>
              <li className="grid grid-cols-3">
                <Link href="/account" onClick={() => setMobileOpen(false)} className="px-gutter py-4 text-xs text-ink">Account</Link>
                <Link href="/orders" onClick={() => setMobileOpen(false)} className="px-2 py-4 text-xs text-ink">Orders</Link>
                <Link href="/wishlist" onClick={() => setMobileOpen(false)} className="px-2 py-4 text-xs text-ink">Wishlist</Link>
              </li>
            </ul>
          </nav>
        )}

        <div className={`h-px w-full transition-colors duration-500 ${activeDepartment === 'men' ? 'bg-[#8f6b4e]/60' : 'bg-[#866791]/60'}`} />
      </header>

      <VanyaSearchOverlay open={searchOpen} onClose={() => setSearchOpen(false)} />
      <VanyaBagDrawer open={bagOpen} onClose={() => setBagOpen(false)} />
    </>
  );
}
