'use client';

import { useEffect, useMemo, useState } from 'react';
import { ActionMessage, Can, DataState, Notice, PageHeader, Section, SelectField, TextField } from '@/components/ui';
import { apiSend, type Page } from '@/lib/api';
import { storefrontUrl } from '@/lib/media';
import { useAction, useApi, useCan } from '@/lib/session';
import type { ReferenceData } from '@/components/product-workspace/types';

interface Menu {
  id: string;
  key: string;
  items: Array<{ label: string; url: string; sortOrder?: number }>;
  updatedAt: string;
}
interface Placements {
  menus: Array<{ key: string; label: string; where: string; linkRule: string }>;
  unreadMenus: Record<string, string>;
}
interface LandingPage {
  id: string;
  slug: string;
  title: string;
  isPublished: boolean;
}

type LinkKind = 'page' | 'category' | 'collection' | 'web' | 'path';
interface Item {
  label: string;
  kind: LinkKind;
  url: string;
}

/** The same rule the server enforces: a site path (not //host) or an https address. */
function linkProblem(url: string): string | null {
  const v = url.trim();
  if (!v) return 'Choose where it links to.';
  if (v.startsWith('/') && !v.startsWith('//')) return /\s/.test(v) ? 'A site path cannot contain spaces.' : null;
  try {
    const u = new URL(v);
    return u.protocol === 'https:' ? null : 'Web addresses must start with https://';
  } catch {
    return 'Enter a full web address (https://…) or a page on this site.';
  }
}

