'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ActionMessage, PageHeader, SelectField, TextField } from '@/components/ui';
import { apiSend } from '@/lib/api';
import { useAction, useApi } from '@/lib/session';

const OPTIONAL_ATTRIBUTES: Array<[key: string, label: string]> = [
  ['department', 'Department'],
  ['gender', 'Gender'],
  ['division', 'Division'],
  ['subcategory', 'Subcategory'],
  ['fabric', 'Fabric'],
  ['fit', 'Fit'],
  ['pattern', 'Pattern'],
  ['occasion', 'Occasion'],
  ['sleeve', 'Sleeve'],
  ['neck', 'Neck'],
  ['washCare', 'Wash care'],
  ['countryOfOrigin', 'Country of origin'],
  ['hsnCode', 'HSN code'],
];

/** POST /products/styles. The server validates required fields and uniqueness; the new style starts in DRAFT. */
export default function NewStylePage() {
  const router = useRouter();
  const brands = useApi<Array<{ id: string; code: string; name: string }>>('/organization/brands');
  const categories = useApi<Array<{ id: string; name: string }>>('/storefront/categories');
  const [form, setForm] = useState<Record<string, string>>({ styleCode: '', name: '', brandId: '', categoryId: '', season: '', collection: '' });
  const action = useAction();
  const set = (k: string) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const body = Object.fromEntries(Object.entries(form).filter(([, v]) => v.trim() !== ''));
    let createdId = '';
    const ok = await action.run(async () => {
      createdId = (await apiSend<{ id: string }>('POST', '/products/styles', body)).id;
    });
    if (ok) router.push(`/dashboard/products/${createdId}?created=1`);
  }

  return (
    <div style={{ maxWidth: 820 }}>
      <PageHeader
        title="New style"
        description="Season and collection are required. Colours, SKUs, media and pricing are added on the style's workbench."
        breadcrumbs={[{ label: 'Merchandise' }, { label: 'Products', href: '/dashboard/products' }, { label: 'New style' }]}
      />
      <form className="card" onSubmit={onSubmit}>
        <ActionMessage message={action.message} />
        <div className="form-row">
          <TextField label="Style code" required value={form.styleCode ?? ''} onChange={set('styleCode')} />
          <TextField label="Name" required value={form.name ?? ''} onChange={set('name')} />
        </div>
        <div className="form-row">
          <SelectField
            label="Brand"
            required
            value={form.brandId ?? ''}
            onChange={set('brandId')}
            placeholder={brands.data ? 'Choose a brand' : 'Loading…'}
            options={(brands.data ?? []).map((b) => ({ value: b.id, label: `${b.name} (${b.code})` }))}
          />
          <SelectField
            label="Category"
            required
            value={form.categoryId ?? ''}
            onChange={set('categoryId')}
            placeholder={categories.data ? 'Choose a category' : 'Loading…'}
            options={(categories.data ?? []).map((c) => ({ value: c.id, label: c.name }))}
          />
        </div>
        <div className="form-row">
          <TextField label="Season" required value={form.season ?? ''} onChange={set('season')} placeholder="e.g. SS26" />
          <TextField label="Collection" required value={form.collection ?? ''} onChange={set('collection')} placeholder="e.g. Core" />
        </div>
        <details style={{ marginBottom: '0.75rem' }}>
          <summary>Optional attributes</summary>
          <div className="form-row" style={{ marginTop: '0.75rem' }}>
            {OPTIONAL_ATTRIBUTES.map(([k, label]) => (
              <TextField key={k} label={label} value={form[k] ?? ''} onChange={set(k)} />
            ))}
          </div>
        </details>
        <button className="primary" type="submit" disabled={action.busy}>
          {action.busy ? 'Creating…' : 'Create style'}
        </button>
      </form>
    </div>
  );
}
