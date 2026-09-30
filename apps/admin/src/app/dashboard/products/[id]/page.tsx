'use client';

import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  ActionMessage,
  Can,
  Checkbox,
  ConfirmDialog,
  DataState,
  DataTable,
  DateText,
  Ident,
  Money,
  Notice,
  PageHeader,
  Section,
  SelectField,
  StatusBadge,
  Tabs,
  TextField,
  YesNo,
} from '@/components/ui';
import { apiSend } from '@/lib/api';
import { useAction, useApi } from '@/lib/session';

interface Style {
  id: string;
  styleCode: string;
  name: string;
  season: string;
  collection: string;
  department: string | null;
  gender: string | null;
  fabric: string | null;
  fit: string | null;
  hsnCode: string | null;
  lifecycleState: string;
  qaPassedAt: string | null;
  publishedAt: string | null;
  brand: { name: string; code: string };
  category: { name: string };
  colours: Array<{ id: string; name: string; colourCode: string; hexSwatch: string | null }>;
  skus: Array<{ id: string; skuCode: string; isActive: boolean; barcode: string | null; colour: { name: string }; size: { label: string } }>;
  media: Array<{ id: string; url: string; type: string; altText: string | null; isSwatch: boolean; colourId: string | null; sortOrder: number }>;
}

type Tab = 'skus' | 'media' | 'pricing' | 'badges';

const LIFECYCLE_ACTIONS: Array<{ path: string; label: string; perm: string; confirm?: string; danger?: boolean }> = [
  { path: 'ready-for-enrichment', label: 'Mark ready for enrichment', perm: 'product:write' },
  { path: 'qa-check', label: 'Run QA check', perm: 'product:write' },
  { path: 'publish', label: 'Publish', perm: 'product:publish', confirm: 'Publish this style? It becomes visible on the storefront once it also has an active price.' },
  { path: 'unpublish', label: 'Unpublish', perm: 'product:publish', confirm: 'Unpublish this style? It is removed from the storefront and search immediately.', danger: true },
  { path: 'archive', label: 'Archive', perm: 'product:write', confirm: 'Archive this style? It is removed from search.', danger: true },
];

/**
 * Style workbench. Every lifecycle button calls the product service's own
 * transition route; which transitions are legal from the current state is
 * decided by the server, and its refusal message is shown as-is.
 */
