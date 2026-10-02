'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { getCart, getWishlist } from '@/lib/cart';
import { getLoyaltyBalance } from '@/lib/account';
import { getStoredSession } from '@/lib/customer-auth';
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
  { label: 'Trousers', href: '/category/trousers' },
];

const WOMEN_NAV = [
  { label: 'Festive', href: '/category/festive-silk-edit' },
  { label: 'New In', href: '/category/new' },
  { label: 'Sarees', href: '/category/modern-sarees' },
  { label: 'Co-ords', href: '/category/co-ords-sets' },
  { label: 'Dresses', href: '/category/dresses' },
];

function HeaderIcon({ name }: { name: 'search' | 'user' | 'heart' | 'bag' | 'gift' }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5" aria-hidden="true">
    {name === 'search' && <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5" /></>}
    {name === 'user' && <><circle cx="12" cy="7" r="3.5" /><path d="M4 21v-3a5 5 0 0 1 5-5h6a5 5 0 0 1 5 5v3" /></>}
    {name === 'heart' && <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z" />}
    {name === 'bag' && <><path d="M4 7h16v14H4z" /><path d="M8 7V5a4 4 0 0 1 8 0v2" /></>}
    {name === 'gift' && <><path d="M3 8h18v4H3zM5 12v9h14v-9M12 8v13" /><path d="M12 8H8a3 3 0 1 1 3-3l1 3Zm0 0h4a3 3 0 1 0-3-3l-1 3Z" /></>}
  </svg>;
}

export function Header() {
  const router = useRouter();
  const pathname = usePathname();
  const { department, chooseDepartment, clearDepartment } = useDepartment();
  const activeDepartment = department ?? 'women';
  const [cartCount, setCartCount] = useState(0);
  const [wishlistCount, setWishlistCount] = useState(0);
  const [points, setPoints] = useState<number | null>(null);
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
    async function refreshWishlist() {
      try { const items = await getWishlist(); if (!cancelled) setWishlistCount(items.length); } catch { /* Navigation stays available. */ }
    }
    async function refreshRewards() {
      if (!getStoredSession()) { setPoints(null); return; }
      try { const balance = await getLoyaltyBalance(); if (!cancelled) setPoints(balance.balance); } catch { if (!cancelled) setPoints(null); }
    }
    function refreshIdentity() { void refresh(); void refreshWishlist(); void refreshRewards(); }
    void refreshRewards();
    void refresh();
    void refreshWishlist();
    window.addEventListener('fcp:wishlist-updated', refreshWishlist);
    window.addEventListener('fcp:cart-updated', refresh);
    window.addEventListener('fcp:customer-session-updated', refreshIdentity);
    window.addEventListener('storage', refreshIdentity);
    return () => {
      cancelled = true;
      window.removeEventListener('fcp:cart-updated', refresh);
      window.removeEventListener('fcp:wishlist-updated', refreshWishlist);
      window.removeEventListener('fcp:customer-session-updated', refreshIdentity);
      window.removeEventListener('storage', refreshIdentity);
    };
  }, [pathname]);

  return (
    <>
      <header className="sticky top-0 z-40 border-b border-border bg-surface">
        <a href="#main-content" className="sr-only-focusable absolute left-2 top-2 z-[60] rounded-full bg-ink px-4 py-2 text-xs text-canvas">
          Skip to content
        </a>

        <div className="hidden border-b border-border bg-canvas/80 lg:block">
          <Container className="flex h-8 items-center justify-between text-[9px] uppercase tracking-[0.18em] text-ink-muted">
            <button type="button" onClick={() => { clearDepartment(); router.push('/'); }} className="hover:text-ink">Atelier portals (choose department)</button>
            <p className="hidden text-[9px] uppercase tracking-[0.22em] xl:block">Modern Indian style · delivery across India</p>
            <div className="flex items-center gap-5">
              <Link href="/orders" className="hover:text-ink">Track order</Link>
              <Link href="/account/loyalty" className="inline-flex items-center gap-2 border-l border-border pl-5 hover:text-ink"><HeaderIcon name="gift" />Rewards{points !== null ? ` (${points.toLocaleString('en-IN')} Pts)` : ''}</Link>
            </div>
          </Container>
        </div>

        <Container className="grid h-20 grid-cols-[44px_1fr_auto] items-center gap-2 sm:h-24 lg:h-32 lg:grid-cols-1">
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



          <Link href="/" aria-label="VANYA home" className="justify-self-center text-center">
            <span className="block font-display text-2xl uppercase leading-none tracking-[0.24em] text-ink sm:text-[40px] lg:text-[54px]">VANYA</span>
            <span className="mt-2 hidden text-[8px] uppercase tracking-[0.24em] text-ink-muted sm:block lg:text-[9px]">— Indian roots · modern today —</span>
          </Link>

          <div className="flex items-center justify-end gap-1 sm:gap-2 lg:hidden">
            <button type="button" onClick={() => setSearchOpen(true)} className="inline-flex h-11 w-11 items-center justify-center md:hidden" aria-label="Search">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-5 w-5" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5" /></svg>
            </button>
            <button type="button" onClick={() => setSearchOpen(true)} className="hidden min-h-[44px] shrink-0 rounded-full border border-border bg-[#faf8f5] px-3 text-[11px] text-ink-muted transition-colors hover:text-ink md:inline-flex md:items-center xl:px-4" aria-label="Search">
              <HeaderIcon name="search" /><span className="ml-2 hidden xl:inline">{activeDepartment === 'men' ? 'Search kurtas, bandhgalas…' : 'Search sarees, dresses…'}</span>
            </button>
            <Link href="/account" aria-label="Account" className="hidden h-11 w-11 items-center justify-center text-ink lg:inline-flex"><HeaderIcon name="user" /></Link>
            <Link href="/wishlist" aria-label={`Wishlist, ${wishlistCount} items`} className="relative hidden h-11 w-11 items-center justify-center text-ink sm:inline-flex"><HeaderIcon name="heart" />{wishlistCount > 0 && <span className="absolute right-0 top-0 rounded-full bg-ink px-1.5 text-[9px] leading-4 text-white" aria-hidden="true">{wishlistCount}</span>}</Link>
            <button
              type="button"
              onClick={() => setBagOpen(true)}
              className="relative inline-flex h-11 w-11 shrink-0 items-center justify-center text-ink"
              aria-label={`Shopping bag, ${cartCount} item${cartCount === 1 ? '' : 's'}`}
            >
              <HeaderIcon name="bag" />{cartCount > 0 && <span className="absolute right-0 top-0 rounded-full bg-ink px-1.5 text-[9px] leading-4 text-white" aria-hidden="true">{cartCount}</span>}
            </button>
          </div>
        </Container>

        <Container className="hidden min-h-[68px] items-center justify-between gap-3 border-t border-border lg:flex">
          <nav aria-label="Primary" className="hidden lg:block">
            <ul className="flex items-center gap-3 xl:gap-5">
              <li>
                <Link href={activeDepartment === 'men' ? '/category/men' : '/category/women'} className="border-b-2 border-accent py-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-ink">
                  {activeDepartment}
                </Link>
              </li>
              {nav.map((item) => (
                <li key={item.href}>
                  <Link href={`${item.href}?gender=${activeDepartment}`} className="whitespace-nowrap text-[10px] font-medium uppercase tracking-[0.10em] text-ink-muted transition-colors hover:text-ink">
                    {item.label}
                  </Link>
                </li>
              ))}
              <li>
                <Link href="/collections" className="whitespace-nowrap text-[10px] font-medium uppercase tracking-[0.10em] text-ink-muted transition-colors hover:text-ink">
                  Collections
                </Link>
              </li>
              <li>
                <Link href="/watch-and-shop" className="whitespace-nowrap text-[10px] font-medium uppercase tracking-[0.10em] text-ink-muted transition-colors hover:text-ink">
                  Watch & Shop
                </Link>
              </li>
            </ul>
          </nav>
          <div className="flex items-center justify-end gap-1 sm:gap-2">
            <button type="button" onClick={() => setSearchOpen(true)} className="hidden min-h-[44px] shrink-0 rounded-full border border-border bg-[#faf8f5] px-3 text-[11px] text-ink-muted transition-colors hover:text-ink md:inline-flex md:items-center xl:px-4" aria-label="Search">
              <HeaderIcon name="search" /><span className="ml-2 hidden xl:inline">{activeDepartment === 'men' ? 'Search kurtas, bandhgalas…' : 'Search sarees, dresses…'}</span>
            </button>
            <Link href="/account" aria-label="Account" className="hidden h-11 w-11 items-center justify-center text-ink lg:inline-flex"><HeaderIcon name="user" /></Link>
            <Link href="/wishlist" aria-label={`Wishlist, ${wishlistCount} items`} className="relative hidden h-11 w-11 items-center justify-center text-ink sm:inline-flex"><HeaderIcon name="heart" />{wishlistCount > 0 && <span className="absolute right-0 top-0 rounded-full bg-ink px-1.5 text-[9px] leading-4 text-white" aria-hidden="true">{wishlistCount}</span>}</Link>
            <button
              type="button"
              onClick={() => setBagOpen(true)}
              className="relative inline-flex h-11 w-11 shrink-0 items-center justify-center text-ink"
              aria-label={`Shopping bag, ${cartCount} item${cartCount === 1 ? '' : 's'}`}
            >
              <HeaderIcon name="bag" />{cartCount > 0 && <span className="absolute right-0 top-0 rounded-full bg-ink px-1.5 text-[9px] leading-4 text-white" aria-hidden="true">{cartCount}</span>}
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
                  <Link href={`${item.href}?gender=${activeDepartment}`} onClick={() => setMobileOpen(false)} className="block min-h-[48px] px-gutter py-4 text-sm text-ink">{item.label}</Link>
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
