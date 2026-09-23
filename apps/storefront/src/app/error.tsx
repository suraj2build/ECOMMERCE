'use client';

import { useEffect } from 'react';
import { buttonClassName } from '@/components/ui/Button';

/**
 * Route-level error boundary (M09 "Observability: frontend error
 * tracking wired up from this milestone forward").
 *
 * This is the foundation, not a full APM integration: no error-tracking
 * service (Sentry/etc.) credential exists yet, so errors are reported
 * through this single, structured console.error call site rather than
 * scattered ad hoc logging - swapping in a real provider later is a
 * one-line change here, not a search-and-replace across the app.
 */
export default function ErrorBoundary({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // eslint-disable-next-line no-console -- the one sanctioned reporting call site, see docblock
    console.error('[storefront] Unhandled route error', { message: error.message, digest: error.digest });
  }, [error]);

  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4 px-gutter text-center">
      <h1 className="font-display text-2xl text-ink">Something went wrong</h1>
      <p className="max-w-sm text-sm text-ink-muted">
        We hit an unexpected error loading this page. You can try again, or head back to the homepage.
      </p>
      <button type="button" onClick={() => reset()} className={buttonClassName('primary')}>
        Try again
      </button>
    </div>
  );
}
