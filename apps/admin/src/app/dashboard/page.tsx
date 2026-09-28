'use client';

import { getStoredSession } from '@/lib/staff-auth';

export default function DashboardHome() {
  const session = getStoredSession();
  return (
    <div>
      <h1 style={{ fontSize: '1.25rem' }}>Dashboard</h1>
      <p style={{ color: 'var(--color-ink-muted)' }}>
        Signed in with roles: {session?.roles.join(', ') ?? 'none'}. Choose a section from the left.
      </p>
    </div>
  );
}
