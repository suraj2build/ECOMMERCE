'use client';

import { useState } from 'react';
import type { ProductReview } from '@/lib/api';
import { submitReview } from '@/lib/api';
import { getStoredSession, requestOtp, verifyOtp, type CustomerSession } from '@/lib/customer-auth';
import { buttonClassName } from '../ui/Button';

type Step = 'closed' | 'mobile' | 'otp' | 'review';

/**
 * Ratings & reviews (M11, PDP-001) - required customer-facing feature.
 * The rating summary and review list are always the real, live values
 * from the backend (never a fabricated count). Writing a review needs a
 * customer session; this component includes a minimal, self-contained
 * mobile-OTP sign-in (reusing the real M01 OTP endpoints) rather than
 * faking a submission - see lib/customer-auth.ts's docblock for why this
 * stays narrowly scoped and doesn't become a full account system.
 */
export function ReviewsSection({
  styleId,
  ratingSummary,
  initialReviews,
}: {
  styleId: string;
  ratingSummary: { averageRating: number | null; reviewCount: number };
  initialReviews: ProductReview[];
}) {
  const [reviews, setReviews] = useState(initialReviews);
  const [summary, setSummary] = useState(ratingSummary);
  const [step, setStep] = useState<Step>('closed');
  const [mobile, setMobile] = useState('');
  const [code, setCode] = useState('');
  const [session, setSession] = useState<CustomerSession | null>(null);
  const [rating, setRating] = useState(5);
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function openFlow() {
    setError(null);
    const existing = getStoredSession();
    if (existing) {
      setSession(existing);
      setStep('review');
    } else {
      setStep('mobile');
    }
  }

  async function handleRequestOtp(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await requestOtp(mobile);
      setStep('otp');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send OTP.');
    }
  }

  async function handleVerifyOtp(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const s = await verifyOtp(mobile, code);
      setSession(s);
      setStep('review');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Incorrect or expired code.');
    }
  }

  async function handleSubmitReview(e: React.FormEvent) {
    e.preventDefault();
    if (!session) return;
    setError(null);
    setSubmitting(true);
    try {
      const review = await submitReview(styleId, session.accessToken, { rating, body });
      setReviews((prev) => [review, ...prev]);
      setSummary((prev) => ({
        averageRating: ((prev.averageRating ?? 0) * prev.reviewCount + rating) / (prev.reviewCount + 1),
        reviewCount: prev.reviewCount + 1,
      }));
      setStep('closed');
      setBody('');
      setRating(5);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not submit your review.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section aria-labelledby="reviews-heading" className="mt-16 border-t border-border pt-8">
      <div className="flex items-center justify-between">
        <h2 id="reviews-heading" className="font-display text-xl text-ink">
          Ratings &amp; Reviews
        </h2>
        {step === 'closed' && (
          <button type="button" onClick={openFlow} className={buttonClassName('secondary')}>
            Write a review
          </button>
        )}
      </div>

      {summary.reviewCount > 0 && summary.averageRating !== null ? (
        <p className="mt-2 text-sm text-ink-muted">
          {summary.averageRating.toFixed(1)} out of 5 &middot; {summary.reviewCount} review
          {summary.reviewCount === 1 ? '' : 's'}
        </p>
      ) : (
        <p className="mt-2 text-sm text-ink-muted">No reviews yet - be the first.</p>
      )}

      {step === 'mobile' && (
        <form onSubmit={handleRequestOtp} className="mt-4 max-w-sm space-y-2">
          <label htmlFor="review-mobile" className="text-sm text-ink">
            Mobile number
          </label>
          <input
            id="review-mobile"
            type="tel"
            required
            value={mobile}
            onChange={(e) => setMobile(e.target.value)}
            className="block min-h-[44px] w-full rounded-sm border border-border px-3 text-sm text-ink"
          />
          <button type="submit" className={buttonClassName('primary', 'w-full')}>
            Send code
          </button>
        </form>
      )}

      {step === 'otp' && (
        <form onSubmit={handleVerifyOtp} className="mt-4 max-w-sm space-y-2">
          <label htmlFor="review-otp" className="text-sm text-ink">
            Enter the 6-digit code
          </label>
          <input
            id="review-otp"
            type="text"
            inputMode="numeric"
            maxLength={6}
            required
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            className="block min-h-[44px] w-full rounded-sm border border-border px-3 text-sm text-ink"
          />
          <button type="submit" className={buttonClassName('primary', 'w-full')}>
            Verify
          </button>
        </form>
      )}

      {step === 'review' && (
        <form onSubmit={handleSubmitReview} className="mt-4 max-w-lg space-y-3">
          <div>
            <label htmlFor="review-rating" className="text-sm text-ink">
              Rating
            </label>
            <select
              id="review-rating"
              value={rating}
              onChange={(e) => setRating(Number(e.target.value))}
              className="ml-2 min-h-[44px] rounded-sm border border-border px-2 text-sm text-ink"
            >
              {[5, 4, 3, 2, 1].map((n) => (
                <option key={n} value={n}>
                  {n} star{n === 1 ? '' : 's'}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="review-body" className="text-sm text-ink">
              Your review
            </label>
            <textarea
              id="review-body"
              required
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={4}
              className="mt-1 block w-full rounded-sm border border-border px-3 py-2 text-sm text-ink"
            />
          </div>
          <button type="submit" disabled={submitting} className={buttonClassName('primary')}>
            {submitting ? 'Submitting...' : 'Submit review'}
          </button>
        </form>
      )}

      {error && (
        <p role="alert" className="mt-2 text-sm text-danger">
          {error}
        </p>
      )}

      <ul className="mt-6 space-y-6">
        {reviews.map((review) => (
          <li key={review.id} className="border-b border-border pb-6">
            <p className="text-sm text-ink">
              {review.rating} out of 5 {review.title ? `— ${review.title}` : ''}
            </p>
            <p className="mt-1 text-sm text-ink-muted">{review.body}</p>
            <p className="mt-2 text-xs text-ink-muted">{review.customerName}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
