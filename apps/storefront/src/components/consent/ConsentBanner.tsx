'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { applyConsent, GA4_ID, META_PIXEL_ID, OPEN_CHOICES_EVENT, readConsent, saveConsent, trackingConfigured } from '@/lib/tracking';

/**
 * LR-003 consent: shown on the first visit when an analytics or Meta tag is
 * configured (with none configured there is nothing to consent to), and
 * reopened from "Privacy choices" in the footer to change or withdraw.
 */
export function ConsentBanner() {
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState(false);
  const [analytics, setAnalytics] = useState(false);
  const [marketing, setMarketing] = useState(false);

  useEffect(() => {
    if (!trackingConfigured()) return;
    const stored = readConsent();
    applyConsent(stored);
    if (!stored) setOpen(true);
    const reopen = () => {
      const current = readConsent();
      setAnalytics(current?.analytics ?? false);
      setMarketing(current?.marketing ?? false);
      setDetail(true);
      setOpen(true);
    };
    window.addEventListener(OPEN_CHOICES_EVENT, reopen);
    return () => window.removeEventListener(OPEN_CHOICES_EVENT, reopen);
  }, []);

  if (!open) return null;

  const decide = (choice: { analytics: boolean; marketing: boolean }) => {
    saveConsent(choice);
    setOpen(false);
    setDetail(false);
  };

  return (
    <section
      role="dialog"
      aria-modal="false"
      aria-labelledby="consent-title"
      data-testid="consent-banner"
      className="fixed inset-x-3 bottom-3 z-[90] mx-auto max-w-xl rounded-[20px] border border-[#e6ddd0] bg-white p-5 text-[#181716] shadow-[0_18px_50px_rgba(24,23,22,0.18)] sm:inset-x-6 sm:bottom-6"
    >
      <h2 id="consent-title" className="font-display text-xl">Your privacy choices</h2>
      <p className="mt-2 text-xs leading-5 text-[#5f554c]">
        With your permission we measure how the store is used{META_PIXEL_ID ? ' and how our Meta advertising performs' : ''}. Nothing is collected until you choose, and you can change this at any time from &ldquo;Privacy choices&rdquo; at the bottom of every page.{' '}
        <Link href="/legal/privacy" className="underline underline-offset-2">Privacy policy</Link>
      </p>
      {detail && (
        <div className="mt-4 space-y-3">
          {GA4_ID && (
            <label className="flex items-start gap-3 text-xs">
              <input type="checkbox" checked={analytics} onChange={(e) => setAnalytics(e.target.checked)} className="mt-0.5 h-5 w-5" />
              <span><span className="font-semibold">Analytics</span> — Google Analytics: which pages and products are viewed and bought.</span>
            </label>
          )}
          {META_PIXEL_ID && (
            <label className="flex items-start gap-3 text-xs">
              <input type="checkbox" checked={marketing} onChange={(e) => setMarketing(e.target.checked)} className="mt-0.5 h-5 w-5" />
              <span><span className="font-semibold">Marketing</span> — Meta: measuring our ads, including a hashed (unreadable) email and phone number for orders.</span>
            </label>
          )}
        </div>
      )}
      <div className="mt-4 flex flex-wrap gap-2">
        {detail ? (
          <button type="button" onClick={() => decide({ analytics, marketing })} className="min-h-[44px] rounded-full bg-[#181716] px-5 text-[11px] font-semibold uppercase tracking-[0.12em] text-white">
            Save choices
          </button>
        ) : (
          <>
            <button type="button" onClick={() => decide({ analytics: Boolean(GA4_ID), marketing: Boolean(META_PIXEL_ID) })} className="min-h-[44px] rounded-full bg-[#181716] px-5 text-[11px] font-semibold uppercase tracking-[0.12em] text-white">
              Accept all
            </button>
            <button type="button" onClick={() => setDetail(true)} className="min-h-[44px] rounded-full border border-[#181716] px-5 text-[11px] font-semibold uppercase tracking-[0.12em]">
              Choose
            </button>
          </>
        )}
        <button type="button" onClick={() => decide({ analytics: false, marketing: false })} className="min-h-[44px] rounded-full border border-[#d8d0c6] px-5 text-[11px] font-semibold uppercase tracking-[0.12em] text-[#5f554c]">
          Reject all
        </button>
      </div>
    </section>
  );
}

/** Footer control to change or withdraw consent. */
export function PrivacyChoicesButton({ className }: { className?: string }) {
  const [configured, setConfigured] = useState(false);
  useEffect(() => setConfigured(trackingConfigured()), []);
  if (!configured) return null;
  return (
    <button type="button" onClick={() => window.dispatchEvent(new Event(OPEN_CHOICES_EVENT))} className={className}>
      Privacy choices
    </button>
  );
}
