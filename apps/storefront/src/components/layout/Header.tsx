'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Container } from '../ui/Container';

const PRIMARY_NAV = [
  { label: 'Shop Women', href: '/category/women' },
  { label: 'Shop Men', href: '/category/men' },
  { label: 'New & Trending', href: '/category/new' },
  { label: 'Collections', href: '/collections' },
  { label: 'Watch & Shop', href: '/watch-and-shop' },
];

/**
 * Global navigation (M09, specs/08-storefront.md). Mobile collapses to a
 * disclosure menu with no horizontal overflow; desktop shows the full
 * nav inline and is fully keyboard-operable (NFR-004/NFR-005).
 */
export function Header() {
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-canvas/95 backdrop-blur">
      <a href="#main-content" className="sr-only-focusable absolute left-2 top-2 z-50 rounded-sm bg-accent px-3 py-2 text-sm text-accent-ink">
        Skip to content
      </a>
      <div className="border-b border-border py-2 text-center text-xs text-ink-muted">
        Free shipping over &#8377;1,999 &middot; Easy 15-day returns
      </div>
      <Container className="flex h-16 items-center justify-between">
        <Link href="/" className="font-display text-xl tracking-tight text-ink" aria-label="Home">
          HOUSE
        </Link>

        <nav aria-label="Primary" className="hidden md:block">
          <ul className="flex items-center gap-8">
            {PRIMARY_NAV.map((item) => (
              <li key={item.href}>
                <Link href={item.href} className="text-sm text-ink transition-colors hover:text-ink-muted">
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <div className="flex items-center gap-4">
          <Link href="/wishlist" className="hidden text-sm text-ink md:inline" aria-label="Wishlist">
            Wishlist
          </Link>
          <Link href="/bag" className="text-sm text-ink" aria-label="Shopping bag">
            Bag
          </Link>
          <button
            type="button"
            className="inline-flex h-11 w-11 items-center justify-center md:hidden"
            aria-expanded={open}
            aria-controls="mobile-nav"
            aria-label={open ? 'Close menu' : 'Open menu'}
            onClick={() => setOpen((v) => !v)}
          >
            <span aria-hidden className="block h-0.5 w-6 bg-ink" />
          </button>
        </div>
      </Container>

      {open && (
        <nav id="mobile-nav" aria-label="Primary mobile" className="border-t border-border md:hidden">
          <ul className="flex flex-col">
            {PRIMARY_NAV.map((item) => (
              <li key={item.href} className="border-b border-border">
                <Link
                  href={item.href}
                  className="block min-h-[44px] px-gutter py-3 text-sm text-ink"
                  onClick={() => setOpen(false)}
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      )}
    </header>
  );
}
