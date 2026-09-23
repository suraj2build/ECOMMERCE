'use client';

import { useState } from 'react';
import { checkServiceability, type ServiceabilityResult } from '@/lib/api';

/**
 * PIN-code serviceability check (IND-002), required directly on the PDP.
 * A non-serviceable or unrecognized PIN code shows clear messaging and
 * never blocks the rest of the page (negative scenario #2,
 * acceptance/m11-pdp.md) - re-validated again at checkout (M13) against
 * the same backend data, so the two checks can never disagree.
 */
export function PincodeChecker() {
  const [pincode, setPincode] = useState('');
  const [result, setResult] = useState<ServiceabilityResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleCheck(e: React.FormEvent) {
    e.preventDefault();
    if (!/^[0-9]{6}$/.test(pincode)) {
      setError('Enter a valid 6-digit PIN code.');
      setResult(null);
      return;
    }
    setError(null);
    setLoading(true);
    try {
      setResult(await checkServiceability(pincode));
    } catch {
      setError('Could not check serviceability right now - please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mt-8 border-t border-border pt-6">
      <h2 className="text-sm font-medium text-ink">Check delivery availability</h2>
      <form onSubmit={handleCheck} className="mt-2 flex gap-2">
        <label htmlFor="pincode-input" className="sr-only">
          PIN code
        </label>
        <input
          id="pincode-input"
          type="text"
          inputMode="numeric"
          maxLength={6}
          value={pincode}
          onChange={(e) => setPincode(e.target.value.replace(/\D/g, ''))}
          placeholder="Enter PIN code"
          className="min-h-[44px] w-40 rounded-sm border border-border px-3 text-sm text-ink"
        />
        <button
          type="submit"
          disabled={loading}
          className="min-h-[44px] rounded-sm border border-ink px-4 text-sm text-ink disabled:opacity-50"
        >
          Check
        </button>
      </form>
      {error && (
        <p role="alert" className="mt-2 text-sm text-danger">
          {error}
        </p>
      )}
      {result && !error && (
        <p role="status" className="mt-2 text-sm">
          {result.isServiceable ? (
            <span className="text-ink">
              Delivers to {result.city ?? 'this PIN code'}
              {result.estimatedDaysMin && result.estimatedDaysMax
                ? ` in ${result.estimatedDaysMin}-${result.estimatedDaysMax} days`
                : ''}
              {result.codAvailable ? ' · Cash on delivery available' : ''}
            </span>
          ) : (
            <span className="text-ink-muted">
              {result.known ? 'This PIN code is not currently serviceable.' : "We don't have delivery data for this PIN code yet."}
            </span>
          )}
        </p>
      )}
    </div>
  );
}
