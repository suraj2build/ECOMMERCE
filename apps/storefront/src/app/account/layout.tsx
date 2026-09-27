'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { Container } from '@/components/ui/Container';
import { AccountGate } from '@/components/account/AccountGate';

const NAV = [
  { label: 'Profile', href: '/account' },
  { label: 'Addresses', href: '/account/addresses' },
  { label: 'Orders', href: '/orders' },
  { label: 'Wishlist', href: '/wishlist' },
  { label: 'Recently Viewed', href: '/account/recently-viewed' },
  { label: 'My Sizes', href: '/account/sizes' },
  { label: 'Reviews', href: '/account/reviews' },
  { label: 'Store Credit', href: '/account/store-credit' },
  // M23 (Loyalty) is now built - real balance/tier/ledger, replacing the
  // earlier DEPENDENCY_DEFERRED "Coming soon" placeholder.
  { label: 'Loyalty', href: '/account/loyalty' },
  { label: 'Communication Preferences', href: '/account/preferences' },
];

// M24 (Promotions/Coupons) is authorized but not yet built within this
// phase's own sequencing (M23 -> M24 -> M25) - represented honestly as
// a disabled, not-yet-available state (DEPENDENCY_DEFERRED - M24), never
// a fabricated coupon list.
const DEFERRED_NAV = [{ label: 'Coupons', reason: 'Coming soon' }];

export default function AccountLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  return (
    <Container className="py-8">
      <h1 className="font-display text-2xl text-ink">Your Account</h1>
      <div className="mt-6 flex flex-col gap-8 md:flex-row">
        <nav aria-label="Account" className="shrink-0 md:w-56">
          <ul className="flex flex-row flex-wrap gap-2 md:flex-col md:gap-0">
            {NAV.map((item) => {
              const active = pathname === item.href;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={active ? 'page' : undefined}
                    className={`block min-h-[44px] rounded-sm px-3 py-2 text-sm ${
                      active ? 'bg-surface font-medium text-ink' : 'text-ink-muted hover:bg-surface hover:text-ink'
                    }`}
                  >
                    {item.label}
                  </Link>
                </li>
              );
            })}
            {DEFERRED_NAV.map((item) => (
              <li key={item.label}>
                <span
                  className="block min-h-[44px] cursor-not-allowed rounded-sm px-3 py-2 text-sm text-ink-muted/60"
                  aria-disabled="true"
                  title={item.reason}
                >
                  {item.label} <span className="text-xs">({item.reason})</span>
                </span>
              </li>
            ))}
          </ul>
        </nav>
        <div className="min-w-0 flex-1">
          <AccountGate>{children}</AccountGate>
        </div>
      </div>
    </Container>
  );
}
