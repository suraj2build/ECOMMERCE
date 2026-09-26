'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { listRecentlyViewed, type RecentlyViewedItem } from '@/lib/account';

export default function RecentlyViewedPage() {
  const [items, setItems] = useState<RecentlyViewedItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listRecentlyViewed()
      .then(setItems)
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not load recently viewed products.'));
  }, []);

  return (
    <section>
      <h2 className="font-display text-lg text-ink">Recently Viewed</h2>

      {error && (
        <p role="alert" className="mt-2 text-sm text-danger">
          {error}
        </p>
      )}

      {items === null && !error && <p className="mt-6 text-sm text-ink-muted">Loading...</p>}

      {items !== null && items.length === 0 && <p className="mt-6 text-sm text-ink-muted">No recently viewed products yet.</p>}

      {items && items.length > 0 && (
        <ul className="mt-6 space-y-3">
          {items.map((item) => (
            <li key={item.styleId} className="rounded-sm border border-border p-4">
              <Link href={`/product/${item.styleId}`} className="block">
                <p className="text-sm font-medium text-ink">{item.name}</p>
                <p className="text-sm text-ink-muted">{item.styleCode}</p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
