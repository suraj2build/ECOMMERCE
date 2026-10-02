'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
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
  { label: 'Loyalty', href: '/account/loyalty' },
  { label: 'Preferences', href: '/account/preferences' },
];

export default function AccountLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return (
    <div className="mx-auto max-w-[1200px] px-gutter py-10 sm:py-14">
      <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--color-primary)]">Personal atelier</p>
      <h1 className="mt-2 font-display text-4xl text-[#181716] sm:text-5xl">Your Account</h1>
      <div className="mt-8 grid gap-8 lg:grid-cols-[240px_1fr]">
        <nav aria-label="Account" className="h-fit overflow-x-auto rounded-[20px] border border-[#e6ddd0] bg-white p-2 lg:sticky lg:top-28">
          <ul className="flex min-w-max gap-1 lg:min-w-0 lg:flex-col">
            {NAV.map((item) => {
              const active = pathname === item.href;
              return (
                <li key={item.href}>
                  <Link href={item.href} aria-current={active ? 'page' : undefined} className={'block min-h-[42px] rounded-full px-4 py-3 text-xs font-medium transition-colors ' + (active ? 'bg-[#181716] text-white' : 'text-[#5f554c] hover:bg-[var(--color-surface-soft)] hover:text-[#181716]')}>
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
        <div className="min-w-0 rounded-[22px] border border-[#e6ddd0] bg-white p-5 sm:p-7">
          <AccountGate>{children}</AccountGate>
        </div>
      </div>
    </div>
  );
}
