'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { ActionMessage, Can, Checkbox, ConfirmDialog, DataState, DataTable, DateText, Money, Notice, Section, SelectField, StatusBadge, TextField, YesNo } from '@/components/ui';
import { apiSend } from '@/lib/api';
import { displayImageUrl, storefrontUrl } from '@/lib/media';
import { profileFor } from '@/lib/product-profiles';
import { useAction, useApi } from '@/lib/session';
import type { Step, StepProps } from './types';

interface Price {
  id: string;
  colourId: string | null;
  mrp: string | number;
  sellingPrice: string | number;
  isMarkdown: boolean;
  effectiveFrom: string;
  effectiveTo: string | null;
}

const STEP_LABEL: Record<string, string> = { basics: 'Basics', variants: 'Colours & sizes', photos: 'Photos', pricing: 'Pricing', publish: 'Publish' };

// ------------------------------------------------------------------ pricing

/** Pricing: the catalogue's own rules decide what is valid; a markdown needs approval permission. */
export function PricingStep({ style, readiness, onChanged }: StepProps) {
  const prices = useApi<Price[]>(`/catalog/prices/${style.id}`);
  const action = useAction();
  const [form, setForm] = useState({ colourId: '', mrp: '', sellingPrice: '', effectiveFrom: '', effectiveTo: '' });
  const [markdown, setMarkdown] = useState(false);
  const pricingIssues = readiness?.issues.filter((i) => i.step === 'pricing') ?? [];
  const profile = profileFor(readiness?.productType ?? style.category.productType);
  const mrp = Number(form.mrp);
  const selling = Number(form.sellingPrice);
  const formError = form.mrp && form.sellingPrice && selling > mrp ? 'Selling price cannot be above MRP.' : null;

  // Stacked rather than side by side: the price history has six columns and was cut off in half a page.
  return (
    <div className="stack">
      <Section title="Prices in effect">
        {pricingIssues.length === 0 ? (
          <Notice kind="success">Every {profile.colourLabel.toLowerCase()} has a price.</Notice>
        ) : (
          pricingIssues.map((i) => (
            <Notice key={i.message} kind="warning">
              {i.message}
            </Notice>
          ))
        )}
        {readiness && !readiness.purchasable.ok && readiness.purchasable.reasons.some((r) => r.startsWith('No price for all colours')) && (
          <Notice kind="info">The storefront lists a product by its price for all {profile.colourLabel.toLowerCase()}s. Set one even if some have their own price.</Notice>
        )}
        <DataState state={prices}>
          {(rows) => (
            <DataTable
              caption="Price history"
              rows={rows}
              rowKey={(p) => p.id}
              empty="No prices yet."
              columns={[
                { header: 'Applies to', cell: (p) => style.colours.find((c) => c.id === p.colourId)?.name ?? `All ${profile.colourLabel.toLowerCase()}s` },
                { header: 'MRP', numeric: true, cell: (p) => <Money value={p.mrp} /> },
                { header: 'Selling', numeric: true, cell: (p) => <Money value={p.sellingPrice} /> },
                { header: 'Markdown', cell: (p) => <YesNo value={p.isMarkdown} /> },
                { header: 'From', cell: (p) => <DateText value={p.effectiveFrom} withTime /> },
                { header: 'Until', cell: (p) => (p.effectiveTo ? <DateText value={p.effectiveTo} withTime /> : 'No end') },
              ]}
            />
          )}
        </DataState>
      </Section>
      <Can anyOf={['catalog:price:write']}>
        <Section title={markdown ? 'Set a markdown' : 'Set a price'}>
          <ActionMessage message={action.message} />
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (formError) return;
              const ok = await action.run(
                () =>
                  apiSend('POST', markdown ? '/catalog/prices/markdown' : '/catalog/prices', {
                    styleId: style.id,
                    ...(form.colourId ? { colourId: form.colourId } : {}),
                    mrp,
                    sellingPrice: selling,
                    effectiveFrom: form.effectiveFrom ? new Date(form.effectiveFrom).toISOString() : undefined,
                    effectiveTo: form.effectiveTo ? new Date(form.effectiveTo).toISOString() : undefined,
                  }),
                'Price saved. The storefront follows within a minute.',
              );
              if (ok) {
                prices.reload();
                onChanged();
              }
            }}
          >
            <SelectField
              label="Applies to"
              value={form.colourId}
              onChange={(v) => setForm((f) => ({ ...f, colourId: v }))}
              placeholder={`All ${profile.colourLabel.toLowerCase()}s`}
              options={style.colours.map((c) => ({ value: c.id, label: `${c.name} only` }))}
            />
            <div className="form-row">
              <TextField label="MRP (₹)" type="number" step="0.01" min={0} required value={form.mrp} onChange={(v) => setForm((f) => ({ ...f, mrp: v }))} />
              <TextField label="Selling price (₹)" type="number" step="0.01" min={0} required value={form.sellingPrice} onChange={(v) => setForm((f) => ({ ...f, sellingPrice: v }))} hint={formError ?? undefined} />
            </div>
            <Can anyOf={['catalog:price:approve']}>
              <Checkbox label="This is a markdown (needs start and end dates)" checked={markdown} onChange={setMarkdown} />
            </Can>
            {markdown && (
              <div className="form-row">
                <TextField label="Starts" type="datetime-local" required value={form.effectiveFrom} onChange={(v) => setForm((f) => ({ ...f, effectiveFrom: v }))} />
                <TextField label="Ends" type="datetime-local" required value={form.effectiveTo} onChange={(v) => setForm((f) => ({ ...f, effectiveTo: v }))} />
              </div>
            )}
            <button className="primary" type="submit" disabled={action.busy || Boolean(formError)}>
              Save price
            </button>
          </form>
        </Section>
      </Can>
    </div>
  );
}

