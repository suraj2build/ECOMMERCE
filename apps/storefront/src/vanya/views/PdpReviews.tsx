'use client';

/**
 * The approved design's "Ratings & Reviews" block (Stitch-Spark_Ai_Studio
 * views/PdpView.tsx) over the real reviews. Writing a review signs the
 * shopper in with a mobile code and posts to the review API, which publishes
 * it under the customer's own account name. Left out because nothing records
 * them: the "verified buyer" mark, purchased size/colour/fit fields and the
 * "96% say true to size" consensus line.
 */
import React, { useState } from 'react';
import { Star, Sparkles, Check, X } from 'lucide-react';
import { submitReview, type ProductReview } from '@/lib/api';
import { getStoredSession, requestOtp, verifyOtp, type CustomerSession } from '@/lib/customer-auth';

const RATING_WORDS: Record<number, string> = {
  5: '5★ — Exceptional',
  4: '4★ — Highly Recommended',
  3: '3★ — Satisfactory',
  2: '2★ — Below Expectations',
  1: '1★ — Needs Improvement',
};

function Stars({ value, size = 'w-3.5 h-3.5' }: { value: number; size?: string }) {
  return (
    <div className="flex text-[#D4AF37]" aria-hidden="true">
      {[1, 2, 3, 4, 5].map((star) => (
        <Star key={star} className={`${size} ${star <= Math.round(value) ? 'fill-[#D4AF37] text-[#D4AF37]' : 'text-[#DDD4C6]'}`} />
      ))}
    </div>
  );
}

const fieldClass = 'w-full px-3 py-2.5 bg-white border border-[#DDD5C7] rounded-xl text-sm text-[#1A1816] focus:outline-none focus:border-[#B2593E]';
const labelClass = 'block text-[11px] uppercase tracking-wider font-semibold text-[#38312A] mb-1';

