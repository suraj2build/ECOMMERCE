'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { StylePicker, type StyleOption } from '@/components/pickers';
import { ActionMessage, Can, DataState, DataTable, Ident, PageHeader, Pagination, Section, StatusBadge } from '@/components/ui';
import { apiSend, qs } from '@/lib/api';
import { useAction, useApi } from '@/lib/session';

interface CollectionDetail {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  isActive: boolean;
  _count: { styles: number };
  styles: Array<{ style: { id: string; styleCode: string; name: string; lifecycleState: string } }>;
}

export default function CollectionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [skip, setSkip] = useState(0);
  const take = 50;
  const collection = useApi<CollectionDetail>(`/admin/catalog/collections/${id}${qs({ take, skip })}`);
  const action = useAction();
  const [style, setStyle] = useState<StyleOption | null>(null);

  return (
    <DataState state={collection}>
      {(c) => (
        <div>
          <PageHeader
            title={c.name}
            description={
              <>
                <StatusBadge status={c.isActive ? 'PUBLISHED' : 'UNPUBLISHED'} /> <span className="mono">{c.slug}</span> {c.description && `· ${c.description}`}
              </>
            }
            breadcrumbs={[{ label: 'Merchandise' }, { label: 'Collections', href: '/dashboard/collections' }, { label: c.name }]}
            actions={
              <Can anyOf={['catalog:publish']}>
                <button
                  type="button"
                  className={c.isActive ? 'btn danger' : 'primary'}
                  disabled={action.busy}
                  onClick={async () => {
                    const path = c.isActive ? 'unpublish' : 'publish';
                    if (await action.run(() => apiSend('POST', `/catalog/collections/${c.id}/${path}`), c.isActive ? 'Collection unpublished.' : 'Collection published.'))
                      collection.reload();
                  }}
                >
                  {c.isActive ? 'Unpublish collection' : 'Publish collection'}
                </button>
              </Can>
            }
          />
          <ActionMessage message={action.message} />
          <Can anyOf={['catalog:collection:manage']}>
            <Section title="Add a style">
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (!style) return;
                  if (await action.run(() => apiSend('POST', `/catalog/collections/${c.id}/styles`, { styleId: style.id }), `${style.styleCode} added.`)) {
                    setStyle(null);
                    collection.reload();
                  }
                }}
              >
                <StylePicker value={style} onChange={setStyle} />
                <button className="primary" type="submit" disabled={!style || action.busy}>
                  Add to collection
                </button>
              </form>
            </Section>
          </Can>
          <DataTable
            caption="Styles in this collection"
            rows={c.styles.map((s) => s.style)}
            rowKey={(s) => s.id}
            empty="No styles in this collection."
            columns={[
              {
                header: 'Style',
                cell: (s) => (
                  <Link href={`/dashboard/products/${s.id}`}>
                    <Ident>{s.styleCode}</Ident>
                  </Link>
                ),
              },
              { header: 'Name', cell: (s) => s.name },
              { header: 'State', cell: (s) => <StatusBadge status={s.lifecycleState} /> },
              {
                header: 'Actions',
                cell: (s) => (
                  <Can anyOf={['catalog:collection:manage']}>
                    <button
                      type="button"
                      className="btn small"
                      disabled={action.busy}
                      onClick={async () => {
                        if (await action.run(() => apiSend('DELETE', `/catalog/collections/${c.id}/styles/${s.id}`), `${s.styleCode} removed.`)) collection.reload();
                      }}
                    >
                      Remove
                    </button>
                  </Can>
                ),
              },
            ]}
          />
          <Pagination total={c._count.styles} take={take} skip={skip} onChange={setSkip} />
        </div>
      )}
    </DataState>
  );
}