// ------------------------------------------------------------------ readiness

/** Readiness: the four facts kept apart, every gap linked to the step that fixes it. */
export function ReadinessStep({ style, readiness, goTo }: StepProps) {
  if (!readiness) return <p className="loading-state">Checking…</p>;
  const blocking = readiness.issues.filter((i) => i.blocking);
  const advice = readiness.issues.filter((i) => !i.blocking);
  return (
    <div className="stack">
      <StatusCards style={style} readiness={readiness} />
      <Section title={blocking.length ? `${blocking.length} thing${blocking.length === 1 ? '' : 's'} to do before shoppers can buy this` : 'Nothing blocking'}>
        {blocking.length === 0 && <Notice kind="success">All required steps are done.</Notice>}
        {blocking.length === 0 && readiness.stock.availableUnits === 0 && (
          <Notice kind="warning">
            No stock yet: shoppers will see every size as sold out. <Link href="/dashboard/receiving">Receive goods</Link> to make it buyable.
          </Notice>
        )}
        <IssueList issues={blocking} goTo={goTo} />
        {advice.length > 0 && (
          <>
            <h3>Recommended</h3>
            <IssueList issues={advice} goTo={goTo} />
          </>
        )}
      </Section>
      <Section title="Sales channels">
        {readiness.channels.length === 0 ? (
          <p className="muted">
            No sales channels are set up. <Link href="/dashboard/channels">Channels</Link>
          </p>
        ) : (
          <DataTable
            caption="Channel readiness"
            rows={readiness.channels}
            rowKey={(c) => c.id}
            columns={[
              { header: 'Channel', cell: (c) => <Link href="/dashboard/channels">{c.name}</Link> },
              { header: 'State', cell: (c) => (c.active ? 'Active' : 'Paused') },
              { header: 'Sends', cell: (c) => (c.scope === 'ALL' ? 'Everything that can be bought' : 'Only products sent by hand') },
              { header: 'Sizes listed', numeric: true, cell: (c) => c.sizesListed },
              { header: 'Failed', numeric: true, cell: (c) => c.sizesFailed },
              { header: 'Notes', cell: (c) => c.notes.join(' ') || '—' },
            ]}
          />
        )}
      </Section>
    </div>
  );
}

