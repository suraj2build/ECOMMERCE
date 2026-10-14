'use client';

import { useMemo, useState } from 'react';
import { ActionMessage, Can, Checkbox, ConfirmDialog, DataTable, Ident, Notice, Section, SelectField, TextField, YesNo } from '@/components/ui';
import { apiSend } from '@/lib/api';
import { useAction } from '@/lib/session';
import { profileFor } from '@/lib/product-profiles';
import type { StepProps } from './types';

/**
 * Colours & sizes. Colours (or scents, for perfume) and sizes (or shoe sizes,
 * belt sizes, volumes) create one SKU per combination. Existing SKUs are
 * never removed: a size that is no longer sold is turned off.
 */
export function VariantsStep({ style, readiness, reference, onChanged }: StepProps) {
  const profile = profileFor(readiness?.productType ?? style.category.productType);
  return (
    <div className="stack">
      <Colours style={style} colourLabel={profile.colourLabel} colourHint={profile.colourHint} onChanged={onChanged} />
      <Sizes style={style} reference={reference} readinessType={readiness?.productType ?? style.category.productType} onChanged={onChanged} />
      <SkuTable style={style} onChanged={onChanged} />
      {profile.measurements && <Measurements style={style} reference={reference} onChanged={onChanged} />}
    </div>
  );
}

function Colours({ style, colourLabel, colourHint, onChanged }: { style: StepProps['style']; colourLabel: string; colourHint: string; onChanged: () => void }) {
  const add = useAction();
  const edit = useAction();
  const [form, setForm] = useState({ name: '', colourCode: '', hexSwatch: '' });
  const [editing, setEditing] = useState<{ id: string; name: string; hexSwatch: string } | null>(null);
  const [removing, setRemoving] = useState<{ id: string; name: string } | null>(null);
  const suggestedCode = form.name.toUpperCase().replace(/[^A-Z0-9]+/g, '').slice(0, 6);

  return (
    <Section title={`${colourLabel}s`}>
      <p className="muted" style={{ marginTop: 0 }}>{colourHint}</p>
      <ActionMessage message={edit.message} />
      <DataTable
        caption={`${colourLabel}s`}
        rows={style.colours}
        rowKey={(c) => c.id}
        empty={`No ${colourLabel.toLowerCase()}s yet.`}
        columns={[
          {
            header: colourLabel,
            cell: (c) => (
              <span className="row">
                {c.hexSwatch && <span className="swatch" style={{ background: c.hexSwatch }} aria-hidden />}
                {c.name}
              </span>
            ),
          },
          { header: 'Code', cell: (c) => <Ident>{c.colourCode}</Ident> },
          { header: 'Sizes', numeric: true, cell: (c) => style.skus.filter((s) => s.colourId === c.id).length },
          {
            header: 'Actions',
            cell: (c) => (
              <Can anyOf={['product:write']}>
                <span className="row">
                  <button type="button" className="btn small" onClick={() => setEditing({ id: c.id, name: c.name, hexSwatch: c.hexSwatch ?? '' })}>
                    Rename
                  </button>
                  {style.skus.every((s) => s.colourId !== c.id) && (
                    <button type="button" className="btn small danger" onClick={() => setRemoving({ id: c.id, name: c.name })}>
                      Remove
                    </button>
                  )}
                </span>
              </Can>
            ),
          },
        ]}
      />
      {editing && (
        <form
          className="inline-form"
          onSubmit={async (e) => {
            e.preventDefault();
            const ok = await edit.run(() => apiSend('PATCH', `/products/colours/${editing.id}`, { name: editing.name, hexSwatch: editing.hexSwatch || null }), 'Saved.');
            if (ok) {
              setEditing(null);
              onChanged();
            }
          }}
        >
          <TextField label={`${colourLabel} name`} required value={editing.name} onChange={(v) => setEditing({ ...editing, name: v })} />
          <TextField label="Swatch" value={editing.hexSwatch} placeholder="#1A2B3C" onChange={(v) => setEditing({ ...editing, hexSwatch: v })} />
          <button className="primary" type="submit" disabled={edit.busy}>
            Save
          </button>
          <button type="button" className="btn" onClick={() => setEditing(null)}>
            Cancel
          </button>
        </form>
      )}
      <ConfirmDialog
        open={removing !== null}
        title={`Remove ${removing?.name ?? ''}?`}
        confirmLabel="Remove"
        danger
        busy={edit.busy}
        onCancel={() => setRemoving(null)}
        onConfirm={async () => {
          const ok = await edit.run(() => apiSend('DELETE', `/products/colours/${removing!.id}`), `${removing!.name} removed.`);
          setRemoving(null);
          if (ok) onChanged();
        }}
      >
        <p>It has no sizes yet. A {colourLabel.toLowerCase()} with sizes, prices or photos cannot be removed; turn its sizes off instead.</p>
      </ConfirmDialog>
      <Can anyOf={['product:write']}>
        <form
          className="inline-form"
          onSubmit={async (e) => {
            e.preventDefault();
            const ok = await add.run(
              () =>
                apiSend('POST', `/products/styles/${style.id}/colours`, {
                  name: form.name.trim(),
                  colourCode: (form.colourCode || suggestedCode).toUpperCase(),
                  ...(form.hexSwatch ? { hexSwatch: form.hexSwatch } : {}),
                }),
              `${form.name} added.`,
            );
            if (ok) {
              setForm({ name: '', colourCode: '', hexSwatch: '' });
              onChanged();
            }
          }}
        >
          <TextField label={`New ${colourLabel.toLowerCase()}`} required value={form.name} onChange={(v) => setForm((f) => ({ ...f, name: v }))} />
          <TextField label="Code" value={form.colourCode} placeholder={suggestedCode || 'e.g. BLK'} onChange={(v) => setForm((f) => ({ ...f, colourCode: v }))} hint="Used in SKU codes; cannot change later." />
          <TextField label="Swatch" value={form.hexSwatch} placeholder="#1A2B3C" onChange={(v) => setForm((f) => ({ ...f, hexSwatch: v }))} />
          <button className="primary" type="submit" disabled={add.busy || !form.name.trim()}>
            Add {colourLabel.toLowerCase()}
          </button>
        </form>
        <ActionMessage message={add.message} />
      </Can>
    </Section>
  );
}

