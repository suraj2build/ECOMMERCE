'use client';

import { useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import { LogOut, Menu as MenuIcon, X, Search, ChevronRight } from 'lucide-react';
import { getStoredSession, staffLogout, type StaffSession } from '@/lib/staff-auth';
import { SessionProvider } from '@/lib/session';
import { visibleNav, type NavGroup } from '@/lib/nav';

const COLLAPSE_STORAGE_KEY = 'admin-nav-collapsed';

function isCurrent(pathname: string, href: string): boolean {
  if (href === '/dashboard') return pathname === '/dashboard';
  return pathname === href || pathname.startsWith(`${href}/`);
}

function initials(fullName: string | null, staffUserId: string): string {
  const trimmed = fullName?.trim();
  if (trimmed) {
    const parts = trimmed.split(/\s+/);
    const first = parts[0] ?? '';
    const last = parts[parts.length - 1] ?? '';
    const chars = parts.length > 1 ? (first[0] ?? '') + (last[0] ?? '') : first.slice(0, 2);
    if (chars) return chars.toUpperCase();
  }
  return staffUserId.slice(0, 2).toUpperCase();
}

function loadCollapsed(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(COLLAPSE_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, boolean>) : {};
  } catch {
    return {};
  }
}

/**
 * Console shell: grouped, permission-filtered, icon-labelled navigation
 * with per-group collapse (persisted per browser - a tidying convenience,
 * never a way to hide something a role would otherwise see), a client-side
 * filter for the ~22-item IA, a skip link, and server-side sign-out.
 */
export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname() ?? '/dashboard';
  const [session, setSession] = useState<StaffSession | undefined>(undefined);
  // Phones and narrow windows: navigation is a drawer, so the workspace shows first.
  const [menuOpen, setMenuOpen] = useState(false);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [filter, setFilter] = useState('');
  useEffect(() => setMenuOpen(false), [pathname]);
  useEffect(() => setCollapsed(loadCollapsed()), []);
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [menuOpen]);

  useEffect(() => {
    const s = getStoredSession();
    if (!s) {
      router.replace('/login');
      return;
    }
    if (s.mustChangePassword) {
      router.replace('/change-password');
      return;
    }
    setSession(s);
  }, [router]);

  function toggleGroup(title: string, open: boolean) {
    setCollapsed((prev) => {
      // `open` is the group's state BEFORE this click - collapsed[title] tracks
      // "is this group collapsed", so a currently-open group being closed
      // stores true, and a currently-closed group being reopened stores false.
      const next = { ...prev, [title]: open };
      try {
        localStorage.setItem(COLLAPSE_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // Private browsing / blocked storage - collapse state just won't persist.
      }
      return next;
    });
  }

  const groups = useMemo(() => (session ? visibleNav(session.permissions) : []), [session]);

  const query = filter.trim().toLowerCase();
  const filteredGroups: (NavGroup & { forceOpen: boolean })[] = useMemo(() => {
    if (!query) return groups.map((g) => ({ ...g, forceOpen: false }));
    return groups
      .map((g) => ({
        ...g,
        items: g.items.filter((i) => i.label.toLowerCase().includes(query) || g.title.toLowerCase().includes(query)),
        forceOpen: true,
      }))
      .filter((g) => g.items.length > 0);
  }, [groups, query]);

  // The longest matching href is the current page (so /inventory does not also light up under /inventory/transfers).
  const current = groups
    .flatMap((g) => g.items)
    .filter((i) => isCurrent(pathname, i.href))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;

  if (!session) return null;

  const userInitials = initials(session.fullName, session.staffUserId);
  const userLabel = session.fullName?.trim() || session.email || 'Staff member';

  return (
    <SessionProvider value={session}>
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <div className="shell">
        <div className="mobile-bar">
          <span className="sidebar-brand" style={{ padding: 0 }}>
            Operations console
          </span>
          <button
            type="button"
            className="menu-button"
            aria-expanded={menuOpen}
            aria-controls="console-navigation"
            onClick={() => setMenuOpen((open) => !open)}
          >
            {menuOpen ? (
              <>
                <X size={16} aria-hidden="true" /> Close
              </>
            ) : (
              <>
                <MenuIcon size={16} aria-hidden="true" /> Menu
              </>
            )}
          </button>
        </div>
        {menuOpen && <button type="button" className="nav-backdrop" aria-hidden="true" tabIndex={-1} onClick={() => setMenuOpen(false)} />}
        <nav id="console-navigation" className={`sidebar${menuOpen ? ' sidebar-open' : ''}`} aria-label="Console">
          <div className="sidebar-brand">Operations console</div>
          <div className="nav-filter">
            <Search size={14} aria-hidden="true" />
            <input
              type="search"
              placeholder="Filter navigation"
              aria-label="Filter navigation"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
            />
          </div>
          {filteredGroups.map((g) => {
            const GroupIcon = g.icon;
            const open = g.forceOpen || collapsed[g.title] !== true;
            return (
              <details key={g.title} className="nav-group" open={open}>
                <summary
                  className="nav-group-title"
                  onClick={(event) => {
                    if (g.forceOpen) return;
                    event.preventDefault();
                    toggleGroup(g.title, open);
                  }}
                >
                  <GroupIcon size={15} className="nav-group-icon" aria-hidden="true" />
                  <span className="nav-group-label">{g.title}</span>
                  <ChevronRight size={14} className="nav-group-chevron" aria-hidden="true" />
                </summary>
                <ul>
                  {g.items.map((item) => {
                    const ItemIcon = item.icon;
                    return (
                      <li key={item.href}>
                        <Link href={item.href} className="nav-link" aria-current={item.href === current ? 'page' : undefined}>
                          <ItemIcon size={16} aria-hidden="true" />
                          {item.label}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </details>
            );
          })}
          <div className="sidebar-footer">
            <div className="user-card">
              <span className="user-avatar" aria-hidden="true">
                {userInitials}
              </span>
              <div className="user-info">
                <p className="user-name" title={userLabel}>
                  {userLabel}
                </p>
                <div className="user-roles">
                  {(session.roles.length ? session.roles : ['No role']).map((role) => (
                    <span key={role} className="badge neutral">
                      {role}
                    </span>
                  ))}
                </div>
                <Link href="/change-password" className="link-button" style={{ display: 'inline-block', marginTop: '0.375rem' }}>
                  Change password
                </Link>
              </div>
              <button
                type="button"
                className="sign-out-button"
                title="Sign out"
                aria-label="Sign out"
                onClick={async () => {
                  await staffLogout();
                  router.replace('/login');
                }}
              >
                <LogOut size={16} aria-hidden="true" />
              </button>
            </div>
          </div>
        </nav>
        <main id="main" className="main" tabIndex={-1}>
          {children}
        </main>
      </div>
    </SessionProvider>
  );
}