export default function StyleWorkbench() {
  const { id } = useParams<{ id: string }>();
  const style = useApi<Style>(`/products/styles/${id}`);
  const [tab, setTab] = useState<Tab>('skus');
  const lifecycle = useAction();
  const [qa, setQa] = useState<{ passed: boolean; reasons: string[] } | null>(null);
  const [pending, setPending] = useState<(typeof LIFECYCLE_ACTIONS)[number] | null>(null);
  const [created, setCreated] = useState(false);

  useEffect(() => {
    setCreated(new URLSearchParams(window.location.search).get('created') === '1');
  }, []);

  async function transition(a: (typeof LIFECYCLE_ACTIONS)[number]) {
    setQa(null);
    const ok = await lifecycle.run(async () => {
      const res = await apiSend<unknown>('POST', `/products/styles/${id}/${a.path}`);
      if (a.path === 'qa-check') setQa(res as { passed: boolean; reasons: string[] });
    }, a.path === 'qa-check' ? undefined : `${a.label}: done.`);
    setPending(null);
    if (ok) style.reload();
  }

  return (
    <DataState state={style}>
      {(s) => (
        <div>
          <PageHeader
            title={`${s.styleCode} · ${s.name}`}
            breadcrumbs={[{ label: 'Merchandise' }, { label: 'Products', href: '/dashboard/products' }, { label: s.styleCode }]}
            description={
              <>
                <StatusBadge status={s.lifecycleState} /> {s.brand.name} · {s.category.name} · {s.season} · {s.collection}
              </>
            }
          />
          {created && <Notice kind="success">Style created in DRAFT. Add colours, SKUs, media and a price next.</Notice>}

          <Section title="Lifecycle">
            <ActionMessage message={lifecycle.message} />
            {qa && (
              <Notice kind={qa.passed ? 'success' : 'warning'}>
                {qa.passed ? 'QA check passed - the style is ready to publish.' : `QA check did not pass: ${qa.reasons.join('; ')}`}
              </Notice>
            )}
            <dl className="dl" style={{ marginBottom: '0.75rem' }}>
              <dt>State</dt>
              <dd>
                <StatusBadge status={s.lifecycleState} />
              </dd>
              <dt>QA passed</dt>
              <dd>
                <DateText value={s.qaPassedAt} withTime />
              </dd>
              <dt>Published</dt>
              <dd>
                <DateText value={s.publishedAt} withTime />
              </dd>
            </dl>
            <div className="row">
              {LIFECYCLE_ACTIONS.map((a) => (
                <Can key={a.path} anyOf={[a.perm]}>
                  <button
                    type="button"
                    className={a.danger ? 'btn danger' : 'btn'}
                    disabled={lifecycle.busy}
                    onClick={() => (a.confirm ? setPending(a) : void transition(a))}
                  >
                    {a.label}
                  </button>
                </Can>
              ))}
            </div>
            <ConfirmDialog
              open={pending !== null}
              title={pending?.label ?? ''}
              confirmLabel={pending?.label ?? 'Confirm'}
              danger={pending?.danger}
              busy={lifecycle.busy}
              onCancel={() => setPending(null)}
              onConfirm={() => pending && void transition(pending)}
            >
              <p>{pending?.confirm}</p>
            </ConfirmDialog>
          </Section>

          <Tabs<Tab>
            tabs={[
              { key: 'skus', label: `Colours & SKUs (${s.skus.length})` },
              { key: 'media', label: `Media (${s.media.length})` },
              { key: 'pricing', label: 'Pricing' },
              { key: 'badges', label: 'Badges' },
            ]}
            active={tab}
            onChange={setTab}
          />
          {tab === 'skus' && <ColoursAndSkus style={s} onChange={style.reload} />}
          {tab === 'media' && <MediaTab style={s} onChange={style.reload} />}
          {tab === 'pricing' && <PricingTab style={s} />}
          {tab === 'badges' && <BadgesTab styleId={s.id} />}
        </div>
      )}
    </DataState>
  );
}

