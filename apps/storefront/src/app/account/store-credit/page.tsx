'use client';

import { useEffect, useState } from 'react';
import { getStoreCredit, type StoreCreditBalance } from '@/lib/account';

export default function StoreCreditPage() {
  const [data, setData] = useState<StoreCreditBalance | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getStoreCredit()
      .then(setData)
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not load your store credit.'));
  }, []);

  return (
    <section>
      <h2 className="font-display text-lg text-ink">Store Credit</h2>

      {error && (
        <p role="alert" className="mt-2 text-sm text-danger">
          {error}
        </p>
      )}

      {data === null && !error && <p className="mt-6 text-sm text-ink-muted">Loading...</p>}

      {data && (
        <>
          <p className="mt-4 text-2xl font-medium text-ink">&#8377;{data.balance}</p>
          <p className="text-sm text-ink-muted">Current balance - never expires.</p>

          {data.entries.length === 0 ? (
            <p className="mt-6 text-sm text-ink-muted">No store credit activity yet.</p>
          ) : (
            <ul className="mt-6 space-y-2">
              {data.entries.map((entry) => (
                <li key={entry.id} className="flex items-center justify-between rounded-sm border border-border p-3">
                  <span className="text-sm text-ink">{entry.reason}</span>
                  <span className="text-sm font-medium text-ink">+&#8377;{entry.amount}</span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
