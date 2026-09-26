'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { getStoredSession, requestOtp, verifyOtp } from '@/lib/customer-auth';
import { buttonClassName } from '../ui/Button';

type Step = 'checking' | 'mobile' | 'otp' | 'signed-in';

/**
 * M22 Customer 360 - every /account/* page is authenticated-customer-only
 * (never a guest fallback: a saved profile/address book/My Sizes/
 * communication-preference matrix has no guest analogue). This gate is
 * the single place that enforces that, reusing the SAME real mobile-OTP
 * endpoints ReviewsSection already uses on the PDP - no separate/fake
 * "account login" is invented.
 */
export function AccountGate({ children }: { children: ReactNode }) {
  const [step, setStep] = useState<Step>('checking');
  const [mobile, setMobile] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setStep(getStoredSession() ? 'signed-in' : 'mobile');
  }, []);

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
      await verifyOtp(mobile, code);
      setStep('signed-in');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Incorrect or expired code.');
    }
  }

  if (step === 'checking') return <p className="mt-6 text-sm text-ink-muted">Loading...</p>;

  if (step === 'signed-in') return <>{children}</>;

  return (
    <div className="mt-6 max-w-sm">
      <h2 className="font-display text-lg text-ink">Sign in to your account</h2>
      <p className="mt-1 text-sm text-ink-muted">Enter your mobile number to receive a one-time code.</p>

      {step === 'mobile' && (
        <form onSubmit={handleRequestOtp} className="mt-4 space-y-2">
          <label htmlFor="account-mobile" className="text-sm text-ink">
            Mobile number
          </label>
          <input
            id="account-mobile"
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
        <form onSubmit={handleVerifyOtp} className="mt-4 space-y-2">
          <label htmlFor="account-otp" className="text-sm text-ink">
            Enter the 6-digit code
          </label>
          <input
            id="account-otp"
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

      {error && (
        <p role="alert" className="mt-2 text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