function ColoursAndSkus({ style, onChange }: { style: Style; onChange: () => void }) {
  const sizes = useApi<Array<{ id: string; label: string }>>('/storefront/sizes');
  const colourAction = useAction();
  const skuAction = useAction();
  const [colour, setColour] = useState({ name: '', colourCode: '', hexSwatch: '' });
  const [chosen, setChosen] = useState<string[]>([]);

  return (
    <div className="grid-2">
      <Section title="Colours">
        <DataTable
          caption="Colours"
          rows={style.colours}
          rowKey={(c) => c.id}
          empty="No colours yet."
          columns={[
            { header: 'Name', cell: (c) => c.name },
            { header: 'Code', cell: (c) => <Ident>{c.colourCode}</Ident> },
            { header: 'Swatch', cell: (c) => c.hexSwatch ?? '—' },
          ]}
        />
        <Can anyOf={['product:write']}>
          <form
            style={{ marginTop: '0.75rem' }}
            onSubmit={async (e) => {
              e.preventDefault();
              const ok = await colourAction.run(
                () => apiSend('POST', `/products/styles/${style.id}/colours`, { name: colour.name, colourCode: colour.colourCode, hexSwatch: colour.hexSwatch || undefined }),
                'Colour added.',
              );
              if (ok) {
                setColour({ name: '', colourCode: '', hexSwatch: '' });
                onChange();
              }
            }}
          >
            <h3>Add colour</h3>
            <ActionMessage message={colourAction.message} />
            <div className="form-row">
              <TextField label="Colour name" required value={colour.name} onChange={(v) => setColour((c) => ({ ...c, name: v }))} />
              <TextField label="Colour code" required value={colour.colourCode} onChange={(v) => setColour((c) => ({ ...c, colourCode: v }))} />
              <TextField label="Hex swatch" value={colour.hexSwatch} placeholder="#000000" onChange={(v) => setColour((c) => ({ ...c, hexSwatch: v }))} />
            </div>
            <button className="primary" type="submit" disabled={colourAction.busy}>
              Add colour
            </button>
          </form>
        </Can>
      </Section>

      <Section title="SKUs">
        <DataTable
          caption="SKUs"
          rows={style.skus}
          rowKey={(k) => k.id}
          empty="No SKUs yet. Add a colour, then generate the SKU matrix for the sizes you stock."
          columns={[
            { header: 'SKU', cell: (k) => <Ident>{k.skuCode}</Ident> },
            { header: 'Colour', cell: (k) => k.colour.name },
            { header: 'Size', cell: (k) => k.size.label },
            { header: 'Active', cell: (k) => <YesNo value={k.isActive} /> },
          ]}
        />
        <Can anyOf={['product:write']}>
          <form
            style={{ marginTop: '0.75rem' }}
            onSubmit={async (e) => {
              e.preventDefault();
              const ok = await skuAction.run(async () => {
                const created = await apiSend<unknown[]>('POST', `/products/styles/${style.id}/skus/generate`, { sizeIds: chosen });
                return created;
              }, 'SKU matrix generated for every colour × chosen size (existing SKUs are kept).');
              if (ok) {
                setChosen([]);
                onChange();
              }
            }}
          >
            <fieldset style={{ border: 'none', padding: 0, margin: 0 }}>
              <legend style={{ fontWeight: 600, marginBottom: '0.4rem' }}>Generate SKUs for sizes</legend>
              <ActionMessage message={skuAction.message} />
              <div className="row">
                {(sizes.data ?? []).map((sz) => (
                  <Checkbox
                    key={sz.id}
                    label={sz.label}
                    checked={chosen.includes(sz.id)}
                    onChange={(on) => setChosen((c) => (on ? [...c, sz.id] : c.filter((x) => x !== sz.id)))}
                  />
                ))}
              </div>
            </fieldset>
            <button className="primary" type="submit" disabled={skuAction.busy || chosen.length === 0}>
              Generate SKUs
            </button>
          </form>
        </Can>
      </Section>
    </div>
  );
}

function MediaTab({ style, onChange }: { style: Style; onChange: () => void }) {
  const action = useAction();
  const [form, setForm] = useState({ url: '', colourId: '', type: 'IMAGE', altText: '', isSwatch: false });
  return (
    <Section title="Media">
      <p className="muted" style={{ marginTop: 0 }}>
        Media is referenced by URL. The console lists the URLs rather than loading third-party images.
      </p>
      <DataTable
        caption="Media"
        rows={style.media}
        rowKey={(m) => m.id}
        empty="No media yet. The QA check requires at least one image."
        columns={[
          {
            header: 'URL',
            cell: (m) => (
              <a href={m.url} target="_blank" rel="noopener noreferrer" style={{ overflowWrap: 'anywhere' }}>
                {m.url}
              </a>
            ),
          },
          { header: 'Type', cell: (m) => m.type },
          { header: 'Colour', cell: (m) => style.colours.find((c) => c.id === m.colourId)?.name ?? 'All colours' },
          { header: 'Alt text', cell: (m) => m.altText ?? '—' },
          { header: 'Swatch', cell: (m) => <YesNo value={m.isSwatch} /> },
        ]}
      />
      <Can anyOf={['product:write']}>
        <form
          style={{ marginTop: '0.75rem' }}
          onSubmit={async (e) => {
            e.preventDefault();
            const ok = await action.run(
              () =>
                apiSend('POST', `/products/styles/${style.id}/media`, {
                  url: form.url,
                  type: form.type,
                  colourId: form.colourId || undefined,
                  altText: form.altText || undefined,
                  isSwatch: form.isSwatch,
                }),
              'Media added.',
            );
            if (ok) {
              setForm({ url: '', colourId: '', type: 'IMAGE', altText: '', isSwatch: false });
              onChange();
            }
          }}
        >
          <h3>Add media</h3>
          <ActionMessage message={action.message} />
          <div className="form-row">
            <TextField label="Media URL" type="url" required value={form.url} onChange={(v) => setForm((f) => ({ ...f, url: v }))} />
            <SelectField
              label="Media type"
              value={form.type}
              onChange={(v) => setForm((f) => ({ ...f, type: v }))}
              options={[
                { value: 'IMAGE', label: 'Image' },
                { value: 'VIDEO', label: 'Video' },
              ]}
            />
            <SelectField
              label="Colour"
              value={form.colourId}
              placeholder="All colours"
              onChange={(v) => setForm((f) => ({ ...f, colourId: v }))}
              options={style.colours.map((c) => ({ value: c.id, label: c.name }))}
            />
            <TextField label="Alt text" value={form.altText} onChange={(v) => setForm((f) => ({ ...f, altText: v }))} />
          </div>
          <Checkbox label="Use as swatch" checked={form.isSwatch} onChange={(v) => setForm((f) => ({ ...f, isSwatch: v }))} />
          <button className="primary" type="submit" disabled={action.busy}>
            Add media
          </button>
        </form>
      </Can>
    </Section>
  );
}

