'use client';

import { useEffect, useState } from 'react';
import { SkuPicker, type SkuOption } from '@/components/pickers';
import {
  ActionMessage,
  Can,
  ConfirmDialog,
  DataState,
  DataTable,
  DateText,
  Drawer,
  Ident,
  Money,
  Notice,
  PageHeader,
  Section,
  SelectField,
  StatusBadge,
  TextField,
} from '@/components/ui';
import { apiFetch, apiSend, errorMessage, qs } from '@/lib/api';
import { useAction, useApi, useCan } from '@/lib/session';

interface Channel {
  id: string;
  key: string;
  name: string;
  providerName: string;
  isActive: boolean;
  config: { publishAll?: boolean } | null;
}

interface ChannelListing {
  id: string;
  skuId: string;
  status: string;
  externalId: string | null;
  lastSyncedAt: string | null;
  lastError: string | null;
  retryCount: number;
  updatedAt: string;
}

interface Attempt {
  id: string;
  action: string;
  status: string;
  errorMessage: string | null;
  attemptedAt: string;
}

interface FeedItem {
  externalId: string;
  title: string;
  price: number;
  currency: string;
  availability: string;
  imageUrl: string | null;
}

/**
 * Channel publishing (M26). Publish and unpublish call the channel service,
 * which records every attempt. An ambiguous outcome (the provider call
 * failed after dispatch) stays ambiguous until an operator re-issues the
 * same action; re-issuing reuses the listing's operation id, so the
 * provider can de-duplicate it. Nothing here retries automatically.
 */
