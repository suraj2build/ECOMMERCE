'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ActionMessage, Notice, SelectField, TextArea, TextField } from '@/components/ui';
import { apiSend } from '@/lib/api';
import { useAction } from '@/lib/session';
import { ASSORTMENT_NOTE, COPY_FIELDS, profileFor } from '@/lib/product-profiles';
import type { ReferenceData, StyleDetail } from './types';

type Form = Record<string, string>;

const REQUIRED: Array<[string, string]> = [
  ['name', 'Product name'],
  ['brandId', 'Brand'],
  ['categoryId', 'Category'],
  ['season', 'Season'],
  ['collection', 'Collection'],
];

/** The form values for an existing product (custom attributes flattened; details as lines). */
export function formFromStyle(style: StyleDetail): Form {
  const attrs = (style.customAttributes ?? {}) as Record<string, unknown>;
  const form: Form = {
    styleCode: style.styleCode,
    name: style.name,
    brandId: style.brandId,
    categoryId: style.categoryId,
    season: style.season,
    collection: style.collection,
    gender: style.gender ?? '',
    hsnCode: style.hsnCode ?? '',
    countryOfOrigin: style.countryOfOrigin ?? '',
  };
  for (const key of ['fabric', 'fit', 'pattern', 'occasion', 'sleeve', 'neck', 'washCare'] as const) form[key] = style[key] ?? '';
  for (const [key, value] of Object.entries(attrs)) {
    if (key === 'details' && Array.isArray(value)) form.details = value.join('\n');
    else if (typeof value === 'string') form[key] = value;
  }
  return form;
}

export function validateBasics(form: Form, isNew: boolean): Record<string, string> {
  const errors: Record<string, string> = {};
  if (isNew) {
    if (!form.styleCode?.trim()) errors.styleCode = 'Give the product a style code. It is its permanent identifier (used on labels and in imports).';
    else if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(form.styleCode.trim())) errors.styleCode = 'Use letters, digits, - and _ only.';
  }
  for (const [key, label] of REQUIRED) if (!form[key]?.trim()) errors[key] = `${label} is required.`;
  if (form.hsnCode?.trim() && !/^\d{2,8}$/.test(form.hsnCode.trim())) errors.hsnCode = 'Digits only (2 to 8).';
  return errors;
}

/** Turns the form into the API body. On edit, a cleared optional field is sent as null (cleared on purpose). */
export function bodyFromForm(form: Form, productType: string, isNew: boolean, original?: Form) {
  const profile = profileFor(productType);
  const body: Record<string, unknown> = {};
  const columns = ['name', 'brandId', 'categoryId', 'season', 'collection', 'gender', 'hsnCode', 'countryOfOrigin', ...profile.attributes.filter((a) => a.storage === 'column').map((a) => a.key)];
  for (const key of columns) {
    const value = (form[key] ?? '').trim();
    if (isNew) {
      if (value) body[key] = value;
    } else if (value !== (original?.[key] ?? '').trim()) {
      body[key] = value === '' ? null : value;
    }
  }
  const custom: Record<string, unknown> = { productType: productType.toLowerCase() };
  for (const field of [...profile.attributes.filter((a) => a.storage === 'custom'), ...COPY_FIELDS]) {
    const raw = (form[field.key] ?? '').trim();
    const value = field.key === 'details' ? raw.split('\n').map((l) => l.trim()).filter(Boolean) : raw;
    const empty = Array.isArray(value) ? value.length === 0 : value === '';
    if (isNew) {
      if (!empty) custom[field.key] = value;
    } else if (raw !== (original?.[field.key] ?? '').trim()) {
      custom[field.key] = empty ? null : value;
    }
  }
  body.customAttributes = custom;
  if (isNew) body.styleCode = form.styleCode!.trim().toUpperCase();
  return body;
}

/**
 * Basics: name, brand, category (which decides the attributes offered),
 * department and the category-specific attributes and copy. Errors keep
 * every value the owner typed.
 */
