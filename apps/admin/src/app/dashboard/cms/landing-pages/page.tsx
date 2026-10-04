'use client';

import { useState } from 'react';
import { ActionMessage, Can, ConfirmDialog, DataState, DataTable, DateText, Drawer, Notice, PageHeader, Section, StatusBadge, TextArea, TextField } from '@/components/ui';
import { ImagePicker } from '@/components/content/ImagePicker';
import { apiSend } from '@/lib/api';
import { storefrontUrl } from '@/lib/media';
import { useAction, useApi } from '@/lib/session';

interface LandingPage {
  id: string;
  slug: string;
  title: string;
  metaDescription: string | null;
  heroImageUrl: string | null;
  blockKeys: string[];
  isPublished: boolean;
  publishedAt: string | null;
  updatedAt: string;
}
interface Block {
  id: string;
  key: string;
  title: string;
  isActive: boolean;
}

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Content pages (e.g. Our Story) shown at /pages/<name> on the storefront.
 * A page is a draft until published; a published page changes on the
 * storefront as soon as it is saved. Text is shown as plain paragraphs -
 * the storefront never renders HTML from here.
 */
export default function LandingPagesPage() {
  const pages = useApi<LandingPage[]>('/cms/landing-pages');
  const blocks = useApi<Block[]>('/cms/content-blocks');
  const action = useAction();
  const [editing, setEditing] = useState<LandingPage | 'new' | null>(null);
  const [confirm, setConfirm] = useState<LandingPage | null>(null);

  return (
    <div>
      <PageHeader
        title="Content pages"
        breadcrumbs={[{ label: 'Content' }, { label: 'Content pages' }]}
        description="Pages such as Our Story. Link them from the footer in Navigation menus. Legal pages use their own fixed addresses."
        actions={
          <Can anyOf={['cms:manage']}>
            <button type="button" className="btn primary" onClick={() => setEditing('new')}>
              New page
            </button>
          </Can>
        }
      />
      <ActionMessage message={action.message} />
      <Section title="Pages">
        <DataState state={pages}>
          {(rows) => (
            <DataTable
              caption="Content pages"
              rows={rows}
              rowKey={(r) => r.id}
              empty="No pages yet."
              columns={[
                { header: 'Title', cell: (r) => r.title },
                { header: 'Address', cell: (r) => <span className="mono">{r.slug.startsWith('legal-') ? `/legal/${r.slug.slice(6)}` : `/pages/${r.slug}`}</span> },
                { header: 'Status', cell: (r) => <StatusBadge status={r.isPublished ? 'PUBLISHED' : 'DRAFT'} /> },
                { header: 'Updated', cell: (r) => <DateText value={r.updatedAt} withTime /> },
                {
                  header: 'Actions',
                  cell: (r) => (
                    <span className="row">
                      {r.isPublished && (
                        <a className="btn small" href={storefrontUrl(r.slug.startsWith('legal-') ? `/legal/${r.slug.slice(6)}` : `/pages/${r.slug}`)} target="_blank" rel="noopener noreferrer">
                          View
                        </a>
                      )}
                      <Can anyOf={['cms:manage']}>
                        <button type="button" className="btn small" onClick={() => setEditing(r)}>
                          Edit
                        </button>
                        <button type="button" className="btn small" disabled={action.busy} onClick={() => setConfirm(r)}>
                          {r.isPublished ? 'Unpublish' : 'Publish'}
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
      <ConfirmDialog
        open={confirm !== null}
        title={confirm?.isPublished ? `Unpublish "${confirm?.title}"?` : `Publish "${confirm?.title}"?`}
        confirmLabel={confirm?.isPublished ? 'Unpublish' : 'Publish'}
        danger={confirm?.isPublished}
        busy={action.busy}
        onCancel={() => setConfirm(null)}
        onConfirm={async () => {
          const page = confirm!;
          const ok = await action.run(() => apiSend('POST', `/cms/landing-pages/${page.id}/${page.isPublished ? 'unpublish' : 'publish'}`), page.isPublished ? 'Unpublished: shoppers now get "not found".' : 'Published.');
          setConfirm(null);
          if (ok) pages.reload();
        }}
      >
        <p>{confirm?.isPublished ? 'Footer links to it will lead to a "not found" page until it is published again.' : 'Shoppers can open it straight away.'}</p>
      </ConfirmDialog>
      <Drawer open={editing !== null} title={editing === 'new' ? 'New page' : 'Edit page'} onClose={() => setEditing(null)}>
        {editing && (
          <PageForm
            page={editing === 'new' ? null : editing}
            blocks={blocks.data ?? []}
            onDone={() => {
              setEditing(null);
              pages.reload();
            }}
          />
        )}
      </Drawer>
    </div>
  );
}

function PageForm({ page, blocks, onDone }: { page: LandingPage | null; blocks: Block[]; onDone: () => void }) {
  const [form, setForm] = useState({ slug: page?.slug ?? '', title: page?.title ?? '', metaDescription: page?.metaDescription ?? '', heroImageUrl: page?.heroImageUrl ?? '' });
  const [keys, setKeys] = useState<string[]>(Array.isArray(page?.blockKeys) ? page!.blockKeys : []);
  const action = useAction();
  const slugOk = page !== null || SLUG.test(form.slug);
  const available = blocks.filter((b) => !keys.includes(b.key));

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        if (!slugOk) return;
        const ok = await action.run(
          () =>
            page
              ? apiSend('PATCH', `/cms/landing-pages/${page.id}`, { title: form.title, metaDescription: form.metaDescription || null, heroImageUrl: form.heroImageUrl || null, blockKeys: keys })
              : apiSend('POST', '/cms/landing-pages', { slug: form.slug, title: form.title, metaDescription: form.metaDescription || undefined, heroImageUrl: form.heroImageUrl || undefined, blockKeys: keys }),
          'Saved.',
        );
        if (ok) onDone();
      }}
    >
      <ActionMessage message={action.message} />
      {page?.isPublished && <Notice kind="warning">This page is live: saving changes it on the storefront straight away.</Notice>}
      {page ? (
        <p>
          Address: <span className="mono">/pages/{page.slug}</span> (cannot be changed)
        </p>
      ) : (
        <TextField
          label="Address name"
          required
          value={form.slug}
          placeholder="our-story"
          onChange={(v) => setForm((f) => ({ ...f, slug: v.toLowerCase() }))}
          hint={slugOk ? `The page will be at /pages/${form.slug || '…'}` : <span className="field-error">Lower-case letters, digits and single dashes, e.g. our-story.</span>}
        />
      )}
      <TextField label="Title" required value={form.title} onChange={(v) => setForm((f) => ({ ...f, title: v }))} />
      <TextArea label="Search description" value={form.metaDescription} onChange={(v) => setForm((f) => ({ ...f, metaDescription: v }))} hint="One or two sentences shown by search engines." />
      <ImagePicker label="Top image (optional)" value={form.heroImageUrl} onChange={(url) => setForm((f) => ({ ...f, heroImageUrl: url }))} />
      <fieldset className="fieldset">
        <legend>Sections (content blocks), in order</legend>
        <ol>
          {keys.map((k, i) => {
            const b = blocks.find((x) => x.key === k);
            return (
              <li key={k} className="row" style={{ marginBottom: '0.35rem' }}>
                <span>{b ? b.title : <span className="muted">{k} (missing)</span>}</span>
                {b && !b.isActive && <span className="badge warning">hidden</span>}
                <button type="button" className="btn small" aria-label={`Move ${b?.title ?? k} up`} disabled={i === 0} onClick={() => setKeys((l) => { const n = [...l]; n.splice(i - 1, 0, n.splice(i, 1)[0]!); return n; })}>
                  ↑
                </button>
                <button type="button" className="btn small" aria-label={`Remove ${b?.title ?? k}`} onClick={() => setKeys((l) => l.filter((x) => x !== k))}>
                  Remove
                </button>
              </li>
            );
          })}
        </ol>
        {available.length > 0 ? (
          <div className="field">
            <label htmlFor="add-block">Add a section</label>
            <select id="add-block" value="" onChange={(e) => e.target.value && setKeys((l) => [...l, e.target.value])}>
              <option value="">Choose a content block</option>
              {available.map((b) => (
                <option key={b.key} value={b.key}>
                  {b.title}
                </option>
              ))}
            </select>
          </div>
        ) : (
          <p className="muted small">Write sections under Content → Content blocks.</p>
        )}
      </fieldset>
      <button className="primary" type="submit" disabled={action.busy || !form.title.trim() || !slugOk}>
        {action.busy ? 'Saving…' : page ? 'Save page' : 'Save as draft'}
      </button>
    </form>
  );
}
