'use client';

import { useState } from 'react';
import { ActionMessage, DataState, PageHeader, Section, StatusBadge } from '@/components/ui';
import { apiSend } from '@/lib/api';
import { displayImageUrl } from '@/lib/media';
import { useAction, useApi } from '@/lib/session';

interface CuratedReview {
  id: string;
  rating: number;
  title: string | null;
  body: string;
  status: 'PUBLISHED' | 'HIDDEN';
  createdAt: string;
  customerName: string;
  photoUrl: string;
  featuredOnHome: boolean;
  featuredSortOrder: number | null;
  style: { id: string; name: string };
}

/**
 * specs/36: every review with a photo, with a toggle for whether it shows
 * in the homepage "What Our Customers Say" carousel and a position among
 * the other featured reviews. Attaching a photo never features it by
 * itself - that is always this explicit staff action.
 */
export default function PhotoReviewsPage() {
  const reviews = useApi<{ reviews: CuratedReview[]; total: number }>('/pdp/reviews?take=100');
  const action = useAction();
  const [sortDrafts, setSortDrafts] = useState<Record<string, string>>({});

  async function setFeatured(r: CuratedReview, featuredOnHome: boolean, featuredSortOrder: number | null) {
    const ok = await action.run(
      () => apiSend('PATCH', `/pdp/reviews/${r.id}/featured`, { featuredOnHome, featuredSortOrder }),
      featuredOnHome ? 'Featured on the homepage.' : 'Removed from the homepage.',
    );
    if (ok) reviews.reload();
  }

  return (
    <div>
      <PageHeader
        title="Photo reviews"
        breadcrumbs={[{ label: 'Content' }, { label: 'Photo reviews' }]}
        description="Reviews with a customer photo. Feature a selection on the homepage's 'What Our Customers Say' carousel - attaching a photo never features it by itself."
      />
      <ActionMessage message={action.message} />
      <DataState state={reviews}>
        {({ reviews: list }) => (
          <Section title={`Reviews with a photo (${list.length})`}>
            {list.length === 0 ? (
              <p className="muted small">No review has a photo yet.</p>
            ) : (
              <div className="photo-grid">
                {list.map((r) => {
                  const canFeature = r.status !== 'HIDDEN';
                  const draft = sortDrafts[r.id] ?? (r.featuredSortOrder ?? '');
                  return (
                    <div key={r.id} className="photo-card">
                      <div className="photo-frame">
                        {displayImageUrl(r.photoUrl) ? <img src={displayImageUrl(r.photoUrl)!} alt="" /> : <span className="muted small">No preview</span>}
                      </div>
                      <div className="photo-meta">
                        <strong>{r.customerName}</strong>
                        <span className="small muted">{r.style.name}</span>
                        <span className="small">
                          {r.rating}★ <StatusBadge status={r.status} /> {r.featuredOnHome && <span className="badge success">Featured</span>}
                        </span>
                        {!canFeature && <span className="small muted">Hidden reviews cannot be featured.</span>}
                        <p className="small" style={{ margin: 0 }}>
                          {r.body.length > 140 ? `${r.body.slice(0, 140)}…` : r.body}
                        </p>
                        <div className="row photo-actions" style={{ alignItems: 'center' }}>
                          <input
                            type="number"
                            aria-label="Homepage position"
                            placeholder="Position"
                            value={draft}
                            disabled={!canFeature}
                            style={{ width: 80 }}
                            onChange={(e) => setSortDrafts((d) => ({ ...d, [r.id]: e.target.value }))}
                          />
                          <button
                            type="button"
                            className="btn small"
                            disabled={action.busy || !canFeature}
                            onClick={() => {
                              const n = Number(sortDrafts[r.id]);
                              setFeatured(r, !r.featuredOnHome, r.featuredOnHome ? null : Number.isFinite(n) && sortDrafts[r.id] ? n : (r.featuredSortOrder ?? 0));
                            }}
                          >
                            {r.featuredOnHome ? 'Remove from homepage' : 'Feature on homepage'}
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Section>
        )}
      </DataState>
    </div>
  );
}
