'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { getCart } from '@/lib/cart';
import { Container } from '../ui/Container';
import { useDepartment } from './DepartmentProvider';

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
  const { department, setDepartment } = useDepartment();
  const [cartCount, setCartCount] = useState(0);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const nav = department === 'men' ? MEN_NAV : WOMEN_NAV;

  useEffect(() => {
    let cancelled = false;
    async function refresh() {
      try {
        const cart = await getCart();
        if (!cancelled) setCartCount(cart.itemCount);
      } catch {}
    }
    void refresh();
    window.addEventListener('fcp:cart-updated', refresh);
    return () => {
      cancelled = true;
      window.removeEventListener('fcp:cart-updated', refresh);
    };
  }, []);

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-surface/95 backdrop-blur-md">
      <a href="#main-content" className="sr-only-focusable absolute left-2 top-2 z-[60] rounded-full bg-ink px-4 py-2 text-xs text-canvas">
        Skip to content
      </a>

      <div className="hidden border-b border-border bg-canvas/80 lg:block">
        <Container className="flex h-8 items-center justify-between text-[9px] uppercase tracking-[0.18em] text-ink-muted">
          <button
            type="button"
            onClick={() => setDepartment(department === 'men' ? 'women' : 'men')}
            className="hover:text-ink"
          >
            Switch to {department === 'men' ? 'Women' : 'Men'}
          </button>
          <span>Indian roots · modern form</span>
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
              <Link href={department === 'men' ? '/category/men' : '/category/women'} className="text-[10px] font-semibold uppercase tracking-[0.16em] text-ink">
                {department}
              </Link>
            </li>
            {nav.map((item) => (
              <li key={item.href}>
                <Link href={item.href} className="text-[10px] font-medium uppercase tracking-[0.14em] text-ink-muted transition-colors hover:text-ink">
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <Link href="/" aria-label="VANYA home" className="justify-self-center text-center">
          <span className="block font-display text-2xl uppercase leading-none tracking-[0.24em] text-ink sm:text-[32px]">VANYA</span>
          <span className="mt-1 hidden text-[7px] uppercase tracking-[0.24em] text-ink-muted sm:block">— Indian roots · modern today —</span>
        </Link>

        <div className="flex items-center justify-end gap-1 sm:gap-2">
          <button
            type="button"
            aria-label="Search"
            aria-expanded={searchOpen}
            aria-controls="vanya-search"
            onClick={() => setSearchOpen((value) => !value)}
            className="hidden min-h-[44px] rounded-full border border-border bg-canvas px-4 text-[11px] text-ink-muted transition-colors hover:text-ink md:inline-flex md:items-center"
          >
            Search garments…
          </button>
          <Link href="/account" className="hidden min-h-[44px] items-center px-2 text-[11px] uppercase tracking-[0.1em] text-ink lg:inline-flex">Account</Link>
          <Link href="/wishlist" className="hidden min-h-[44px] items-center px-2 text-[11px] uppercase tracking-[0.1em] text-ink sm:inline-flex">Wishlist</Link>
          <Link href="/bag" className="inline-flex min-h-[44px] items-center px-2 text-[11px] font-medium uppercase tracking-[0.1em] text-ink" aria-label={`Shopping bag, ${cartCount} item${cartCount === 1 ? '' : 's'}`}>
            Bag{cartCount > 0 ? ` (${cartCount})` : ''}
          </Link>
        </div>
      </Container>

      {searchOpen && (
        <div id="vanya-search" className="border-t border-border bg-surface">
          <Container className="py-4">
            <form action="/search" method="get" className="flex items-center gap-3">
              <label htmlFor="vanya-search-input" className="sr-only">Search products</label>
              <input
                id="vanya-search-input"
                name="q"
                autoFocus
                placeholder="Search kurtas, bandhgalas, sarees, colours..."
                className="min-h-[48px] flex-1 border-b border-ink bg-transparent px-1 text-sm text-ink outline-none placeholder:text-ink-muted"
              />
              <button type="submit" className="min-h-[44px] rounded-full bg-ink px-6 text-[10px] font-semibold uppercase tracking-[0.16em] text-canvas">
                Search
              </button>
            </form>
          </Container>
        </div>
      )}

      {mobileOpen && (
        <nav id="vanya-mobile-nav" aria-label="Primary mobile" className="border-t border-border bg-surface lg:hidden">
          <div className="grid grid-cols-2 border-b border-border p-3">
            {(['women', 'men'] as const).map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => {
                  setDepartment(value);
                  setMobileOpen(false);
                }}
                className={`min-h-[44px] rounded-full text-[10px] font-semibold uppercase tracking-[0.16em] ${department === value ? 'bg-ink text-canvas' : 'text-ink'}`}
              >
                {value}
              </button>
            ))}
          </div>
          <ul>
            {nav.map((item) => (
              <li key={item.href} className="border-b border-border">
                <Link href={item.href} onClick={() => setMobileOpen(false)} className="block min-h-[48px] px-gutter py-4 text-sm text-ink">
                  {item.label}
                </Link>
              </li>
            ))}
            <li className="grid grid-cols-3">
              <Link href="/account" onClick={() => setMobileOpen(false)} className="px-gutter py-4 text-xs text-ink">Account</Link>
              <Link href="/orders" onClick={() => setMobileOpen(false)} className="px-2 py-4 text-xs text-ink">Orders</Link>
              <Link href="/wishlist" onClick={() => setMobileOpen(false)} className="px-2 py-4 text-xs text-ink">Wishlist</Link>
            </li>
          </ul>
        </nav>
      )}

      <div className={`h-px w-full transition-colors duration-500 ${department === 'men' ? 'bg-[#8f6b4e]/60' : 'bg-[#866791]/60'}`} />
    </header>
  );
}