export default function ChannelsPage() {
  const channels = useApi<Channel[]>('/channels');
  const [channelId, setChannelId] = useState('');
  useEffect(() => {
    if (!channelId && channels.data?.[0]) setChannelId(channels.data[0].id);
  }, [channels.data, channelId]);
  const listings = useApi<ChannelListing[]>(channelId ? `/channels/${channelId}/listings` : null);
  const canProduct = useCan('product:read');
  const skuIds = (listings.data ?? []).map((l) => l.skuId);
  const labels = useApi<{ skus: Record<string, string> }>(canProduct && skuIds.length ? `/admin/lookup/labels${qs({ skuIds: skuIds.slice(0, 200).join(',') })}` : null);
  const action = useAction();
  const [sku, setSku] = useState<SkuOption | null>(null);
  const [preview, setPreview] = useState<FeedItem | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [attemptsFor, setAttemptsFor] = useState<ChannelListing | null>(null);
  const [confirm, setConfirm] = useState<{ kind: 'publish' | 'unpublish'; skuId: string; label: string } | { kind: 'reclaim' | 'resync' } | null>(null);
  const channel = channels.data?.find((c) => c.id === channelId);

  useEffect(() => {
    setPreview(null);
    setPreviewError(null);
    if (!sku || !channelId) return;
    apiFetch<FeedItem>(`/channels/${channelId}/preview/${sku.id}`)
      .then(setPreview)
      .catch((err) => setPreviewError(errorMessage(err)));
  }, [sku, channelId]);

  async function run() {
    if (!confirm) return;
    const c = confirm;
    const call =
      c.kind === 'publish' || c.kind === 'unpublish'
        ? () => apiSend('POST', `/channels/${channelId}/skus/${c.skuId}/${c.kind}`)
        : () => apiSend('POST', c.kind === 'reclaim' ? '/channels/sweep/reclaim-stale' : '/channels/sweep/resync-stale');
    const ok = await action.run(call, c.kind === 'publish' ? 'Publish attempt recorded - see the listing status.' : c.kind === 'unpublish' ? 'Unpublish attempt recorded.' : 'Sweep finished.');
    setConfirm(null);
    if (ok) {
      listings.reload();
      if (c.kind === 'publish') setSku(null);
    }
  }

  return (
    <div>
      <PageHeader
        title="Channel publishing"
        breadcrumbs={[{ label: 'Commercial' }, { label: 'Channels' }]}
        actions={
          <Can anyOf={['channel:manage']}>
            <button type="button" className="btn" onClick={() => setConfirm({ kind: 'resync' })}>
              Resync stale availability
            </button>
            <button type="button" className="btn" onClick={() => setConfirm({ kind: 'reclaim' })}>
              Reclaim stuck attempts
            </button>
          </Can>
        }
      />
      <ActionMessage message={confirm ? null : action.message} />
      <DataState state={channels} isEmpty={(d) => d.length === 0} empty="No channels are configured yet.">
        {(list) => (
          <SelectField
            label="Channel"
            value={channelId}
            onChange={setChannelId}
            options={list.map((c) => ({ value: c.id, label: `${c.name} (${c.providerName})${c.isActive ? '' : ' - inactive'}` }))}
          />
        )}
      </DataState>
      <Can anyOf={['channel:manage']}>
        <NewChannel onCreated={channels.reload} />
      </Can>

      {channel && (
        <>
          <ChannelSettings channel={channel} onSaved={channels.reload} />
          <Can anyOf={['channel:manage']}>
            <Section title={`Publish a SKU to ${channel.name}`}>
              <SkuPicker value={sku} onChange={setSku} />
              {previewError && <Notice kind="error">{previewError}</Notice>}
              {preview && (
                <dl className="dl" style={{ marginBottom: '0.75rem' }}>
                  <dt>Feed title</dt>
                  <dd>{preview.title}</dd>
                  <dt>Price</dt>
                  <dd>
                    <Money value={preview.price} currency={preview.currency} />
                  </dd>
                  <dt>Availability</dt>
                  <dd>{preview.availability.replace('_', ' ')}</dd>
                  <dt>External id</dt>
                  <dd>
                    <Ident>{preview.externalId}</Ident>
                  </dd>
                </dl>
              )}
              <button type="button" className="primary" disabled={!sku} onClick={() => sku && setConfirm({ kind: 'publish', skuId: sku.id, label: sku.skuCode })}>
                Publish SKU
              </button>
            </Section>
          </Can>
          <Section title="Listings">
            <DataState state={listings}>
              {(rows) => (
                <DataTable
                  caption="Channel listings"
                  rows={rows}
                  rowKey={(l) => l.id}
                  empty="Nothing listed on this channel."
                  columns={[
                    { header: 'SKU', cell: (l) => <Ident>{labels.data?.skus[l.skuId] ?? l.skuId.slice(0, 8)}</Ident> },
                    {
                      header: 'Status',
                      cell: (l) => (
                        <>
                          <StatusBadge status={l.status} />
                          {l.status === 'AMBIGUOUS_RECONCILIATION_REQUIRED' && (
                            <div className="muted" style={{ fontSize: '0.8rem' }}>
                              Outcome unknown. Check the channel, then re-issue the same action.
                            </div>
                          )}
                          {l.lastError && <div className="muted">{l.lastError}</div>}
                        </>
                      ),
                    },
                    { header: 'External id', cell: (l) => <Ident>{l.externalId ?? '—'}</Ident> },
                    { header: 'Last synced', cell: (l) => <DateText value={l.lastSyncedAt} withTime /> },
                    {
                      header: 'Actions',
                      cell: (l) => (
                        <span className="row">
                          <button type="button" className="btn small" onClick={() => setAttemptsFor(l)}>
                            Attempts
                          </button>
                          <Can anyOf={['channel:manage']}>
                            <button
                              type="button"
                              className="btn small"
                              onClick={() => setConfirm({ kind: 'publish', skuId: l.skuId, label: labels.data?.skus[l.skuId] ?? 'this SKU' })}
                            >
                              {l.status === 'PUBLISHED' ? 'Resync' : 'Publish'}
                            </button>
                            <button
                              type="button"
                              className="btn small danger"
                              onClick={() => setConfirm({ kind: 'unpublish', skuId: l.skuId, label: labels.data?.skus[l.skuId] ?? 'this SKU' })}
                            >
                              Unpublish
                            </button>
                          </Can>
                        </span>
                      ),
                    },
                  ]}
                />
              )}
            </DataState>
          </Section>
        </>
      )}

      <Drawer open={attemptsFor !== null} title="Publication attempts" onClose={() => setAttemptsFor(null)}>
        {attemptsFor && <Attempts listingId={attemptsFor.id} />}
      </Drawer>

      <ConfirmDialog
        open={confirm !== null}
        title={
          confirm?.kind === 'publish'
            ? 'Publish to channel'
            : confirm?.kind === 'unpublish'
              ? 'Unpublish from channel'
              : confirm?.kind === 'reclaim'
                ? 'Reclaim stuck attempts'
                : 'Resync stale availability'
        }
        confirmLabel={confirm?.kind === 'publish' ? 'Publish' : confirm?.kind === 'unpublish' ? 'Unpublish' : 'Run sweep'}
        danger={confirm?.kind === 'unpublish'}
        busy={action.busy}
        onCancel={() => setConfirm(null)}
        onConfirm={() => void run()}
      >
        {confirm && (confirm.kind === 'publish' || confirm.kind === 'unpublish') && (
          <p>
            {confirm.kind === 'publish' ? 'Publish' : 'Unpublish'} <span className="mono">{confirm.label}</span> on {channel?.name}. The attempt and its outcome are
            recorded; an unknown outcome is marked for reconciliation, never assumed.
          </p>
        )}
        {confirm?.kind === 'reclaim' && <p>Marks attempts stuck in processing past the stale window as needing reconciliation. It never re-sends anything.</p>}
        {confirm?.kind === 'resync' && <p>Re-publishes published listings whose stock availability has changed since they were last sent.</p>}
        {action.message?.kind === 'error' && <ActionMessage message={action.message} />}
      </ConfirmDialog>
    </div>
  );
}

