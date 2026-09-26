'use client';

import { useEffect, useState } from 'react';
import { buttonClassName } from '@/components/ui/Button';
import { getProfile, updateProfile, type CustomerProfile } from '@/lib/account';

export default function AccountProfilePage() {
  const [profile, setProfile] = useState<CustomerProfile | null>(null);
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    getProfile()
      .then((p) => {
        setProfile(p);
        setFullName(p.fullName ?? '');
        setEmail(p.email ?? '');
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not load your profile.'));
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    setSaving(true);
    try {
      const updated = await updateProfile({ fullName: fullName || undefined, email: email || undefined });
      setProfile(updated);
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save your profile.');
    } finally {
      setSaving(false);
    }
  }

  if (!profile && !error) return <p className="text-sm text-ink-muted">Loading...</p>;

  return (
    <section>
      <h2 className="font-display text-lg text-ink">Profile</h2>

      {error && (
        <p role="alert" className="mt-2 text-sm text-danger">
          {error}
        </p>
      )}

      {profile && (
        <form onSubmit={handleSubmit} className="mt-4 max-w-md space-y-4">
          <div>
            <span className="text-sm text-ink">Mobile number</span>
            <p className="mt-1 text-sm text-ink-muted">{profile.mobile} (verified, cannot be changed here)</p>
          </div>
          <div>
            <label htmlFor="profile-name" className="text-sm text-ink">
              Full name
            </label>
            <input
              id="profile-name"
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="mt-1 block min-h-[44px] w-full rounded-sm border border-border px-3 text-sm text-ink"
            />
          </div>
          <div>
            <label htmlFor="profile-email" className="text-sm text-ink">
              Email
            </label>
            <input
              id="profile-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 block min-h-[44px] w-full rounded-sm border border-border px-3 text-sm text-ink"
            />
          </div>
          <button type="submit" disabled={saving} className={buttonClassName('primary')}>
            {saving ? 'Saving...' : 'Save changes'}
          </button>
          {saved && (
            <p role="status" className="text-sm text-ink-muted">
              Saved.
            </p>
          )}
        </form>
      )}
    </section>
  );
}
