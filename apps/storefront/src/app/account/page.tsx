'use client';

import { useEffect, useState } from 'react';
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
      .then((next) => { setProfile(next); setFullName(next.fullName ?? ''); setEmail(next.email ?? ''); })
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not load your profile.'));
  }, []);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSaved(false);
    setSaving(true);
    try {
      setProfile(await updateProfile({ fullName: fullName || undefined, email: email || undefined }));
      setSaved(true);
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not save your profile.'); }
    finally { setSaving(false); }
  }

  if (!profile && !error) return <p className="text-sm text-[#6e6359]">Loading profile…</p>;

  return (
    <section>
      <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--color-primary)]">Your account</p>
      <h2 className="mt-1 font-display text-3xl text-[#181716]">Profile</h2>
      {error ? <p role="alert" className="mt-3 text-sm text-danger">{error}</p> : null}
      {profile ? (
        <form onSubmit={handleSubmit} className="mt-6 max-w-xl space-y-5">
          <div className="rounded-[16px] bg-[var(--color-surface-soft)] p-4">
            <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#6e6359]">Verified mobile</span>
            <p className="mt-1 text-sm font-medium text-[#181716]">{profile.mobile}</p>
          </div>
          <label className="block">
            <span className="text-xs font-semibold uppercase tracking-[0.10em] text-[#5f554c]">Full name</span>
            <input id="profile-name" type="text" value={fullName} onChange={(event) => setFullName(event.target.value)} className="mt-2 block min-h-[48px] w-full rounded-[14px] border border-[#d8d0c6] bg-[#faf8f5] px-4 text-sm text-[#181716] outline-none focus:border-[#181716]" />
          </label>
          <label className="block">
            <span className="text-xs font-semibold uppercase tracking-[0.10em] text-[#5f554c]">Email</span>
            <input id="profile-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} className="mt-2 block min-h-[48px] w-full rounded-[14px] border border-[#d8d0c6] bg-[#faf8f5] px-4 text-sm text-[#181716] outline-none focus:border-[#181716]" />
          </label>
          <button type="submit" disabled={saving} className="min-h-[48px] rounded-full bg-[var(--color-primary)] px-7 text-xs font-semibold uppercase tracking-[0.14em] text-white disabled:opacity-50">{saving ? 'Saving…' : 'Save changes'}</button>
          {saved ? <p role="status" className="text-sm text-[#5f554c]">Saved.</p> : null}
        </form>
      ) : null}
    </section>
  );
}