export function PdpReviews({
  styleId,
  productTitle,
  initialReviews,
  initialSummary,
  reviewsTotal,
}: {
  styleId: string;
  productTitle: string;
  initialReviews: ProductReview[];
  initialSummary: { averageRating: number | null; reviewCount: number };
  reviewsTotal: number;
}) {
  const [reviews, setReviews] = useState(initialReviews);
  const [summary, setSummary] = useState(initialSummary);
  const loadedAll = initialReviews.length >= reviewsTotal;
  const [reviewSortBy, setReviewSortBy] = useState<'highest' | 'lowest' | 'newest'>('newest');
  const [starFilter, setStarFilter] = useState<number | 'all'>('all');

  const [formOpen, setFormOpen] = useState(false);
  const [step, setStep] = useState<'mobile' | 'otp' | 'review'>('mobile');
  const [session, setSession] = useState<CustomerSession | null>(null);
  const [mobile, setMobile] = useState('');
  const [code, setCode] = useState('');
  const [rating, setRating] = useState(5);
  const [hoverRating, setHoverRating] = useState(0);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const totalReviewsCount = summary.reviewCount;
  const averageRating = summary.averageRating ?? 0;
  const starCounts: Record<number, number> = {};
  for (const stars of [5, 4, 3, 2, 1]) starCounts[stars] = reviews.filter((r) => r.rating === stars).length;
  const getStarPercentage = (count: number) => (reviews.length === 0 ? 0 : Math.round((count / reviews.length) * 100));

  const displayedReviews = reviews
    .map((review, index) => ({ review, index }))
    .filter(({ review }) => (starFilter === 'all' ? true : review.rating === starFilter))
    .sort((a, b) => {
      if (reviewSortBy === 'highest') return b.review.rating - a.review.rating || a.index - b.index;
      if (reviewSortBy === 'lowest') return a.review.rating - b.review.rating || a.index - b.index;
      return Date.parse(b.review.createdAt) - Date.parse(a.review.createdAt);
    })
    .map(({ review }) => review);

  function toggleForm() {
    if (formOpen) { setFormOpen(false); return; }
    setError(null);
    setSubmitted(false);
    const existing = getStoredSession();
    setSession(existing);
    setStep(existing ? 'review' : 'mobile');
    setFormOpen(true);
  }

  async function handleRequestOtp(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await requestOtp(mobile);
      setStep('otp');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send the code.');
    }
  }

  async function handleVerifyOtp(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      setSession(await verifyOtp(mobile, code));
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
      const review = await submitReview(styleId, session.accessToken, { rating, body, ...(title.trim() ? { title: title.trim() } : {}) });
      setReviews((prev) => [review, ...prev]);
      setSummary((prev) => ({
        averageRating: ((prev.averageRating ?? 0) * prev.reviewCount + rating) / (prev.reviewCount + 1),
        reviewCount: prev.reviewCount + 1,
      }));
      setSubmitted(true);
      setTitle('');
      setBody('');
      setRating(5);
      setTimeout(() => { setSubmitted(false); setFormOpen(false); }, 1600);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not submit your review.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section id="pdp-reviews" aria-labelledby="reviews-heading" className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 border-t border-[#EAE3D7]">
      <div className="grid grid-cols-1 md:grid-cols-12 gap-8 lg:gap-12">
        {/* Left: Star Rating System & Distribution Bars */}
        <div className="md:col-span-4 space-y-5">
          <div>
            <span className="text-[10px] uppercase tracking-[0.24em] font-semibold text-[#A85B3F]">
              Customer Feedback
            </span>
            <h3 id="reviews-heading" className="font-editorial text-3xl text-[#1A1816] font-normal mt-1">
              Ratings &amp; Reviews
            </h3>
          </div>

          {totalReviewsCount > 0 ? (
            <div className="flex items-baseline gap-3">
              <span className="font-editorial text-5xl font-bold text-[#1A1816]">
                {averageRating.toFixed(1)}
              </span>
              <div>
                <Stars value={averageRating} size="w-4 h-4" />
                <span className="text-xs text-[#7A6F64] block mt-0.5">
                  Based on {totalReviewsCount} customer {totalReviewsCount === 1 ? 'review' : 'reviews'}
                </span>
              </div>
            </div>
          ) : (
            <p className="text-xs text-[#7A6F64]">No reviews yet. Be the first to share how it wears.</p>
          )}

          {/* Interactive Star Distribution Bars (only when every review is loaded) */}
          {totalReviewsCount > 0 && loadedAll && (
            <div className="space-y-2 text-xs text-[#61564B]">
              <span className="text-[10px] uppercase tracking-wider text-[#756A5E] font-semibold block">
                Filter by Star Rating:
              </span>
              {[5, 4, 3, 2, 1].map((stars) => {
                const count = starCounts[stars] || 0;
                const pct = getStarPercentage(count);
                const isSelected = starFilter === stars;
                return (
                  <button
                    key={stars}
                    type="button"
                    aria-pressed={isSelected}
                    aria-label={`${stars} star reviews: ${count}`}
                    onClick={() => setStarFilter((prev) => (prev === stars ? 'all' : stars))}
                    className={`w-full flex items-center gap-2.5 p-1.5 rounded-full transition-colors group cursor-pointer ${
                      isSelected ? 'bg-[#FAF3E0] ring-1 ring-[#D4AF37]' : 'hover:bg-[#FAF8F5]'
                    }`}
                  >
                    <span className="w-6 text-right font-medium group-hover:text-[#1A1816]">{stars}★</span>
                    <div className="flex-1 bg-[#EAE3D7] h-2.5 rounded-full overflow-hidden">
                      <div className="bg-[#1A1816] h-full transition-all duration-300" style={{ width: `${pct}%` }} />
                    </div>
                    <span className="w-14 text-[11px] text-[#756A5E] text-right font-mono">
                      {count} ({pct}%)
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {/* Write a Review Button */}
          <button
            id="btn-write-review-toggle"
            type="button"
            aria-expanded={formOpen}
            onClick={toggleForm}
            className="w-full py-3 bg-[#1A1816] hover:bg-black text-[#FAF8F5] text-xs uppercase tracking-wider font-semibold rounded-full transition-colors flex items-center justify-center gap-2 cursor-pointer shadow-xs"
          >
            <Sparkles className="w-3.5 h-3.5 text-[#D4AF37]" />
            <span>{formOpen ? 'Close Review Form' : 'Write a Review'}</span>
          </button>
        </div>

        {/* Right: Review Controls, Form & Reviews List */}
        <div className="md:col-span-8 space-y-5">
          {formOpen && (
            <div id="inline-review-submission-card" className="p-5 sm:p-6 bg-[#FAF8F5] border border-[#E5DFD5] rounded-2xl shadow-sm space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-[#EAE3D7]">
                <div>
                  <span className="text-[10px] uppercase tracking-[0.2em] font-bold text-[#A85B3F] block">
                    Share Your Experience
                  </span>
                  <h4 className="font-editorial text-2xl text-[#1A1816] font-normal mt-0.5">
                    Review {productTitle}
                  </h4>
                </div>
                <button type="button" onClick={() => setFormOpen(false)} aria-label="Close review form" className="p-2 text-[#756A5E] hover:text-[#1A1816]">
                  <X className="w-5 h-5" />
                </button>
              </div>

              {submitted ? (
                <div role="status" className="py-8 text-center space-y-2">
                  <Check className="w-8 h-8 text-[#2E5836] mx-auto" />
                  <h5 className="font-editorial text-2xl text-[#1A1816]">Thank you for your feedback!</h5>
                  <p className="text-xs text-[#7A6E63] max-w-sm mx-auto">Your review is now shown on this product.</p>
                </div>
              ) : step === 'mobile' ? (
                <form onSubmit={handleRequestOtp} className="space-y-3 text-xs max-w-sm">
                  <p className="text-[#6E6358]">Sign in with your mobile number to write a review.</p>
                  <div>
                    <label htmlFor="review-mobile" className={labelClass}>Mobile number</label>
                    <input id="review-mobile" type="tel" inputMode="numeric" autoComplete="tel" required value={mobile} onChange={(e) => setMobile(e.target.value)} className={fieldClass} />
                  </div>
                  <button type="submit" className="px-6 py-2.5 bg-[#1A1816] hover:bg-black text-[#FAF8F5] uppercase tracking-wider text-xs font-semibold rounded-full">
                    Send code
                  </button>
                </form>
              ) : step === 'otp' ? (
                <form onSubmit={handleVerifyOtp} className="space-y-3 text-xs max-w-sm">
                  <div>
                    <label htmlFor="review-otp" className={labelClass}>Enter the 6-digit code</label>
                    <input id="review-otp" type="text" inputMode="numeric" autoComplete="one-time-code" maxLength={6} required value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} className={fieldClass} />
                  </div>
                  <button type="submit" className="px-6 py-2.5 bg-[#1A1816] hover:bg-black text-[#FAF8F5] uppercase tracking-wider text-xs font-semibold rounded-full">
                    Verify
                  </button>
                </form>
              ) : (
                <form onSubmit={handleSubmitReview} className="space-y-4 text-xs">
                  <fieldset>
                    <legend className={labelClass}>Your Star Rating *</legend>
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="flex gap-1">
                        {[1, 2, 3, 4, 5].map((star) => (
                          <button
                            key={star}
                            type="button"
                            onMouseEnter={() => setHoverRating(star)}
                            onMouseLeave={() => setHoverRating(0)}
                            onClick={() => setRating(star)}
                            aria-pressed={rating === star}
                            className="p-1 cursor-pointer transition-transform hover:scale-115"
                            aria-label={`${star} ${star === 1 ? 'Star' : 'Stars'}`}
                          >
                            <Star className={`w-6 h-6 transition-colors ${star <= (hoverRating || rating) ? 'fill-[#D4AF37] text-[#D4AF37]' : 'text-[#DCD5C9]'}`} />
                          </button>
                        ))}
                      </div>
                      <span className="text-xs font-semibold text-[#8C6D1F] ml-2">{RATING_WORDS[hoverRating || rating]}</span>
                    </div>
                  </fieldset>

                  <div>
                    <label htmlFor="review-title" className={labelClass}>Headline / Title</label>
                    <input id="review-title" type="text" maxLength={120} placeholder="e.g. Sublime drape and rich texture" value={title} onChange={(e) => setTitle(e.target.value)} className={fieldClass} />
                  </div>

                  <div>
                    <label htmlFor="review-body" className={labelClass}>Your review *</label>
                    <textarea
                      id="review-body"
                      rows={3}
                      required
                      placeholder="Tell other shoppers about the fabric feel, drape, craftsmanship, and how you styled it..."
                      value={body}
                      onChange={(e) => setBody(e.target.value)}
                      className={fieldClass}
                    />
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                    <span className="text-[10px] text-[#756A5E]">Shown with the name on your account.</span>
                    <div className="flex gap-2">
                      <button type="button" onClick={() => setFormOpen(false)} className="px-4 py-2.5 border border-[#DDD5C7] text-[#5C5146] hover:bg-[#F2ECE1] uppercase tracking-wider text-xs font-semibold rounded-full transition-colors">
                        Cancel
                      </button>
                      <button type="submit" disabled={submitting} className="px-6 py-2.5 bg-[#1A1816] hover:bg-black text-[#FAF8F5] uppercase tracking-wider text-xs font-semibold rounded-full transition-colors cursor-pointer shadow-xs disabled:opacity-60">
                        {submitting ? 'Submitting…' : 'Submit Review'}
                      </button>
                    </div>
                  </div>
                </form>
              )}
              {error && <p role="alert" className="text-xs text-[#962E3B]">{error}</p>}
            </div>
          )}

          {reviews.length > 0 && (
            <>
              {/* Filter & Sort Controls Bar */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-[#EAE3D7]">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-[10px] uppercase tracking-wider text-[#756A5E] font-semibold mr-1">Filter:</span>
                  <button
                    type="button"
                    aria-pressed={starFilter === 'all'}
                    onClick={() => setStarFilter('all')}
                    className={`text-[11px] px-2.5 py-1 rounded-full uppercase tracking-wider font-medium transition-colors ${
                      starFilter === 'all' ? 'bg-[#1A1816] text-white font-semibold' : 'bg-white border border-[#D8CEBF] text-[#6B5E52] hover:border-[#1A1816]'
                    }`}
                  >
                    All ({reviews.length})
                  </button>
                  {[5, 4, 3].map((star) => (
                    <button
                      key={star}
                      type="button"
                      aria-pressed={starFilter === star}
                      onClick={() => setStarFilter(star)}
                      className={`text-[11px] px-2.5 py-1 rounded-full uppercase tracking-wider font-medium transition-colors ${
                        starFilter === star ? 'bg-[#1A1816] text-white font-semibold' : 'bg-white border border-[#D8CEBF] text-[#6B5E52] hover:border-[#1A1816]'
                      }`}
                    >
                      {star}★ ({starCounts[star] || 0})
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-2 self-start sm:self-auto">
                  <span className="text-[10px] uppercase tracking-wider text-[#756A5E] font-semibold shrink-0">Sort:</span>
                  <select
                    id="reviews-sort-by-select"
                    value={reviewSortBy}
                    onChange={(e) => setReviewSortBy(e.target.value as 'highest' | 'lowest' | 'newest')}
                    className="px-2.5 py-1.5 bg-white border border-[#D8CEBF] rounded-full text-xs text-[#1A1816] font-medium focus:outline-none focus:border-[#B2593E] cursor-pointer"
                    aria-label="Sort reviews"
                  >
                    <option value="newest">Newest First</option>
                    <option value="highest">Highest Rating (5★ → 1★)</option>
                    <option value="lowest">Lowest Rating (1★ → 5★)</option>
                  </select>
                </div>
              </div>

              {starFilter !== 'all' && (
                <div className="flex items-center justify-between p-2.5 bg-[#FAF3E0] border border-[#E8D4A2] rounded-2xl text-xs text-[#8C6D1F]">
                  <span>Showing reviews with <strong>{starFilter} Stars</strong> ({displayedReviews.length} found)</span>
                  <button type="button" onClick={() => setStarFilter('all')} className="text-xs font-semibold text-[#A65439] hover:underline">
                    Clear Filter ×
                  </button>
                </div>
              )}

              {displayedReviews.length === 0 ? (
                <div className="py-12 text-center bg-[#FAF8F5] border border-[#EAE3D7] rounded-2xl space-y-2">
                  <p className="font-editorial text-lg text-[#1A1816]">No reviews found matching this filter</p>
                  <button type="button" onClick={() => setStarFilter('all')} className="text-xs text-[#A65439] font-semibold underline">
                    Show all {reviews.length} reviews
                  </button>
                </div>
              ) : (
                <ul className="divide-y divide-[#EAE3D7] space-y-4">
                  {displayedReviews.map((rev) => (
                    <li key={rev.id} className="pt-4 first:pt-0 space-y-2">
                      <div className="flex items-center justify-between gap-3">
                        <span className="font-semibold text-xs text-[#1A1816]">{rev.customerName}</span>
                        <span className="text-[11px] text-[#756A5E] font-mono">
                          {new Date(rev.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Stars value={rev.rating} />
                        <span className="sr-only">{rev.rating} out of 5</span>
                        {rev.title && <span className="text-xs font-semibold text-[#1A1816]">{rev.title}</span>}
                      </div>
                      <p className="text-xs text-[#52473D] leading-relaxed font-light">{rev.body}</p>
                    </li>
                  ))}
                </ul>
              )}
              {!loadedAll && (
                <p className="text-[11px] text-[#756A5E]">Showing the {reviews.length} most recent of {reviewsTotal} reviews.</p>
              )}
            </>
          )}
        </div>
      </div>
    </section>
  );
}
