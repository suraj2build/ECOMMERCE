'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { MfaRequiredError, staffLogin } from '@/lib/staff-auth';

/**
 * Staff sign-in. Accounts with confirmed MFA (AUTH-002) get a second
 * step: the server answers MFA_REQUIRED and the same credentials are
 * resubmitted with the authenticator code. The console never bypasses
 * or caches the code.
 */
export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mfaCode, setMfaCode] = useState('');
  const [needsMfa, setNeedsMfa] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const session = await staffLogin(email, password, needsMfa ? mfaCode : undefined);
      router.replace(session.mustChangePassword ? '/change-password' : '/dashboard');
    } catch (err) {
      if (err instanceof MfaRequiredError) {
        setNeedsMfa(true);
      } else {
        setError(err instanceof Error ? err.message : 'Sign in failed.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main style={{ maxWidth: 380, margin: '4rem auto', padding: '0 1rem' }}>
      <h1 style={{ fontSize: '1.25rem', marginBottom: '1.5rem' }}>Staff sign in</h1>
      <form onSubmit={onSubmit} className="card">
        {error && (
          <p className="error-banner" role="alert">
            {error}
          </p>
        )}
        <div className="field">
          <label htmlFor="email">Email</label>
          <input id="email" type="email" autoComplete="username" required value={email} readOnly={needsMfa} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            readOnly={needsMfa}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        {needsMfa && (
          <div className="field">
            <label htmlFor="mfaCode">Authenticator code</label>
            <input
              id="mfaCode"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              maxLength={6}
              required
              aria-describedby="mfa-hint"
              value={mfaCode}
              onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, ''))}
            />
            <span id="mfa-hint" className="hint" role="status">
              This account uses two-factor authentication. Enter the 6-digit code from your authenticator app.
            </span>
          </div>
        )}
        <div className="row">
          <button className="primary" type="submit" disabled={submitting}>
            {submitting ? 'Signing in...' : needsMfa ? 'Verify and sign in' : 'Sign in'}
          </button>
          {needsMfa && (
            <button
              type="button"
              className="btn"
              onClick={() => {
                setNeedsMfa(false);
                setMfaCode('');
                setPassword('');
              }}
            >
              Start over
            </button>
          )}
        </div>
      </form>
    </main>
  );
}
