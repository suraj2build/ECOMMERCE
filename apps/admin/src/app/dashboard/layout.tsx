'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { getStoredSession, clearSession, type StaffSession } from '@/lib/staff-auth';

interface NavItem {
  href: string;
  label: string;
  permission: string;
}

const NAV_ITEMS: NavItem[] = [
  { href: '/dashboard/cms/banners', label: 'CMS - Banners', permission: 'cms:read' },
  { href: '/dashboard/cms/content-blocks', label: 'CMS - Content Blocks', permission: 'cms:read' },
  { href: '/dashboard/cms/landing-pages', label: 'CMS - Landing Pages', permission: 'cms:read' },
  { href: '/dashboard/cms/navigation-menus', label: 'CMS - Navigation Menus', permission: 'cms:read' },
  { href: '/dashboard/inventory-adjustments', label: 'Inventory Adjustments', permission: 'inventory:adjust' },
  { href: '/dashboard/customer-360', label: 'Customer 360', permission: 'customer_service:manage' },
  { href: '/dashboard/channels', label: 'Channel Publishing', permission: 'channel:read' },
  { href: '/dashboard/analytics', label: 'Analytics', permission: 'analytics:read' },
];

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [session, setSession] = useState<StaffSession | undefined>(undefined);

  useEffect(() => {
    const s = getStoredSession();
    if (!s) {
      router.replace('/login');
      return;
    }
    setSession(s);
  }, [router]);

  if (!session) return null;

  const visibleItems = NAV_ITEMS.filter((item) => session.permissions.includes(item.permission));

  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      <nav
        style={{
          width: 240,
          flexShrink: 0,
          background: 'var(--color-surface)',
          borderRight: '1px solid var(--color-border)',
          padding: '1.25rem 1rem',
          display: 'flex',
          flexDirection: 'column',
          gap: '0.25rem',
        }}
      >
        <div style={{ fontWeight: 600, marginBottom: '1rem' }}>Admin</div>
        {visibleItems.length === 0 && (
          <p style={{ fontSize: '0.85rem', color: 'var(--color-ink-muted)' }}>
            No admin sections are available for your role.
          </p>
        )}
        {visibleItems.map((item) => (
          <Link key={item.href} href={item.href} style={{ padding: '0.4rem 0.5rem', borderRadius: 6, textDecoration: 'none' }}>
            {item.label}
          </Link>
        ))}
        <div style={{ marginTop: 'auto', paddingTop: '1rem', borderTop: '1px solid var(--color-border)' }}>
          <p style={{ fontSize: '0.8rem', color: 'var(--color-ink-muted)', margin: 0 }}>
            Roles: {session.roles.join(', ') || 'none'}
          </p>
          <button
            type="button"
            onClick={() => {
              clearSession();
              router.replace('/login');
            }}
            style={{ marginTop: '0.5rem', background: 'none', border: 'none', textDecoration: 'underline', cursor: 'pointer', padding: 0 }}
          >
            Sign out
          </button>
        </div>
      </nav>
      <main style={{ flex: 1, padding: '1.5rem 2rem' }}>{children}</main>
    </div>
  );
}