interface Price {
  id: string;
  colourId: string | null;
  mrp: string | number;
  sellingPrice: string | number;
  isMarkdown: boolean;
  effectiveFrom: string;
  effectiveTo: string | null;
}

function PricingTab({ style }: { style: Style }) {
  const entry = useApi<{ activePrice: Price | null; isPublishable: boolean }>(`/catalog/entries/${style.id}`);
  const prices = useApi<Price[]>(`/catalog/prices/${style.id}`);
  const action = useAction();
  const [markdown, setMarkdown] = useState(false);
  const [form, setForm] = useState({ colourId: '', mrp: '', sellingPrice: '', effectiveFrom: '', effectiveTo: '' });

  const reload = () => {
    entry.reload();
    prices.reload();
  };

  return (
    <div className="grid-2">
      <Section title="Price in effect">
        <DataState state={entry}>
          {(e) => (
            <dl className="dl">
              <dt>Active price</dt>
              <dd>
                {e.activePrice ? (
                  <>
                    <Money value={e.activePrice.sellingPrice} /> <span className="muted">(MRP <Money value={e.activePrice.mrp} />)</span>
                  </>
                ) : (
                  'No active price'
                )}
              </dd>
              <dt>Sellable on storefront</dt>
              <dd>
                <YesNo value={e.isPublishable} />
              </dd>
            </dl>
          )}
        </DataState>
        <h3>Price history</h3>
        <DataState state={prices}>
          {(rows) => (
            <DataTable
              caption="Price history"
              rows={rows}
              rowKey={(p) => p.id}
              empty="No prices recorded."
              columns={[
                { header: 'Colour', cell: (p) => style.colours.find((c) => c.id === p.colourId)?.name ?? 'All' },
                { header: 'MRP', numeric: true, cell: (p) => <Money value={p.mrp} /> },
                { header: 'Selling', numeric: true, cell: (p) => <Money value={p.sellingPrice} /> },
                { header: 'Markdown', cell: (p) => <YesNo value={p.isMarkdown} /> },
                { header: 'From', cell: (p) => <DateText value={p.effectiveFrom} withTime /> },
                { header: 'To', cell: (p) => <DateText value={p.effectiveTo} withTime /> },
              ]}
            />
          )}
        </DataState>
      </Section>
      <Can anyOf={['catalog:price:write']}>
        <Section title={markdown ? 'Set markdown price' : 'Set base price'}>
          <p className="muted" style={{ marginTop: 0 }}>
            The pricing service validates MRP/selling-price rules and effective dates. A markdown also needs catalog:price:approve and both dates.
          </p>
          <ActionMessage message={action.message} />
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const ok = await action.run(
                () =>
                  apiSend('POST', markdown ? '/catalog/prices/markdown' : '/catalog/prices', {
                    styleId: style.id,
                    colourId: form.colourId || undefined,
                    mrp: Number(form.mrp),
                    sellingPrice: Number(form.sellingPrice),
                    effectiveFrom: form.effectiveFrom ? new Date(form.effectiveFrom).toISOString() : undefined,
                    effectiveTo: form.effectiveTo ? new Date(form.effectiveTo).toISOString() : undefined,
                  }),
                'Price saved.',
              );
              if (ok) reload();
            }}
          >
            <Checkbox label="This is a markdown" checked={markdown} onChange={setMarkdown} />
            <SelectField
              label="Colour"
              value={form.colourId}
              placeholder="All colours"
              onChange={(v) => setForm((f) => ({ ...f, colourId: v }))}
              options={style.colours.map((c) => ({ value: c.id, label: c.name }))}
            />
            <div className="form-row">
              <TextField label="MRP (INR)" type="number" step="0.01" required value={form.mrp} onChange={(v) => setForm((f) => ({ ...f, mrp: v }))} />
              <TextField
                label="Selling price (INR)"
                type="number"
                step="0.01"
                required
                value={form.sellingPrice}
                onChange={(v) => setForm((f) => ({ ...f, sellingPrice: v }))}
              />
            </div>
            <div className="form-row">
              <TextField label="Effective from" type="datetime-local" value={form.effectiveFrom} onChange={(v) => setForm((f) => ({ ...f, effectiveFrom: v }))} />
              <TextField label="Effective to" type="datetime-local" value={form.effectiveTo} onChange={(v) => setForm((f) => ({ ...f, effectiveTo: v }))} />
            </div>
            <button className="primary" type="submit" disabled={action.busy}>
              Save price
            </button>
          </form>
        </Section>
      </Can>
    </div>
  );
}