export function BasicsForm({
  reference,
  initial,
  styleId,
  isNew,
  submitLabel,
  onSaved,
  onDraftChange,
}: {
  reference: ReferenceData;
  initial: Form;
  styleId?: string;
  isNew: boolean;
  submitLabel: string;
  onSaved: (result: { id: string }) => void;
  onDraftChange?: (form: Form) => void;
}) {
  const [form, setForm] = useState<Form>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const action = useAction();
  const category = reference.categories.find((c) => c.id === form.categoryId);
  // The category decides the product type (and so the attributes offered).
  const productType = (category?.productType || 'APPAREL').toUpperCase();
  const profile = profileFor(productType);
  const set = (key: string) => (value: string) => setForm((f) => ({ ...f, [key]: value }));

  useEffect(() => {
    onDraftChange?.(form);
  }, [form, onDraftChange]);

  const dirty = useMemo(() => JSON.stringify(form) !== JSON.stringify(initial), [form, initial]);

  // After a save the product reloads; take the server's version of what was
  // saved, while the form stays mounted so its confirmation stays visible.
  const savedRef = useRef(false);
  const initialJson = JSON.stringify(initial);
  const lastInitial = useRef(initialJson);
  useEffect(() => {
    if (initialJson === lastInitial.current) return;
    lastInitial.current = initialJson;
    if (savedRef.current) {
      savedRef.current = false;
      setForm(JSON.parse(initialJson) as Form);
    }
  }, [initialJson]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const found = validateBasics(form, isNew);
    setErrors(found);
    if (Object.keys(found).length > 0) {
      action.clear();
      return;
    }
    let id = '';
    const ok = await action.run(async () => {
      const body = bodyFromForm(form, productType, isNew, initial);
      if (isNew) id = (await apiSend<{ id: string }>('POST', '/products/styles', body)).id;
      else {
        const res = await apiSend<{ style: { id: string } }>('PATCH', `/products/styles/${styleId}`, body);
        id = res.style.id;
      }
    }, isNew ? undefined : 'Saved.');
    if (ok) {
      savedRef.current = true;
      onSaved({ id });
    }
  }

  const err = (key: string) => (errors[key] ? <span className="field-error">{errors[key]}</span> : undefined);
  const dept = form.gender === 'Men' || form.gender === 'Women' ? form.gender : null;

  return (
    <form onSubmit={submit} noValidate aria-label="Product basics">
      <ActionMessage message={action.message} />
      {Object.keys(errors).length > 0 && <Notice kind="error" reveal={errors}>Some details need attention - see the highlighted fields.</Notice>}
      <div className="form-row">
        {isNew ? (
          <TextField label="Style code" required value={form.styleCode ?? ''} onChange={set('styleCode')} hint={err('styleCode') ?? 'Permanent: used on labels, in imports and SKU codes. e.g. MSH-OXF-01'} />
        ) : (
          <div className="field">
            <span className="label">Style code</span>
            <span className="mono">{form.styleCode}</span>
            <span className="hint">Permanent identifier; it cannot be changed.</span>
          </div>
        )}
        <TextField label="Product name" required value={form.name ?? ''} onChange={set('name')} hint={err('name')} />
      </div>
      <div className="form-row">
        <SelectField
          label="Category"
          required
          value={form.categoryId ?? ''}
          onChange={set('categoryId')}
          placeholder="Choose a category"
          options={reference.categories.map((c) => ({ value: c.id, label: `${c.name}${c.productType !== 'APPAREL' ? ` (${profileFor(c.productType).label.toLowerCase()})` : ''}` }))}
          hint={err('categoryId') ?? (category ? `${profile.label}: the next steps ask for ${profile.colourLabel.toLowerCase()} and ${profile.sizeLabel.toLowerCase()}.` : undefined)}
        />
        <SelectField
          label="Department"
          value={form.gender ?? ''}
          onChange={set('gender')}
          placeholder="Choose Men or Women"
          options={[
            { value: 'Men', label: 'Men' },
            { value: 'Women', label: 'Women' },
          ]}
          hint={dept ? ASSORTMENT_NOTE[dept] : 'Decides which department shows the product.'}
        />
        <SelectField
          label="Brand"
          required
          value={form.brandId ?? ''}
          onChange={set('brandId')}
          placeholder="Choose a brand"
          options={reference.brands.map((b) => ({ value: b.id, label: b.name }))}
          hint={err('brandId')}
        />
      </div>
      <div className="form-row">
        <TextField label="Season" required value={form.season ?? ''} onChange={set('season')} placeholder="e.g. SS26" hint={err('season')} />
        <TextField label="Collection" required value={form.collection ?? ''} onChange={set('collection')} placeholder="e.g. Core, Workday" hint={err('collection')} />
        <TextField label="HSN code" value={form.hsnCode ?? ''} onChange={set('hsnCode')} hint={err('hsnCode') ?? 'From your tax adviser; printed on invoices.'} />
      </div>

      <fieldset className="fieldset">
        <legend>{profile.label} details</legend>
        <div className="form-row">
          {profile.attributes.map((a) =>
            a.multiline ? (
              <TextArea key={a.key} label={a.label} value={form[a.key] ?? ''} onChange={set(a.key)} hint={a.hint} />
            ) : (
              <TextField key={a.key} label={a.label} value={form[a.key] ?? ''} onChange={set(a.key)} hint={a.hint} />
            ),
          )}
          <TextField label="Country of origin" value={form.countryOfOrigin ?? ''} onChange={set('countryOfOrigin')} />
        </div>
      </fieldset>

      <fieldset className="fieldset">
        <legend>What shoppers read</legend>
        <div className="form-row">
          {COPY_FIELDS.map((a) =>
            a.multiline ? (
              <TextArea key={a.key} label={a.label} value={form[a.key] ?? ''} onChange={set(a.key)} hint={a.hint} />
            ) : (
              <TextField key={a.key} label={a.label} value={form[a.key] ?? ''} onChange={set(a.key)} hint={a.hint} />
            ),
          )}
        </div>
      </fieldset>

      <div className="row">
        <button className="primary" type="submit" disabled={action.busy || (!isNew && !dirty)}>
          {action.busy ? 'Saving…' : submitLabel}
        </button>
        {!isNew && !dirty && <span className="muted">No unsaved changes.</span>}
      </div>
    </form>
  );
}