function Sizes({ style, reference, readinessType, onChanged }: { style: StepProps['style']; reference: StepProps['reference']; readinessType: string; onChanged: () => void }) {
  const profile = profileFor(readinessType);
  const action = useAction();
  const sizeAction = useAction();
  const [showAll, setShowAll] = useState(false);
  const [chosen, setChosen] = useState<string[]>([]);
  const [newSize, setNewSize] = useState('');
  const existing = new Set(style.skus.map((s) => s.sizeId));
  const visible = useMemo(
    () => reference.sizes.filter((s) => showAll || profile.suggestSize(s.label) || existing.has(s.id)),
    [reference.sizes, showAll, profile, existing],
  );
  const missingCombos = style.colours.length * chosen.length;

  return (
    <Section title={`${profile.sizeLabel}s you sell`}>
      <p className="muted" style={{ marginTop: 0 }}>
        {profile.sizeHint} Choosing a size creates it for every {profile.colourLabel.toLowerCase()}. Sizes already created are ticked and stay.
      </p>
      {style.colours.length === 0 && <Notice kind="info">Add a {profile.colourLabel.toLowerCase()} first.</Notice>}
      <ActionMessage message={action.message} />
      <fieldset className="fieldset" disabled={style.colours.length === 0}>
        <legend className="sr-only">{profile.sizeLabel}s</legend>
        <div className="size-grid">
          {visible.map((s) => (
            <Checkbox
              key={s.id}
              label={s.label}
              checked={existing.has(s.id) || chosen.includes(s.id)}
              onChange={(on) => {
                if (existing.has(s.id)) return;
                setChosen((c) => (on ? [...c, s.id] : c.filter((x) => x !== s.id)));
              }}
            />
          ))}
        </div>
        <div className="row" style={{ marginTop: '0.5rem' }}>
          <button type="button" className="link-button" onClick={() => setShowAll((v) => !v)}>
            {showAll ? `Show only ${profile.label.toLowerCase()} sizes` : 'Show all sizes'}
          </button>
        </div>
      </fieldset>
      <Can anyOf={['product:write']}>
        <button
          type="button"
          className="primary"
          disabled={action.busy || chosen.length === 0}
          onClick={async () => {
            const ok = await action.run(() => apiSend('POST', `/products/styles/${style.id}/skus/generate`, { sizeIds: chosen }), `Added ${missingCombos} size${missingCombos === 1 ? '' : 's'}.`);
            if (ok) {
              setChosen([]);
              onChanged();
            }
          }}
        >
          {chosen.length === 0 ? 'Tick sizes to add' : `Add ${chosen.length} size${chosen.length === 1 ? '' : 's'} (${missingCombos} SKU${missingCombos === 1 ? '' : 's'})`}
        </button>
      </Can>
      <Can anyOf={['product:taxonomy:manage']}>
        <form
          className="inline-form"
          onSubmit={async (e) => {
            e.preventDefault();
            const ok = await sizeAction.run(() => apiSend('POST', '/products/sizes', { label: newSize }), `${newSize} added to the size list.`);
            if (ok) {
              setNewSize('');
              setShowAll(true);
              onChanged();
            }
          }}
        >
          <TextField label="Size not listed?" value={newSize} placeholder={profile.sizeLabel === 'Volume' ? 'e.g. 75ml' : 'e.g. UK12'} onChange={setNewSize} />
          <button type="submit" className="btn" disabled={sizeAction.busy || !newSize.trim()}>
            Add to size list
          </button>
        </form>
        <ActionMessage message={sizeAction.message} />
      </Can>
    </Section>
  );
}