interface Badge {
  id: string;
  badgeType: string;
  source: string;
  startsAt: string | null;
  endsAt: string | null;
}

function BadgesTab({ styleId }: { styleId: string }) {
  const badges = useApi<Badge[]>(`/catalog/badges/${styleId}`);
  const action = useAction();
  const [badgeType, setBadgeType] = useState('NEW_ARRIVAL');
  return (
    <Section title="Merchandising badges">
      <ActionMessage message={action.message} />
      <DataState state={badges}>
        {(rows) => (
          <DataTable
            caption="Badges"
            rows={rows}
            rowKey={(b) => b.id}
            empty="No badges."
            columns={[
              { header: 'Badge', cell: (b) => <StatusBadge status={b.badgeType} /> },
              { header: 'Source', cell: (b) => b.source },
              { header: 'Starts', cell: (b) => <DateText value={b.startsAt} /> },
              { header: 'Ends', cell: (b) => <DateText value={b.endsAt} /> },
              {
                header: 'Actions',
                cell: (b) => (
                  <Can anyOf={['catalog:collection:manage']}>
                    <button
                      type="button"
                      className="btn small"
                      disabled={action.busy}
                      onClick={async () => {
                        if (await action.run(() => apiSend('DELETE', `/catalog/badges/${b.id}`), 'Badge removed.')) badges.reload();
                      }}
                    >
                      Remove
                    </button>
                  </Can>
                ),
              },
            ]}
          />
        )}
      </DataState>
      <Can anyOf={['catalog:collection:manage']}>
        <form
          className="row"
          style={{ marginTop: '0.75rem', alignItems: 'flex-end' }}
          onSubmit={async (e) => {
            e.preventDefault();
            if (await action.run(() => apiSend('POST', '/catalog/badges', { styleId, badgeType, source: 'MANUAL' }), 'Badge added.')) badges.reload();
          }}
        >
          <SelectField
            label="Badge"
            value={badgeType}
            onChange={setBadgeType}
            options={['NEW_ARRIVAL', 'BESTSELLER', 'SALE', 'MARKDOWN'].map((b) => ({ value: b, label: b.replace('_', ' ').toLowerCase() }))}
          />
          <button className="primary" type="submit" disabled={action.busy} style={{ marginBottom: '0.75rem' }}>
            Add badge
          </button>
        </form>
      </Can>
    </Section>
  );
}
