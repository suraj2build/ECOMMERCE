'use client';

/**
 * The approved AI Studio "Watch & Shop" cinema (Stitch-Spark_Ai_Studio
 * views/ReelsView.tsx), full-page form: the dedicated /watch-and-shop
 * destination for browsing all reels and the server-rendered fallback for a
 * direct/shared /watch-and-shop?reel=<id> link (specs/35-watch-and-shop.md's
 * 2026-10-17 addendum requires this stay real, crawlable HTML, not an empty
 * client shell). The same reel content also renders inside a modal
 * (ReelModal.tsx) when opened from elsewhere on the site without a full page
 * navigation - both share ReelViewer for the video + tagged-products rack.
 */
import React, { useMemo, useState } from 'react';
import type { ShoppableMediaSummary } from '@/lib/api';
import { mediaToReel } from '../bridge/adapters';
import { useShop } from '../bridge/shop';
import { ReelViewer } from './ReelViewer';

export function ReelsView({ feed, initialReelId }: { feed: ShoppableMediaSummary[]; initialReelId?: string }) {
  const shop = useShop();
  // The department's reels (any tagged piece from it); every reel if none match.
  const reels = useMemo(() => {
    const own = feed.filter((media) => media.tags.some((tag) => (tag.style.gender ?? tag.style.department ?? '').toLowerCase() === shop.gender));
    return (own.length > 0 ? own : feed).map(mediaToReel);
  }, [feed, shop.gender]);

  const initialIndex = initialReelId ? Math.max(0, reels.findIndex((r) => r.id === initialReelId)) : 0;
  const [activeReelIndex, setActiveReelIndex] = useState(initialIndex);

  if (reels.length === 0) {
    return (
      <div id="watch-and-shop-page" className="min-h-[60vh] bg-[#141210] text-[#FAF8F5] py-16">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 text-center space-y-2">
          <h1 className="font-editorial text-3xl font-normal">Watch &amp; Shop</h1>
          <p className="text-xs text-[#9E9084]">New styling stories are on their way.</p>
        </div>
      </div>
    );
  }

  return (
    <div id="watch-and-shop-page" className="min-h-[90vh] bg-[#141210] text-[#FAF8F5] py-6 sm:py-10">
      <div className="max-w-6xl mx-auto px-4 sm:px-6">
        {/* Page Subtitle & Info */}
        <div className="mb-6 flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-[#2A2521] pb-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-[#A85B3F] motion-safe:animate-ping" aria-hidden="true" />
              <span className="text-[10px] uppercase tracking-[0.24em] font-semibold text-[#D4AF37]">
                Watch &amp; Shop Cinema
              </span>
            </div>
            <h1 className="font-editorial text-2xl sm:text-3xl font-normal text-white mt-0.5">
              Live Fashion in Motion
            </h1>
          </div>
          <p className="text-xs text-[#9E9084] max-w-md">
            Direct shoppable video. Tap tagged products to select your size and add directly to your bag without pausing the experience.
          </p>
        </div>

        <ReelViewer reels={reels} activeIndex={activeReelIndex} onNavigate={setActiveReelIndex} />

        {/* Reel Carousel Selector (Thumbnails) - browsing/SEO destination, kept
            on the full page only; the modal relies on its own left/right arrows. */}
        {reels.length > 1 && (
          <div className="bg-[#1C1815] p-5 rounded-2xl border border-[#2B2621] mt-6">
            <span className="text-[11px] uppercase tracking-[0.2em] font-semibold text-[#A89C8F] block mb-3">Explore All Shoppable Reels</span>
            <div className="grid grid-cols-4 sm:grid-cols-6 lg:grid-cols-8 gap-2">
              {reels.map((r, idx) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => setActiveReelIndex(idx)}
                  aria-label={`Play ${r.title}`}
                  aria-current={activeReelIndex === idx}
                  className={`aspect-[9/16] rounded-xl overflow-hidden cursor-pointer border-2 transition-all relative ${
                    activeReelIndex === idx ? 'border-[#D4AF37] scale-102' : 'border-transparent opacity-60 hover:opacity-100'
                  }`}
                >
                  <img src={r.thumbnail} alt="" className="w-full h-full object-cover" />
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
