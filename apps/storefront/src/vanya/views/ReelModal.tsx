'use client';

/**
 * The reel-viewing modal (specs/35-watch-and-shop.md's 2026-10-17 addendum):
 * rendered by the app/@modal/(.)watch-and-shop intercepting route whenever a
 * reel link is clicked from elsewhere on the site (Home, search, etc.) - the
 * underlying page stays mounted behind it, no full navigation happens. A
 * direct or shared /watch-and-shop?reel=<id> load never reaches this
 * component at all (Next.js only engages an intercepting route for a soft,
 * client-side navigation); that case renders the real page
 * (app/watch-and-shop/page.tsx -> ReelsView) instead, unchanged.
 *
 * Closing calls router.back() - the standard intercepting-route pattern - so
 * the browser's back button and this modal's own close control behave
 * identically, and the page underneath never loses its scroll position.
 */
import { useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { ShoppableMediaSummary } from '@/lib/api';
import { useModalFocus } from '@/components/layout/useModalFocus';
import { mediaToReel } from '../bridge/adapters';
import { useShop } from '../bridge/shop';
import { ReelViewer } from './ReelViewer';

export function ReelModal({ feed, initialReelId }: { feed: ShoppableMediaSummary[]; initialReelId?: string }) {
  const shop = useShop();
  const router = useRouter();
  const dialogRef = useRef<HTMLDivElement>(null);

  const reels = useMemo(() => {
    const own = feed.filter((media) => media.tags.some((tag) => (tag.style.gender ?? tag.style.department ?? '').toLowerCase() === shop.gender));
    return (own.length > 0 ? own : feed).map(mediaToReel);
  }, [feed, shop.gender]);

  const initialIndex = initialReelId ? Math.max(0, reels.findIndex((r) => r.id === initialReelId)) : 0;
  const [activeIndex, setActiveIndex] = useState(initialIndex);

  const close = () => router.back();
  useModalFocus(true, dialogRef, close);

  const navigate = (index: number) => {
    setActiveIndex(index);
    // Keep the URL in sync as the customer pages through reels, so a refresh
    // or a copied link mid-browse reopens the same reel - replace (not push)
    // so the back button still closes the modal in one step, not one per reel.
    const reel = reels[index];
    if (reel) router.replace(`/watch-and-shop?reel=${reel.id}`, { scroll: false });
  };

  if (reels.length === 0) return null;

  return (
    <div id="reel-modal-backdrop" className="fixed inset-0 z-[80] flex items-center justify-center bg-black/85 backdrop-blur-sm p-0 sm:p-6">
      <button type="button" tabIndex={-1} aria-hidden="true" onClick={close} className="absolute inset-0 cursor-default" />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Watch & Shop"
        tabIndex={-1}
        className="relative w-full h-full sm:h-auto sm:max-h-[90vh] sm:max-w-5xl overflow-y-auto bg-[#141210] text-[#FAF8F5] sm:rounded-2xl p-4 sm:p-6 shadow-2xl"
      >
        <ReelViewer reels={reels} activeIndex={activeIndex} onNavigate={navigate} onClose={close} />
      </div>
    </div>
  );
}