function Attempts({ listingId }: { listingId: string }) {
  const attempts = useApi<Attempt[]>(`/channels/listings/${listingId}/attempts`);
  return (
    <DataState state={attempts}>
      {(rows) => (
        <DataTable
          caption="Attempts"
          rows={rows}
          rowKey={(a) => a.id}
          empty="No attempts recorded."
          columns={[
            { header: 'When', cell: (a) => <DateText value={a.attemptedAt} withTime /> },
            { header: 'Action', cell: (a) => a.action.toLowerCase() },
            { header: 'Outcome', cell: (a) => <StatusBadge status={a.status} /> },
            { header: 'Error', cell: (a) => a.errorMessage ?? '—' },
          ]}
        />
      )}
    </DataState>
  );
}

function NewChannel({ onCreated }: { onCreated: () => void }) {
  const action = useAction();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ key: '', name: '', providerName: 'MOCK' });
  return (
    <details open={open} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)} style={{ marginBottom: '1rem' }}>
      <summary>Add a channel</summary>
      <form
        className="card"
        style={{ marginTop: '0.5rem', maxWidth: 520 }}
        onSubmit={async (e) => {
          e.preventDefault();
          if (await action.run(() => apiSend('POST', '/channels', f), 'Channel created.')) {
            setF({ key: '', name: '', providerName: 'MOCK' });
            onCreated();
          }
        }}
      >
        <ActionMessage message={action.message} />
        <TextField label="Channel key" required value={f.key} onChange={(v) => setF((x) => ({ ...x, key: v }))} />
        <TextField label="Channel name" required value={f.name} onChange={(v) => setF((x) => ({ ...x, name: v }))} />
        <TextField
          label="Provider"
          required
          value={f.providerName}
          onChange={(v) => setF((x) => ({ ...x, providerName: v }))}
          hint="GOOGLE_MERCHANT or META_CATALOG (credentials are set on the server), or MOCK for testing; production refuses MOCK providers. Add config {&quot;publishAll&quot;: true} via the API to list every published product automatically."
        />
        <button className="primary" type="submit" disabled={action.busy}>
          Create channel
        </button>
      </form>
    </details>
  );
}

/**
 * Admin Ops Phase 1: what this channel sends, and pause/resume. "Every
 * product that can be bought" is the existing publishAll setting (picked up
 * by the scheduled channel sync); "Only products I send" leaves sending to
 * the Publish button below. A paused channel sends nothing until resumed.
 */
function ChannelSettings({ channel, onSaved }: { channel: Channel; onSaved: () => void }) {
  const action = useAction();
  const canManage = useCan('channel:manage');
  const [pausing, setPausing] = useState(false);
  const publishAll = channel.config?.publishAll === true;
  const save = async (patch: { isActive?: boolean; publishAll?: boolean }, message: string) => {
    if (await action.run(() => apiSend('PATCH', `/channels/${channel.id}`, patch), message)) onSaved();
  };
  return (
    <Section title={`${channel.name} settings`}>
      <ActionMessage message={action.message} />
      {!channel.isActive && <Notice kind="warning">Paused: nothing is sent to {channel.name} and its listings are not updated until you resume it.</Notice>}
      {channel.providerName.startsWith('MOCK') && <Notice kind="info">This channel uses a test provider: nothing reaches a real marketplace. Production refuses test providers.</Notice>}
      <fieldset className="fieldset" disabled={!canManage || action.busy}>
        <legend>What it sends</legend>
        <label className="check">
          <input type="radio" name={`scope-${channel.id}`} checked={publishAll} onChange={() => void save({ publishAll: true }, 'This channel now sends every product that can be bought, from the next sync.')} /> Every product that can be bought
          (sent on the next scheduled sync)
        </label>
        <label className="check">
          <input type="radio" name={`scope-${channel.id}`} checked={!publishAll} onChange={() => void save({ publishAll: false }, 'This channel now sends only products you send by hand. Products already listed stay listed.')} /> Only products I send by hand
        </label>
      </fieldset>
      {canManage && (
        <div className="row">
          {channel.isActive ? (
            <button type="button" className="btn danger" disabled={action.busy} onClick={() => setPausing(true)}>
              Pause channel
            </button>
          ) : (
            <button type="button" className="primary" disabled={action.busy} onClick={() => void save({ isActive: true }, 'Resumed. The next sync brings its listings up to date.')}>
              Resume channel
            </button>
          )}
        </div>
      )}
      <ConfirmDialog
        open={pausing}
        title={`Pause ${channel.name}?`}
        confirmLabel="Pause"
        danger
        busy={action.busy}
        onCancel={() => setPausing(false)}
        onConfirm={async () => {
          await save({ isActive: false }, `${channel.name} paused.`);
          setPausing(false);
        }}
      >
        <p>Nothing new is sent and price or stock changes are not passed on while paused. Products already listed stay listed on {channel.name}; take them down below if needed.</p>
      </ConfirmDialog>
    </Section>
  );
}