function kindOf(url: string): LinkKind {
  if (url.startsWith('/pages/')) return 'page';
  if (url.startsWith('/category/')) return 'category';
  if (url.startsWith('/collections/')) return 'collection';
  if (/^https?:\/\//.test(url)) return 'web';
  return 'path';
}

/**
 * Visual menu editor (Admin Ops Phase 1). Lists the menus the storefront
 * actually reads and says plainly that the header navigation is part of the
 * design and is not read from any menu. Items link to a content page,
 * category, collection or https address; the server checks every link.
 */
export default function NavigationMenusPage() {
  const placements = useApi<Placements>('/cms/placements');
  const menus = useApi<Menu[]>('/cms/navigation-menus');
  const pages = useApi<LandingPage[]>('/cms/landing-pages');
  const reference = useApi<ReferenceData>('/products/reference');
  const collections = useApi<Page<{ id: string; name: string; slug: string; isActive: boolean }>>('/admin/catalog/collections?take=200');
  const canEdit = useCan('cms:manage');
  const [key, setKey] = useState('footer-about');
  const [items, setItems] = useState<Item[]>([]);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [showErrors, setShowErrors] = useState(false);
  const action = useAction();
  const clearMessage = action.clear;

  const current = menus.data?.find((m) => m.key === key);
  useEffect(() => {
    if (!menus.data || loadedKey === key) return;
    const found = menus.data.find((m) => m.key === key);
    setItems(
      [...(found?.items ?? [])]
        .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
        .map((i) => ({ label: i.label, url: i.url, kind: kindOf(i.url) })),
    );
    setLoadedKey(key);
    setShowErrors(false);
    clearMessage();
  }, [menus.data, key, loadedKey, clearMessage]);

  const placement = placements.data?.menus.find((m) => m.key === key);
  const unreadNote = placements.data?.unreadMenus[key];
  const isSocial = key === 'footer-social';
  const problems = items.map((i) => (!i.label.trim() ? 'Give the link a label.' : i.label.trim().length > 60 ? 'Keep the label to 60 characters.' : linkProblem(i.url)));
  const saved = useMemo(() => JSON.stringify((current?.items ?? []).map((i) => [i.label, i.url])), [current]);
  const dirty = JSON.stringify(items.map((i) => [i.label.trim(), i.url.trim()])) !== saved;

  const update = (index: number, patch: Partial<Item>) => setItems((list) => list.map((it, i) => (i === index ? { ...it, ...patch } : it)));
  const move = (index: number, delta: -1 | 1) =>
    setItems((list) => {
      const next = [...list];
      const [it] = next.splice(index, 1);
      next.splice(index + delta, 0, it!);
      return next;
    });

  async function save() {
    setShowErrors(true);
    if (problems.some(Boolean)) return;
    const ok = await action.run(
      () => apiSend('PUT', `/cms/navigation-menus/${key}`, { items: items.map((i, idx) => ({ label: i.label.trim(), url: i.url.trim(), sortOrder: idx + 1 })) }),
      placement ? 'Saved. The storefront footer shows the change within a minute.' : 'Saved. Note: the storefront does not read this menu.',
    );
    if (ok) menus.reload();
  }

  const otherKeys = (menus.data ?? []).map((m) => m.key).filter((k) => !placements.data?.menus.some((p) => p.key === k));

  return (
    <div>
      <PageHeader
        title="Navigation menus"
        breadcrumbs={[{ label: 'Content' }, { label: 'Navigation menus' }]}
        description="Links in the storefront footer. The header navigation is part of the approved design and is not edited here."
      />
      <DataState state={placements}>
        {(p) => (
          <div className="grid-2" style={{ gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr)' }}>
            <Section title="Edit a menu">
              <SelectField
                label="Menu"
                value={key}
                onChange={(v) => {
                  if (dirty && !window.confirm('Discard your unsaved changes to this menu?')) return;
                  setKey(v);
                }}
                options={[
                  ...p.menus.map((m) => ({ value: m.key, label: `${m.label} (shown on the storefront)` })),
                  ...Object.keys(p.unreadMenus).map((k) => ({ value: k, label: `${k} (not read by the storefront)` })),
                  ...otherKeys.filter((k) => !(k in p.unreadMenus)).map((k) => ({ value: k, label: `${k} (not read by the storefront)` })),
                ]}
                hint={placement ? `${placement.where}. ${placement.linkRule}.` : undefined}
              />
              {unreadNote && <Notice kind="warning">{unreadNote}</Notice>}
              {!placement && !unreadNote && <Notice kind="warning">The storefront does not read this menu, so saving it changes nothing shoppers see.</Notice>}
              <ActionMessage message={action.message} />
              {showErrors && problems.some(Boolean) && <Notice kind="error">Some links need attention - see the highlighted rows.</Notice>}
              <ol className="menu-items" aria-label="Menu links in order">
                {items.map((item, index) => (
                  <li key={index} className="menu-item">
                    <span className="muted">{index + 1}.</span>
                    <TextField label="Label" value={item.label} onChange={(v) => update(index, { label: v })} hint={showErrors && !item.label.trim() ? 'Required.' : undefined} />
                    <div className="stack">
                      {!isSocial && (
                        <SelectField
                          label="Links to"
                          value={item.kind}
                          onChange={(v) => update(index, { kind: v as LinkKind, url: v === 'web' ? 'https://' : '' })}
                          options={[
                            { value: 'page', label: 'A content page' },
                            { value: 'category', label: 'A category' },
                            { value: 'collection', label: 'A collection' },
                            { value: 'web', label: 'A web address' },
                            { value: 'path', label: 'Another page on this site' },
                          ]}
                        />
                      )}
                      {item.kind === 'page' && !isSocial && (
                        <SelectField
                          label="Page"
                          value={item.url}
                          onChange={(v) => update(index, { url: v })}
                          placeholder="Choose a page"
                          options={(pages.data ?? [])
                            .filter((pg) => !pg.slug.startsWith('legal-'))
                            .map((pg) => ({ value: `/pages/${pg.slug}`, label: `${pg.title}${pg.isPublished ? '' : ' (draft - shoppers get "not found" until published)'}` }))}
                        />
                      )}
                      {item.kind === 'category' && !isSocial && (
                        <SelectField
                          label="Category"
                          value={item.url}
                          onChange={(v) => update(index, { url: v })}
                          placeholder="Choose a category"
                          options={(reference.data?.categories ?? []).map((c) => ({ value: `/category/${c.slug}`, label: c.name }))}
                        />
                      )}
                      {item.kind === 'collection' && !isSocial && (
                        <SelectField
                          label="Collection"
                          value={item.url}
                          onChange={(v) => update(index, { url: v })}
                          placeholder="Choose a collection"
                          options={(collections.data?.items ?? []).map((c) => ({ value: `/collections/${c.slug}`, label: `${c.name}${c.isActive ? '' : ' (not live)'}` }))}
                        />
                      )}
                      {(item.kind === 'web' || item.kind === 'path' || isSocial) && (
                        <TextField
                          label={item.kind === 'path' && !isSocial ? 'Site path' : 'Web address'}
                          value={item.url}
                          placeholder={item.kind === 'path' && !isSocial ? '/collections/workday' : 'https://instagram.com/yourbrand'}
                          onChange={(v) => update(index, { url: v })}
                        />
                      )}
                      {showErrors && problems[index] && (
                        <span className="field-error" role="alert">
                          {problems[index]}
                        </span>
                      )}
                    </div>
                    <div className="row">
                      <button type="button" className="btn small" aria-label={`Move ${item.label || 'link'} up`} disabled={index === 0} onClick={() => move(index, -1)}>
                        ↑
                      </button>
                      <button type="button" className="btn small" aria-label={`Move ${item.label || 'link'} down`} disabled={index === items.length - 1} onClick={() => move(index, 1)}>
                        ↓
                      </button>
                      <button type="button" className="btn small danger" aria-label={`Remove ${item.label || 'link'}`} onClick={() => setItems((l) => l.filter((_, i) => i !== index))}>
                        Remove
                      </button>
                    </div>
                  </li>
                ))}
              </ol>
              {items.length === 0 && <p className="muted">No links. {placement ? 'The footer shows only its built-in links here.' : ''}</p>}
              <Can anyOf={['cms:manage']}>
                <div className="row">
                  <button type="button" className="btn" disabled={items.length >= 50} onClick={() => setItems((l) => [...l, { label: '', kind: isSocial ? 'web' : 'page', url: isSocial ? 'https://' : '' }])}>
                    Add a link
                  </button>
                  <button type="button" className="primary" disabled={action.busy || !dirty} onClick={() => void save()}>
                    {action.busy ? 'Saving…' : dirty ? 'Save menu' : 'Saved'}
                  </button>
                  {dirty && (
                    <button type="button" className="btn" onClick={() => setLoadedKey(null)}>
                      Undo changes
                    </button>
                  )}
                </div>
              </Can>
              {!canEdit && <p className="muted">You can view menus; editing needs the content permission.</p>}
            </Section>
            <Section title="Preview">
              <p className="muted small" style={{ marginTop: 0 }}>
                {placement ? placement.where : 'Not shown on the storefront.'}
              </p>
              <ul className="stack" style={{ listStyle: 'none', padding: 0 }}>
                {items.map((i, idx) => (
                  <li key={idx}>{i.label.trim() ? <span style={{ textDecoration: problems[idx] ? 'line-through' : 'underline' }}>{i.label}</span> : <span className="muted">(no label)</span>}</li>
                ))}
              </ul>
              {placement && (
                <a href={storefrontUrl('/')} target="_blank" rel="noopener noreferrer">
                  Open the storefront
                </a>
              )}
            </Section>
          </div>
        )}
      </DataState>
    </div>
  );
}
