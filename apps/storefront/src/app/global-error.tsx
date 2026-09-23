'use client';

import { useEffect } from 'react';

/**
 * Root-layout-level error boundary - catches errors error.tsx itself
 * can't (a crash in the root layout). Must render its own <html>/<body>
 * since it replaces the root layout entirely. See error.tsx for the
 * error-reporting discipline this follows.
 */
export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => {
    // eslint-disable-next-line no-console -- see error.tsx docblock
    console.error('[storefront] Unhandled root-layout error', { message: error.message, digest: error.digest });
  }, [error]);

  return (
    <html lang="en">
      <body style={{ fontFamily: 'sans-serif', textAlign: 'center', padding: '4rem 1rem' }}>
        <h1>Something went wrong</h1>
        <p>Please refresh the page.</p>
      </body>
    </html>
  );
}
