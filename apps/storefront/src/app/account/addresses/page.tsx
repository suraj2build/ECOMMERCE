'use client';

import { useEffect, useState } from 'react';
import { buttonClassName } from '@/components/ui/Button';
import {
  listAddresses,
  createAddress,
  updateAddress,
  setDefaultAddress,
  deleteAddress,
  type CustomerAddress,
  type AddressInput,
} from '@/lib/account';

const EMPTY_FORM: AddressInput = {
  label: '',
  recipientName: '',
  recipientMobile: '',
  line1: '',
  line2: '',
  landmark: '',
  city: '',
  state: '',
  stateCode: '',
  pincode: '',
};

export default function AddressesPage() {
  const [addresses, setAddresses] = useState<CustomerAddress[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | 'new' | null>(null);
  const [form, setForm] = useState<AddressInput>(EMPTY_FORM);
  const [busy, setBusy] = useState(false);

  function refresh() {
    listAddresses()
      .then(setAddresses)
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not load your addresses.'));
  }

  useEffect(refresh, []);

  function startCreate() {
    setForm(EMPTY_FORM);
    setEditingId('new');
    setError(null);
  }

  function startEdit(address: CustomerAddress) {
    setForm({
      label: address.label ?? '',
      recipientName: address.recipientName,
      recipientMobile: address.recipientMobile,
      line1: address.line1,
      line2: address.line2 ?? '',
      landmark: address.landmark ?? '',
      city: address.city,
      state: address.state,
      stateCode: address.stateCode,
      pincode: address.pincode,
    });
    setEditingId(address.id);
    setError(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (editingId === 'new') {
        await createAddress(form);
      } else if (editingId) {
        await updateAddress(editingId, form);
      }
      setEditingId(null);
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save this address.');
    } finally {
      setBusy(false);
    }
  }

  async function handleSetDefault(id: string) {
    setError(null);
    try {
      await setDefaultAddress(id);
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not set this address as default.');
    }
  }

  async function handleDelete(id: string) {
    setError(null);
    try {
      await deleteAddress(id);
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete this address.');
    }
  }

  return (
    <section>
      <div className="flex items-center justify-between">
        <h2 className="font-display text-lg text-ink">Addresses</h2>
        {editingId === null && (
          <button type="button" onClick={startCreate} className={buttonClassName('secondary')}>
            Add address
          </button>
        )}
      </div>

      {error && (
        <p role="alert" className="mt-2 text-sm text-danger">
          {error}
        </p>
      )}

      {editingId !== null && (
        <form onSubmit={handleSubmit} className="mt-4 max-w-md space-y-3 rounded-sm border border-border p-4">
          <div>
            <label htmlFor="addr-label" className="text-sm text-ink">
              Label (optional)
            </label>
            <input
              id="addr-label"
              value={form.label}
              onChange={(e) => setForm({ ...form, label: e.target.value })}
              className="mt-1 block min-h-[44px] w-full rounded-sm border border-border px-3 text-sm text-ink"
              placeholder="Home, Work..."
            />
          </div>
          <div>
            <label htmlFor="addr-recipient" className="text-sm text-ink">
              Recipient name
            </label>
            <input
              id="addr-recipient"
              required
              value={form.recipientName}
              onChange={(e) => setForm({ ...form, recipientName: e.target.value })}
              className="mt-1 block min-h-[44px] w-full rounded-sm border border-border px-3 text-sm text-ink"
            />
          </div>
          <div>
            <label htmlFor="addr-mobile" className="text-sm text-ink">
              Recipient mobile
            </label>
            <input
              id="addr-mobile"
              required
              type="tel"
              value={form.recipientMobile}
              onChange={(e) => setForm({ ...form, recipientMobile: e.target.value })}
              className="mt-1 block min-h-[44px] w-full rounded-sm border border-border px-3 text-sm text-ink"
            />
          </div>
          <div>
            <label htmlFor="addr-line1" className="text-sm text-ink">
              Address line 1
            </label>
            <input
              id="addr-line1"
              required
              value={form.line1}
              onChange={(e) => setForm({ ...form, line1: e.target.value })}
              className="mt-1 block min-h-[44px] w-full rounded-sm border border-border px-3 text-sm text-ink"
            />
          </div>
          <div>
            <label htmlFor="addr-line2" className="text-sm text-ink">
              Address line 2 (optional)
            </label>
            <input
              id="addr-line2"
              value={form.line2}
              onChange={(e) => setForm({ ...form, line2: e.target.value })}
              className="mt-1 block min-h-[44px] w-full rounded-sm border border-border px-3 text-sm text-ink"
            />
          </div>
          <div>
            <label htmlFor="addr-landmark" className="text-sm text-ink">
              Landmark (optional)
            </label>
            <input
              id="addr-landmark"
              value={form.landmark}
              onChange={(e) => setForm({ ...form, landmark: e.target.value })}
              className="mt-1 block min-h-[44px] w-full rounded-sm border border-border px-3 text-sm text-ink"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="addr-city" className="text-sm text-ink">
                City
              </label>
              <input
                id="addr-city"
                required
                value={form.city}
                onChange={(e) => setForm({ ...form, city: e.target.value })}
                className="mt-1 block min-h-[44px] w-full rounded-sm border border-border px-3 text-sm text-ink"
              />
            </div>
            <div>
              <label htmlFor="addr-pincode" className="text-sm text-ink">
                PIN code
              </label>
              <input
                id="addr-pincode"
                required
                value={form.pincode}
                onChange={(e) => setForm({ ...form, pincode: e.target.value })}
                className="mt-1 block min-h-[44px] w-full rounded-sm border border-border px-3 text-sm text-ink"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="addr-state" className="text-sm text-ink">
                State
              </label>
              <input
                id="addr-state"
                required
                value={form.state}
                onChange={(e) => setForm({ ...form, state: e.target.value })}
                className="mt-1 block min-h-[44px] w-full rounded-sm border border-border px-3 text-sm text-ink"
              />
            </div>
            <div>
              <label htmlFor="addr-state-code" className="text-sm text-ink">
                State code
              </label>
              <input
                id="addr-state-code"
                required
                maxLength={4}
                value={form.stateCode}
                onChange={(e) => setForm({ ...form, stateCode: e.target.value.toUpperCase() })}
                className="mt-1 block min-h-[44px] w-full rounded-sm border border-border px-3 text-sm text-ink"
              />
            </div>
          </div>
          <div className="flex gap-2">
            <button type="submit" disabled={busy} className={buttonClassName('primary')}>
              {busy ? 'Saving...' : 'Save address'}
            </button>
            <button type="button" onClick={() => setEditingId(null)} className={buttonClassName('ghost')}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {addresses === null && !error && <p className="mt-6 text-sm text-ink-muted">Loading...</p>}

      {addresses !== null && addresses.length === 0 && editingId === null && (
        <p className="mt-6 text-sm text-ink-muted">You have no saved addresses yet.</p>
      )}

      {addresses && addresses.length > 0 && (
        <ul className="mt-6 space-y-4">
          {addresses.map((address) => (
            <li key={address.id} className="rounded-sm border border-border p-4">
              <div className="flex items-start justify-between">
                <div>
                  {address.label && <p className="text-sm font-medium text-ink">{address.label}</p>}
                  <p className="text-sm text-ink">{address.recipientName}</p>
                  <p className="text-sm text-ink-muted">
                    {address.line1}
                    {address.line2 ? `, ${address.line2}` : ''}
                    {address.landmark ? `, ${address.landmark}` : ''}
                  </p>
                  <p className="text-sm text-ink-muted">
                    {address.city}, {address.state} {address.pincode}
                  </p>
                  <p className="text-sm text-ink-muted">{address.recipientMobile}</p>
                </div>
                {address.isDefault && <span className="rounded-sm bg-surface px-2 py-1 text-xs text-ink">Default</span>}
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" onClick={() => startEdit(address)} className={buttonClassName('ghost')}>
                  Edit
                </button>
                {!address.isDefault && (
                  <button type="button" onClick={() => handleSetDefault(address.id)} className={buttonClassName('ghost')}>
                    Set as default
                  </button>
                )}
                <button type="button" onClick={() => handleDelete(address.id)} className={buttonClassName('ghost')}>
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