export function StatusCards({ style, readiness }: { style: StepProps['style']; readiness: NonNullable<StepProps['readiness']> }) {
  const channelsListed = readiness.channels.filter((c) => c.sizesListed > 0).length;
  // Listed and priced but nothing on hand: shoppers see the product, with every size sold out.
  const soldOut = readiness.stock.availableUnits === 0;
  return (
    <div className="status-cards" aria-label="Product status">
      <div className={`status-card ${readiness.published ? 'ok' : 'todo'}`}>
        <span className="status-label">Published</span>
        <strong>{readiness.published ? 'Yes' : 'No'}</strong>
        <span className="muted small">
          <StatusBadge status={readiness.lifecycleState} />
        </span>
      </div>
      <div className={`status-card ${readiness.purchasable.ok && !soldOut ? 'ok' : 'todo'}`}>
        <span className="status-label">Can be bought</span>
        <strong>{!readiness.purchasable.ok ? 'No' : soldOut ? 'Not yet' : 'Yes'}</strong>
        <span className="muted small">
          {!readiness.purchasable.ok
            ? readiness.purchasable.reasons.join('; ')
            : soldOut
              ? 'On the storefront, but every size shows as sold out until stock is received'
              : 'On the storefront'}
        </span>
      </div>
      <div className={`status-card ${readiness.stock.availableUnits > 0 ? 'ok' : 'todo'}`}>
        <span className="status-label">In stock</span>
        <strong>{readiness.stock.availableUnits} unit{readiness.stock.availableUnits === 1 ? '' : 's'}</strong>
        <span className="muted small">
          {readiness.stock.sizesInStock} of {readiness.stock.sizesForSale} sizes ·{' '}
          {readiness.stock.availableUnits > 0 ? (
            <Link href={`/dashboard/inventory?q=${encodeURIComponent(style.styleCode)}`}>View stock</Link>
          ) : (
            <Link href="/dashboard/receiving">Receive goods</Link>
          )}
        </span>
      </div>
      <div className={`status-card ${channelsListed > 0 ? 'ok' : 'todo'}`}>
        <span className="status-label">On sales channels</span>
        <strong>
          {channelsListed} of {readiness.channels.length}
        </strong>
        <span className="muted small">{readiness.channels.length ? readiness.channels.map((c) => `${c.name}: ${c.sizesListed} listed`).join(' · ') : 'No channels set up'}</span>
      </div>
    </div>
  );
}

function IssueList({ issues, goTo }: { issues: NonNullable<StepProps['readiness']>['issues']; goTo: (step: Step) => void }) {
  if (issues.length === 0) return null;
  return (
    <ul className="issue-list">
      {issues.map((i) => (
        <li key={`${i.step}-${i.message}`}>
          <span className={`badge ${i.blocking ? 'warning' : 'neutral'}`}>{STEP_LABEL[i.step]}</span> {i.message}{' '}
          <button type="button" className="link-button" onClick={() => goTo(i.step)}>
            Fix in {STEP_LABEL[i.step]}
          </button>
        </li>
      ))}
    </ul>
  );
}

// ------------------------------------------------------------------ preview

