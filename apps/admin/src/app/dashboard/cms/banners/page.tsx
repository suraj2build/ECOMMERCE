'use client';

import { useState } from 'react';
import { ActionMessage, Can, Checkbox, DataState, Drawer, Notice, PageHeader, Section, SelectField, StatusBadge, TextField } from '@/components/ui';
import { ImagePicker } from '@/components/content/ImagePicker';
import { apiSend } from '@/lib/api';
import { displayImageUrl, storefrontUrl } from '@/lib/media';
import { useAction, useApi } from '@/lib/session';

interface Banner {
  id: string;
  title: string;
  imageUrl: string;
  linkUrl: string | null;
  placement: string;
  sortOrder: number;
  isActive: boolean;
  publishedAt: string | null;
}
interface Placements {
  banners: Array<{ key: string; label: string; where: string; uses: 'first' | 'all'; fields: string[] }>;
}

function safeLink(url: string): boolean {
  const v = url.trim();
  if (!v) return true;
  if (v.startsWith('/') && !v.startsWith('//')) return !/\s/.test(v);
  try {
    return new URL(v).protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Banners grouped by the storefront placement that shows them (Admin Ops
 * Phase 1). Each banner is either live or a draft; drafts are never shown to
 * shoppers. Images are uploaded or picked, with a preview. Banners in a
 * placement the storefront does not read are listed separately.
 */
export default function BannersPage() {
  const placements = useApi<Placements>('/cms/placements');
  const banners = useApi<Banner[]>('/cms/banners');
  const [editing, setEditing] = useState<(Partial<Banner> & { placement: string }) | null>(null);
  const action = useAction();

  return (
    <div>
      <PageHeader
        title="Banners"
        breadcrumbs={[{ label: 'Content' }, { label: 'Banners' }]}
        description="Photos for the entry page and each department's home page. Drafts stay hidden until switched on."
      />
      <ActionMessage message={action.message} />
      <DataState state={placements}>
        {(p) => (
          <DataState state={banners}>
            {(list) => {
              const known = new Set(p.banners.map((b) => b.key));
              const other = list.filter((b) => !known.has(b.placement));
              return (
                <div className="stack">
                  {p.banners.map((place) => {
                    const items = list.filter((b) => b.placement === place.key).sort((a, b) => a.sortOrder - b.sortOrder);
                    const live = items.filter((b) => b.isActive);
                    return (
                      <Section
                        key={place.key}
                        title={place.label}
                        actions={
                          <Can anyOf={['cms:manage']}>
                            <button type="button" className="btn small" onClick={() => setEditing({ placement: place.key, sortOrder: items.length, isActive: false })}>
                              Add banner
                            </button>
                          </Can>
                        }
                      >
                        <p className="muted small" style={{ marginTop: 0 }}>
                          {place.where}. {place.uses === 'first' ? 'Shows the first live banner only.' : 'Shows every live banner in order.'} Uses: {place.fields.join(', ')}.
                          {live.length === 0 && ' Nothing live here: the section shows without a photo.'}
                        </p>
                        <div className="photo-grid">
                          {items.map((b, i) => (
                            <div key={b.id} className={`photo-card${b.isActive && (place.uses === 'all' || b.id === live[0]?.id) ? ' cover' : ''}`}>
                              <div className="photo-frame">
                                {displayImageUrl(b.imageUrl) ? (
                                  <img src={displayImageUrl(b.imageUrl)!} alt="" />
                                ) : (
                                  <span className="muted small">No preview</span>
                                )}
                              </div>
                              <div className="photo-meta">
                                <strong>{b.title}</strong>
                                <span className="small">
                                  <StatusBadge status={b.isActive ? 'PUBLISHED' : 'DRAFT'} /> {b.isActive && place.uses === 'first' && b.id !== live[0]?.id && <span className="muted">(not shown - only the first is used)</span>}
                                </span>
                                {b.linkUrl && <span className="muted small">Links to {b.linkUrl}</span>}
                                <Can anyOf={['cms:manage']}>
                                  <div className="row photo-actions">
                                    <button type="button" className="btn small" onClick={() => setEditing({ ...b })}>
                                      Edit
                                    </button>
                                    <button
                                      type="button"
                                      className="btn small"
                                      disabled={action.busy}
                                      onClick={async () => {
                                        if (await action.run(() => apiSend('PATCH', `/cms/banners/${b.id}`, { isActive: !b.isActive }), b.isActive ? `"${b.title}" is now a draft.` : `"${b.title}" is live.`)) banners.reload();
                                      }}
                                    >
                                      {b.isActive ? 'Switch off' : 'Make live'}
                                    </button>
                                    <button
                                      type="button"
                                      className="btn small"
                                      aria-label={`Move ${b.title} earlier`}
                                      disabled={i === 0 || action.busy}
                                      onClick={async () => {
                                        const prev = items[i - 1]!;
                                        const ok = await action.run(async () => {
                                          await apiSend('PATCH', `/cms/banners/${b.id}`, { sortOrder: prev.sortOrder });
                                          await apiSend('PATCH', `/cms/banners/${prev.id}`, { sortOrder: b.sortOrder === prev.sortOrder ? b.sortOrder + 1 : b.sortOrder });
                                        });
                                        if (ok) banners.reload();
                                      }}
                                    >
                                      ←
                                    </button>
                                  </div>
                                </Can>
                              </div>
                            </div>
                          ))}
                          {items.length === 0 && <span className="muted small">No banners.</span>}
                        </div>
                      </Section>
                    );
                  })}
                  {other.length > 0 && (
                    <Section title="Other placements (not shown on the storefront)">
                      <ul>
                        {other.map((b) => (
                          <li key={b.id}>
                            {b.title} - placement <span className="mono">{b.placement}</span>
                          </li>
                        ))}
                      </ul>
                    </Section>
                  )}
                  <p>
                    <a href={storefrontUrl('/')} target="_blank" rel="noopener noreferrer">
                      Open the storefront
                    </a>
                  </p>
                </div>
              );
            }}
          </DataState>
        )}
      </DataState>
      <Drawer open={editing !== null} title={editing?.id ? 'Edit banner' : 'New banner'} onClose={() => setEditing(null)}>
        {editing && (
          <BannerForm
            banner={editing}
            placements={placements.data?.banners ?? []}
            onDone={() => {
              setEditing(null);
              banners.reload();
            }}
          />
        )}
      </Drawer>
    </div>
  );
}

function BannerForm({ banner, placements, onDone }: { banner: Partial<Banner> & { placement: string }; placements: Placements['banners']; onDone: () => void }) {
  const [form, setForm] = useState({ title: banner.title ?? '', imageUrl: banner.imageUrl ?? '', linkUrl: banner.linkUrl ?? '', placement: banner.placement, isActive: banner.isActive ?? false });
  const action = useAction();
  const place = placements.find((p) => p.key === form.placement);
  const linkOk = safeLink(form.linkUrl);
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        if (!linkOk || !form.imageUrl) return;
        const body = { title: form.title, imageUrl: form.imageUrl, placement: form.placement, isActive: form.isActive, linkUrl: form.linkUrl.trim() || (banner.id ? null : undefined), ...(banner.id ? {} : { sortOrder: banner.sortOrder ?? 0 }) };
        const ok = await action.run(() => (banner.id ? apiSend('PATCH', `/cms/banners/${banner.id}`, body) : apiSend('POST', '/cms/banners', body)), 'Saved.');
        if (ok) onDone();
      }}
    >
      <ActionMessage message={action.message} />
      <SelectField label="Placement" value={form.placement} onChange={(v) => setForm((f) => ({ ...f, placement: v }))} options={placements.map((p) => ({ value: p.key, label: p.label }))} hint={place?.where} />
      <TextField label="Title" required value={form.title} onChange={(v) => setForm((f) => ({ ...f, title: v }))} hint={place?.fields.includes('title') ? 'Shown to shoppers here.' : 'For your reference; this placement does not show it.'} />
      <ImagePicker label="Image" value={form.imageUrl} onChange={(url) => setForm((f) => ({ ...f, imageUrl: url }))} />
      {!form.imageUrl && <span className="field-error">Choose an image.</span>}
      <TextField
        label="Link (optional)"
        value={form.linkUrl}
        placeholder="/category/formal-shirts or https://…"
        onChange={(v) => setForm((f) => ({ ...f, linkUrl: v }))}
        hint={!linkOk ? <span className="field-error">Use a page on this site (starting with /) or a full https:// address.</span> : place?.fields.includes('link') ? 'Where a tap on the banner goes.' : 'This placement does not use a link.'}
      />
      <Checkbox label="Live on the storefront (unticked = draft)" checked={form.isActive} onChange={(v) => setForm((f) => ({ ...f, isActive: v }))} />
      {form.isActive && <Notice kind="info">Shoppers see it within a minute of saving.</Notice>}
      <button className="primary" type="submit" disabled={action.busy || !linkOk || !form.imageUrl || !form.title.trim()}>
        {action.busy ? 'Saving…' : 'Save banner'}
      </button>
    </form>
  );
}
