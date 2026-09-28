'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';

export default function AnalyticsPage() {
  const [commerce, setCommerce] = useState<Record<string, unknown> | null>(null);
  const [fashion, setFashion] = useState<Record<string, unknown> | null>(null);
  const [procurement, setProcurement] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const [c, f, p] = await Promise.all([
          apiFetch<Record<string, unknown>>('/analytics/commerce'),
          apiFetch<Record<string, unknown>>('/analytics/fashion'),
          apiFetch<Record<string, unknown>>('/analytics/procurement'),
        ]);
        setCommerce(c);
        setFashion(f);
        setProcurement(p);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not load analytics.');
      }
    })();
  }, []);

  return (
    <div>
      <h1 style={{ fontSize: '1.25rem' }}>Analytics &amp; Reporting</h1>
      {error && <p className="error-banner">{error}</p>}
      <div style={{ display: 'grid', gap: '1rem', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' }}>
        <section className="card">
          <h2 style={{ fontSize: '1rem' }}>Commerce</h2>
          <pre style={{ whiteSpace: 'pre-wrap', fontSize: '0.8rem' }}>{commerce ? JSON.stringify(commerce, null, 2) : 'Loading...'}</pre>
        </section>
        <section className="card">
          <h2 style={{ fontSize: '1rem' }}>Fashion</h2>
          <pre style={{ whiteSpace: 'pre-wrap', fontSize: '0.8rem' }}>{fashion ? JSON.stringify(fashion, null, 2) : 'Loading...'}</pre>
        </section>
        <section className="card">
          <h2 style={{ fontSize: '1rem' }}>Procurement</h2>
          <pre style={{ whiteSpace: 'pre-wrap', fontSize: '0.8rem' }}>{procurement ? JSON.stringify(procurement, null, 2) : 'Loading...'}</pre>
        </section>
      </div>
    </div>
  );
}