/** A shopper's-eye summary of the product. The storefront's own design is not reproduced here. */
export function PreviewStep({ style, readiness }: StepProps) {
  const profile = profileFor(readiness?.productType ?? style.category.productType);
  const entry = useApi<{ activePrice: Price | null }>(`/catalog/entries/${style.id}`);
  const [colourId, setColourId] = useState(style.colours[0]?.id ?? '');
  const attrs = (style.customAttributes ?? {}) as Record<string, unknown>;
  const gallery = useMemo(
    () => [...style.media].sort((a, b) => a.sortOrder - b.sortOrder).filter((m) => m.type === 'IMAGE' && (!m.colourId || m.colourId === colourId)),
    [style.media, colourId],
  );
  const cover = style.media.find((m) => m.id === readiness?.coverMediaId);
  const sizes = style.skus.filter((s) => s.colourId === colourId).sort((a, b) => a.size.sortOrder - b.size.sortOrder);
  const details = Array.isArray(attrs.details) ? (attrs.details as string[]) : [];

  return (
    <div className="grid-2">
      <Section title="Listing card">
        <div className="preview-card">
          <div className="photo-frame tall">
            {cover && displayImageUrl(cover.url) ? (
              <img src={displayImageUrl(cover.url)!} alt={cover.altText ?? ''} />
            ) : (
              <span className="muted">No photo</span>
            )}
          </div>
          <strong>{style.name}</strong>
          {typeof attrs.subtitle === 'string' && <span className="muted">{attrs.subtitle}</span>}
          <DataState state={entry}>{(e) => (e.activePrice ? <span><Money value={e.activePrice.sellingPrice} /> <s className="muted"><Money value={e.activePrice.mrp} /></s></span> : <span className="muted">No price yet</span>)}</DataState>
        </div>
        {readiness?.published ? (
          <p>
            <a href={storefrontUrl(`/product/${style.id}`)} target="_blank" rel="noopener noreferrer">
              Open on the storefront
            </a>
          </p>
        ) : (
          <p className="muted">Shoppers can see this once it is published.</p>
        )}
      </Section>
      <Section title="Product page">
        <SelectField label={profile.colourLabel} value={colourId} onChange={setColourId} options={style.colours.map((c) => ({ value: c.id, label: c.name }))} />
        <div className="preview-gallery">
          {gallery.length === 0 && <span className="muted">No photos for this {profile.colourLabel.toLowerCase()}.</span>}
          {gallery.map((m) => (
            <img key={m.id} src={displayImageUrl(m.url) ?? ''} alt={m.altText ?? ''} />
          ))}
        </div>
        <p>
          <strong>{profile.sizeLabel}s:</strong>{' '}
          {sizes.length === 0 ? 'none' : sizes.map((s) => `${s.size.label}${s.isActive ? '' : ' (off)'}`).join(', ')}
        </p>
        {details.length > 0 && (
          <ul>
            {details.map((d) => (
              <li key={d}>{d}</li>
            ))}
          </ul>
        )}
        <dl className="dl">
          {profile.attributes.map((a) => {
            const v = a.storage === 'column' ? (style as unknown as Record<string, unknown>)[a.key] : attrs[a.key];
            return typeof v === 'string' && v ? (
              <div key={a.key} style={{ display: 'contents' }}>
                <dt>{a.label}</dt>
                <dd>{v}</dd>
              </div>
            ) : null;
          })}
        </dl>
      </Section>
    </div>
  );
}

// ------------------------------------------------------------------ publish

/**
 * Publish: the lifecycle (PROD-003) and the QA gate (CAT-002) stay on the
 * server; this step walks the existing transitions in order and shows the
 * server's own reasons when a gate refuses.
 */