function SkuTable({ style, onChanged }: { style: StepProps['style']; onChanged: () => void }) {
  const action = useAction();
  const [barcodes, setBarcodes] = useState<Record<string, string>>({});
  const rows = [...style.skus].sort((a, b) => a.colour.name.localeCompare(b.colour.name) || a.size.sortOrder - b.size.sortOrder);
  return (
    <Section title="SKUs">
      <p className="muted" style={{ marginTop: 0 }}>
        Each SKU is one {`colour`}-and-size combination. Barcodes are scanned at receiving and packing. Stock is not set here: it comes from{' '}
        <a href="/dashboard/receiving">receiving goods</a>; see <a href={`/dashboard/inventory?q=${encodeURIComponent(style.styleCode)}`}>stock for this product</a>.
      </p>
      <ActionMessage message={action.message} />
      <DataTable
        caption="SKUs"
        rows={rows}
        rowKey={(r) => r.id}
        empty="No SKUs yet - add colours and sizes above."
        columns={[
          { header: 'SKU', cell: (r) => <Ident>{r.skuCode}</Ident> },
          { header: 'Colour', cell: (r) => r.colour.name },
          { header: 'Size', cell: (r) => r.size.label },
          {
            header: 'Barcode',
            cell: (r) => (
              <form
                className="row"
                onSubmit={async (e) => {
                  e.preventDefault();
                  const value = barcodes[r.id] ?? r.barcode ?? '';
                  const ok = await action.run(() => apiSend('PATCH', `/products/skus/${r.id}`, { barcode: value.trim() || null }), `Barcode saved for ${r.skuCode}.`);
                  if (ok) onChanged();
                }}
              >
                <label className="sr-only" htmlFor={`bc-${r.id}`}>
                  Barcode for {r.skuCode}
                </label>
                <input id={`bc-${r.id}`} className="input compact" value={barcodes[r.id] ?? r.barcode ?? ''} onChange={(e) => setBarcodes((b) => ({ ...b, [r.id]: e.target.value }))} />
                {(barcodes[r.id] ?? r.barcode ?? '') !== (r.barcode ?? '') && (
                  <button type="submit" className="btn small" disabled={action.busy}>
                    Save
                  </button>
                )}
              </form>
            ),
          },
          { header: 'On sale', cell: (r) => <YesNo value={r.isActive} /> },
          {
            header: 'Actions',
            cell: (r) => (
              <Can anyOf={['product:write']}>
                <button
                  type="button"
                  className="btn small"
                  disabled={action.busy}
                  onClick={async () => {
                    const ok = await action.run(() => apiSend('PATCH', `/products/skus/${r.id}`, { isActive: !r.isActive }), r.isActive ? `${r.skuCode} turned off.` : `${r.skuCode} on sale.`);
                    if (ok) onChanged();
                  }}
                >
                  {r.isActive ? 'Turn off' : 'Turn on'}
                </button>
              </Can>
            ),
          },
        ]}
      />
    </Section>
  );
}

