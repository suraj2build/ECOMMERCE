'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { listMyReviews, type MyReview } from '@/lib/account';

export default function MyReviewsPage() {
  const [reviews, setReviews] = useState<MyReview[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listMyReviews()
      .then(setReviews)
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not load your reviews.'));
  }, []);

  return (
    <section>
      <h2 className="font-display text-lg text-ink">My Reviews</h2>

      {error && (
        <p role="alert" className="mt-2 text-sm text-danger">
          {error}
        </p>
      )}

      {reviews === null && !error && <p className="mt-6 text-sm text-ink-muted">Loading...</p>}
      {reviews !== null && reviews.length === 0 && <p className="mt-6 text-sm text-ink-muted">You haven&apos;t written any reviews yet.</p>}

      {reviews && reviews.length > 0 && (
        <ul className="mt-6 space-y-4">
          {reviews.map((review) => (
            <li key={review.id} className="rounded-sm border border-border p-4">
              <Link href={`/product/${review.styleId}`} className="text-sm font-medium text-ink">
                {review.styleName}
              </Link>
              <p className="mt-1 text-sm text-ink">
                {review.rating} out of 5 {review.title ? `— ${review.title}` : ''}
              </p>
              <p className="mt-1 text-sm text-ink-muted">{review.body}</p>
              {review.status === 'HIDDEN' && <p className="mt-1 text-xs text-ink-muted">This review is currently hidden.</p>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