export function PublishStep({ style, readiness, onChanged, goTo }: StepProps) {
  const action = useAction();
  const [qaReasons, setQaReasons] = useState<string[] | null>(null);
  const [confirm, setConfirm] = useState<'unpublish' | 'archive' | null>(null);
  const blocking = readiness?.issues.filter((i) => i.blocking && i.step !== 'publish') ?? [];
  const state = style.lifecycleState;

  async function publish() {
    setQaReasons(null);
    await action.run(async () => {
      if (state === 'DRAFT') await apiSend('POST', `/products/styles/${style.id}/ready-for-enrichment`);
      const qa = await apiSend<{ passed: boolean; reasons: string[] }>('POST', `/products/styles/${style.id}/qa-check`);
      if (!qa.passed) {
        setQaReasons(qa.reasons);
        throw new Error('The completeness check did not pass, so the product was not published.');
      }
      await apiSend('POST', `/products/styles/${style.id}/publish`);
    }, 'Published. The storefront and search follow within a minute.');
    onChanged();
  }

  async function transition(path: 'unpublish' | 'archive') {
    await action.run(() => apiSend('POST', `/products/styles/${style.id}/${path}`), path === 'unpublish' ? 'Unpublished.' : 'Archived.');
    setConfirm(null);
    onChanged();
  }

  return (
    <div className="stack">
      {readiness && <StatusCards style={style} readiness={readiness} />}
      <Section title="Publishing">
        <ActionMessage message={action.message} />
        {qaReasons && (
          <Notice kind="warning">
            The server&apos;s completeness check found: {qaReasons.join('; ')}.
          </Notice>
        )}
        {state === 'PUBLISHED' ? (
          <p>This product is live. Edits to its details, photos and prices show on the storefront within a minute.</p>
        ) : state === 'UNPUBLISHED' ? (
          blocking.length > 0 ? (
            <>
              <p>This product is unpublished. Before it can go live again, finish these:</p>
              <ul className="issue-list">
                {blocking.map((i) => (
                  <li key={i.message}>
                    {i.message}{' '}
                    <button type="button" className="link-button" onClick={() => goTo(i.step)}>
                      Fix in {STEP_LABEL[i.step]}
                    </button>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p>
              This product is unpublished. Republishing runs the completeness check again and makes it visible on the storefront and in search.
            </p>
          )
        ) : state === 'ARCHIVED' ? (
          <p>This product is archived and read-only.</p>
        ) : blocking.length > 0 ? (
          <>
            <p>Finish these first:</p>
            <ul className="issue-list">
              {blocking.map((i) => (
                <li key={i.message}>
                  {i.message}{' '}
                  <button type="button" className="link-button" onClick={() => goTo(i.step)}>
                    Fix in {STEP_LABEL[i.step]}
                  </button>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p>Everything required is in place. Publishing makes the product visible on the storefront and in search.</p>
        )}
        <div className="row">
          {(state === 'DRAFT' || state === 'READY_FOR_ENRICHMENT' || state === 'READY_FOR_QA' || state === 'UNPUBLISHED') && (
            <Can anyOf={['product:publish']}>
              <button type="button" className="primary" disabled={action.busy || blocking.length > 0} onClick={() => void publish()}>
                {action.busy ? 'Publishing…' : state === 'UNPUBLISHED' ? 'Republish' : 'Publish'}
              </button>
            </Can>
          )}
          {state === 'PUBLISHED' && (
            <Can anyOf={['product:publish']}>
              <button type="button" className="btn danger" disabled={action.busy} onClick={() => setConfirm('unpublish')}>
                Unpublish
              </button>
            </Can>
          )}
          {state !== 'ARCHIVED' && (
            <Can anyOf={['product:write']}>
              <button type="button" className="btn danger" disabled={action.busy} onClick={() => setConfirm('archive')}>
                Archive
              </button>
            </Can>
          )}
        </div>
        <ConfirmDialog
          open={confirm !== null}
          title={confirm === 'unpublish' ? 'Unpublish this product?' : 'Archive this product?'}
          confirmLabel={confirm === 'unpublish' ? 'Unpublish' : 'Archive'}
          danger
          busy={action.busy}
          onCancel={() => setConfirm(null)}
          onConfirm={() => void transition(confirm!)}
        >
          <p>
            {confirm === 'unpublish'
              ? 'It leaves the storefront and search at once. Under the current lifecycle an unpublished product cannot be published again.'
              : 'It leaves the storefront and search and becomes read-only. This cannot be undone here.'}
          </p>
        </ConfirmDialog>
      </Section>
      <BadgesSection styleId={style.id} />
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

function BadgesSection({ styleId }: { styleId: string }) {
  const badges = useApi<Badge[]>(`/catalog/badges/${styleId}`);
  const action = useAction();
  const [badgeType, setBadgeType] = useState('NEW_ARRIVAL');
  return (
    <Section title="Badges">
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
          className="inline-form"
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
          <button className="primary" type="submit" disabled={action.busy}>
            Add badge
          </button>
        </form>
      </Can>
    </Section>
  );
}