function Measurements({ style, reference, onChanged }: { style: StepProps['style']; reference: StepProps['reference']; onChanged: () => void }) {
  const action = useAction();
  const current = style.skus.find((s) => s.sizeChartId)?.sizeChartId ?? '';
  const [chartId, setChartId] = useState(current);
  const [creating, setCreating] = useState(false);
  const sizeLabels = [...new Map(style.skus.map((s) => [s.size.label, s.size.sortOrder])).entries()].sort((a, b) => a[1] - b[1]).map(([l]) => l);
  const [columns, setColumns] = useState('Chest (in), Length (in)');
  const [name, setName] = useState(`${style.name} measurements`);
  const [values, setValues] = useState<Record<string, string>>({});
  const cols = columns.split(',').map((c) => c.trim()).filter(Boolean);

  return (
    <Section title="Measurements (size chart)">
      <p className="muted" style={{ marginTop: 0 }}>Shoppers see these on the size guide. Choose an existing chart or enter measurements for this product.</p>
      <ActionMessage message={action.message} />
      <div className="inline-form">
        <SelectField
          label="Size chart"
          value={chartId}
          onChange={setChartId}
          placeholder="No size chart"
          options={reference.sizeCharts.map((c) => ({ value: c.id, label: `${c.name} (${c.entries.map((e) => e.sizeLabel).join(', ')})` }))}
        />
        <Can anyOf={['product:write']}>
          <button
            type="button"
            className="primary"
            disabled={action.busy || chartId === current || style.skus.length === 0}
            onClick={async () => {
              const ok = await action.run(() => apiSend('POST', `/products/styles/${style.id}/size-chart`, { sizeChartId: chartId || null }), 'Size chart saved.');
              if (ok) onChanged();
            }}
          >
            Use this chart
          </button>
          <button type="button" className="btn" onClick={() => setCreating((v) => !v)} disabled={sizeLabels.length === 0}>
            {creating ? 'Close' : 'Enter measurements'}
          </button>
        </Can>
      </div>
      {creating && (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const ok = await action.run(async () => {
              const chart = await apiSend<{ id: string }>('POST', '/products/size-charts', {
                name,
                gender: style.gender ?? undefined,
                category: style.category.name,
                entries: sizeLabels.map((label) => ({
                  sizeLabel: label,
                  measurements: Object.fromEntries(cols.map((c) => [c, values[`${label}|${c}`] ?? ''])),
                })),
              });
              await apiSend('POST', `/products/styles/${style.id}/size-chart`, { sizeChartId: chart.id });
            }, 'Measurements saved and linked to this product.');
            if (ok) {
              setCreating(false);
              onChanged();
            }
          }}
        >
          <div className="form-row">
            <TextField label="Chart name" required value={name} onChange={setName} />
            <TextField label="Measurements (comma separated)" value={columns} onChange={setColumns} hint="One column per measurement." />
          </div>
          <div className="table-wrap">
            <table>
              <caption className="sr-only">Measurements by size</caption>
              <thead>
                <tr>
                  <th scope="col">Size</th>
                  {cols.map((c) => (
                    <th key={c} scope="col">
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sizeLabels.map((label) => (
                  <tr key={label}>
                    <th scope="row">{label}</th>
                    {cols.map((c) => (
                      <td key={c}>
                        <input
                          className="input compact"
                          aria-label={`${c} for ${label}`}
                          value={values[`${label}|${c}`] ?? ''}
                          onChange={(e) => setValues((v) => ({ ...v, [`${label}|${c}`]: e.target.value }))}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button className="primary" type="submit" disabled={action.busy}>
            Save measurements
          </button>
        </form>
      )}
    </Section>
  );
}
