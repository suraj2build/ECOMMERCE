'use client';

import { useEffect, useState } from 'react';
import { buttonClassName } from '@/components/ui/Button';
import {
  listSavedSizes,
  saveSize,
  removeSavedSize,
  listCategoryOptions,
  listSizeOptions,
  type SavedSize,
  type CategoryOption,
  type SizeOption,
} from '@/lib/account';

export default function MySizesPage() {
  const [saved, setSaved] = useState<SavedSize[] | null>(null);
  const [categories, setCategories] = useState<CategoryOption[]>([]);
  const [sizes, setSizes] = useState<SizeOption[]>([]);
  const [categoryId, setCategoryId] = useState('');
  const [sizeId, setSizeId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function refresh() {
    listSavedSizes()
      .then(setSaved)
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not load your saved sizes.'));
  }

  useEffect(() => {
    refresh();
    listCategoryOptions()
      .then(setCategories)
      .catch(() => setCategories([]));
    listSizeOptions()
      .then(setSizes)
      .catch(() => setSizes([]));
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!categoryId || !sizeId) return;
    setBusy(true);
    setError(null);
    try {
      await saveSize(categoryId, sizeId);
      setCategoryId('');
      setSizeId('');
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save this size.');
    } finally {
      setBusy(false);
    }
  }

  async function handleRemove(id: string) {
    setError(null);
    try {
      await removeSavedSize(id);
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not remove this size.');
    }
  }

  return (
    <section>
      <h2 className="font-display text-lg text-ink">My Sizes</h2>
      <p className="mt-1 text-sm text-ink-muted">Save a preferred size per category - one size per category.</p>

      {error && (
        <p role="alert" className="mt-2 text-sm text-danger">
          {error}
        </p>
      )}

      <form onSubmit={handleSubmit} className="mt-4 flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor="size-category" className="text-sm text-ink">
            Category
          </label>
          <select
            id="size-category"
            required
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            className="mt-1 block min-h-[44px] rounded-sm border border-border px-3 text-sm text-ink"
          >
            <option value="">Select a category</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="size-size" className="text-sm text-ink">
            Size
          </label>
          <select
            id="size-size"
            required
            value={sizeId}
            onChange={(e) => setSizeId(e.target.value)}
            className="mt-1 block min-h-[44px] rounded-sm border border-border px-3 text-sm text-ink"
          >
            <option value="">Select a size</option>
            {sizes.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
        <button type="submit" disabled={busy} className={buttonClassName('primary')}>
          {busy ? 'Saving...' : 'Save size'}
        </button>
      </form>

      {saved === null && !error && <p className="mt-6 text-sm text-ink-muted">Loading...</p>}
      {saved !== null && saved.length === 0 && <p className="mt-6 text-sm text-ink-muted">You have no saved sizes yet.</p>}

      {saved && saved.length > 0 && (
        <ul className="mt-6 space-y-2">
          {saved.map((s) => (
            <li key={s.id} className="flex items-center justify-between rounded-sm border border-border p-3">
              <span className="text-sm text-ink">
                {s.categoryName}: <span className="font-medium">{s.sizeLabel}</span>
              </span>
              <button type="button" onClick={() => handleRemove(s.id)} className={buttonClassName('ghost')}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
