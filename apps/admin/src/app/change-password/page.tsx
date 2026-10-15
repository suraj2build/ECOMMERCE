'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { changeOwnPassword, getStoredSession, staffLogout } from '@/lib/staff-auth';

/**
 * Choose a new password (AO-D7). Required after a temporary password from
 * an administrator - until then the console offers nothing else - and
 * available at any time from the sidebar. Changing it signs out every
 * other browser signed in as you.
 */
export default function ChangePasswordPage() {
  const router = useRouter();
  const [forced, setForced] = useState<boolean | null>(null);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    const s = getStoredSession();
    if (!s) {
      router.replace('/login');
      return;
    }
    setForced(Boolean(s.mustChangePassword));
  }, [router]);

  if (forced === null) return null;

  if (done) {
    return (
      <main style={{ maxWidth: 420, margin: '4rem auto', padding: '0 1rem' }}>
        <h1 style={{ fontSize: '1.25rem', marginBottom: '0.5rem' }}>Password changed</h1>
        <div className="card">
          <p role="status">Your new password is saved. Any other browser signed in as you has been signed out; this one stays signed in.</p>
          <button type="button" className="primary" onClick={() => router.replace('/dashboard')}>
            Continue
          </button>
        </div>
      </main>
    );
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (next !== confirm) {
      setError('The two new passwords do not match.');
      return;
    }
    setSubmitting(true);
    try {
      await changeOwnPassword(current, next);
      setCurrent('');
      setNext('');
      setConfirm('');
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The password could not be changed.');
      if (!getStoredSession()) router.replace('/login');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main style={{ maxWidth: 420, margin: '4rem auto', padding: '0 1rem' }}>
      <h1 style={{ fontSize: '1.25rem', marginBottom: '0.5rem' }}>{forced ? 'Choose your own password' : 'Change password'}</h1>
      <p className="muted" style={{ marginBottom: '1.5rem' }}>
        {forced
          ? 'You signed in with a temporary password. Choose your own before continuing; the temporary one stops working.'
          : 'Other browsers signed in as you will be signed out.'}
      </p>
      <form onSubmit={onSubmit} className="card">
        {error && (
          <p className="error-banner" role="alert">
            {error}
          </p>
        )}
        <div className="field">
          <label htmlFor="current">{forced ? 'Temporary password' : 'Current password'}</label>
          <input id="current" type="password" autoComplete="current-password" required value={current} onChange={(e) => setCurrent(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="new">New password</label>
          <input id="new" type="password" autoComplete="new-password" required minLength={12} aria-describedby="new-hint" value={next} onChange={(e) => setNext(e.target.value)} />
          <span id="new-hint" className="hint">
            At least 12 characters, with letters and at least one number.
          </span>
        </div>
        <div className="field">
          <label htmlFor="confirm">New password again</label>
          <input id="confirm" type="password" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </div>
        <div className="row">
          <button className="primary" type="submit" disabled={submitting}>
            {submitting ? 'Saving...' : 'Save new password'}
          </button>
          {forced ? (
            <button
              type="button"
              className="btn"
              onClick={async () => {
                await staffLogout();
                router.replace('/login');
              }}
            >
              Sign out
            </button>
          ) : (
            <Link className="btn" href="/dashboard">
              Cancel
            </Link>
          )}
        </div>
      </form>
    </main>
  );
}
