'use client';

import Link from 'next/link';
import { useState } from 'react';
import { ActionMessage, Can, DataState, DataTable, DateText, PageHeader, Pagination, Section, StatusBadge, TextField } from '@/components/ui';
import { apiSend, qs, type Page } from '@/lib/api';
import { useAction, useApi } from '@/lib/session';

interface CollectionRow {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  isActive: boolean;
  createdAt: string;
  _count: { styles: number };
}

export default function CollectionsPage() {
  const [skip, setSkip] = useState(0);
  const take = 50;
  const collections = useApi<Page<CollectionRow>>(`/admin/catalog/collections${qs({ take, skip })}`);
  const action = useAction();
  const [form, setForm] = useState({ name: '', slug: '', description: '' });

  return (
    <div>
      <PageHeader
        title="Collections"
        description="Curated groups of styles. Published collections appear on the storefront."
        breadcrumbs={[{ label: 'Merchandise' }, { label: 'Collections' }]}
      />
      <Can anyOf={['catalog:collection:manage']}>
        <Section title="New collection">
          <ActionMessage message={action.message} />
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const ok = await action.run(
                () => apiSend('POST', '/catalog/collections', { name: form.name, slug: form.slug, description: form.description || undefined }),
                'Collection created.',
              );
              if (ok) {
                setForm({ name: '', slug: '', description: '' });
                collections.reload();
              }
            }}
          >
            <div className="form-row">
              <TextField label="Name" required value={form.name} onChange={(v) => setForm((f) => ({ ...f, name: v }))} />
              <TextField label="Slug" required value={form.slug} placeholder="summer-edit" onChange={(v) => setForm((f) => ({ ...f, slug: v }))} />
              <TextField label="Description" value={form.description} onChange={(v) => setForm((f) => ({ ...f, description: v }))} />
            </div>
            <button className="primary" type="submit" disabled={action.busy}>
              Create collection
            </button>
          </form>
        </Section>
      </Can>
      <DataState state={collections}>
        {(data) => (
          <>
          <DataTable
            caption="Collections"
            rows={data.items}
            rowKey={(r) => r.id}
            empty="No collections yet."
            columns={[
              { header: 'Name', cell: (r) => <Link href={`/dashboard/collections/${r.id}`}>{r.name}</Link> },
              { header: 'Slug', cell: (r) => <span className="mono">{r.slug}</span> },
              { header: 'Status', cell: (r) => <StatusBadge status={r.isActive ? 'PUBLISHED' : 'UNPUBLISHED'} /> },
              { header: 'Styles', numeric: true, cell: (r) => r._count.styles },
              { header: 'Created', cell: (r) => <DateText value={r.createdAt} /> },
            ]}
          />
          <Pagination total={data.total} take={take} skip={skip} onChange={setSkip} />
          </>
        )}
      </DataState>
    </div>
  );
}
