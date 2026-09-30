'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import { getStoredSession, staffLogout, type StaffSession } from '@/lib/staff-auth';
import { SessionProvider } from '@/lib/session';
import { visibleNav } from '@/lib/nav';

function isCurrent(pathname: string, href: string): boolean {
  if (href === '/dashboard') return pathname === '/dashboard';
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * Console shell: grouped navigation filtered by the session's
 * permissions (UX only - the API authorizes every read and action), a
 * skip link, and server-side sign-out.
 */
export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname() ?? '/dashboard';
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

  const groups = visibleNav(session.permissions);
  // The longest matching href is the current page (so /inventory does not also light up under /inventory/transfers).
  const current = groups
    .flatMap((g) => g.items)
    .filter((i) => isCurrent(pathname, i.href))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;

  return (
    <SessionProvider value={session}>
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <div className="shell">
        <nav className="sidebar" aria-label="Console">
          <div className="sidebar-brand">Operations console</div>
          {groups.map((g) => (
            <div key={g.title} className="nav-group">
              <p className="nav-group-title">{g.title}</p>
              <ul>
                {g.items.map((item) => (
                  <li key={item.href}>
                    <Link href={item.href} className="nav-link" aria-current={item.href === current ? 'page' : undefined}>
                      {item.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          <div className="sidebar-footer">
            <p style={{ margin: 0 }}>Roles: {session.roles.join(', ') || 'none'}</p>
            <button
              type="button"
              className="link-button"
              style={{ marginTop: '0.5rem' }}
              onClick={async () => {
                await staffLogout();
                router.replace('/login');
              }}
            >
              Sign out
            </button>
          </div>
        </nav>
        <main id="main" className="main" tabIndex={-1}>
          {children}
        </main>
      </div>
    </SessionProvider>
  );
}
