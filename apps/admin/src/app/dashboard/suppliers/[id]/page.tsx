'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { SkuPicker, type SkuOption } from '@/components/pickers';
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
  PageHeader,
  Pagination,
  Section,
  StatusBadge,
  TextField,
  YesNo,
} from '@/components/ui';
import { apiSend, qs, type Page } from '@/lib/api';
import { useAction, useApi, useCan } from '@/lib/session';

interface Supplier {
  id: string;
  code: string;
  name: string;
  type: string;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  paymentTerms: string | null;
  leadTimeDays: number | null;
  isActive: boolean;
  createdAt: string;
}

interface Link_ {
  id: string;
  cost: number;
  currency: string;
  isPreferred: boolean;
  createdAt: string;
  sku: { id: string; skuCode: string; colour: { name: string }; size: { label: string } };
  style: { id: string; styleCode: string; name: string };
}

interface PoRow {
  id: string;
  poNumber: string;
  status: string;
  totalCost: number;
  createdAt: string;
}

const TAKE = 25;

export default function SupplierDetailPage() {
  const { id } = useParams<{ id: string }>();
  const supplier = useApi<Supplier>(`/suppliers/${id}`);
  const [skip, setSkip] = useState(0);
  const links = useApi<Page<Link_>>(`/admin/suppliers/${id}/sku-links${qs({ take: TAKE, skip })}`);
  // Only fetched for po:read holders, so the page never provokes a denied request.
  const canReadPos = useCan('po:read');
  const pos = useApi<Page<PoRow>>(canReadPos ? `/admin/purchase-orders${qs({ supplierId: id, take: 10 })}` : null);
  const action = useAction();
  const [sku, setSku] = useState<SkuOption | null>(null);
  const [cost, setCost] = useState('');
  const [preferred, setPreferred] = useState(false);
  const [confirmDeactivate, setConfirmDeactivate] = useState(false);

  return (
    <DataState state={supplier}>
      {(s) => (
        <div>
          <PageHeader
            title={s.name}
            description={
              <>
                <StatusBadge status={s.isActive ? 'ACTIVE' : 'INACTIVE'} /> <span className="mono">{s.code}</span>
              </>
            }
            breadcrumbs={[{ label: 'Procurement' }, { label: 'Suppliers', href: '/dashboard/suppliers' }, { label: s.name }]}
            actions={
              <>
                <Can anyOf={['po:create']}>
                  <Link className="btn" href={`/dashboard/purchase-orders/new?supplierId=${s.id}`}>
                    New purchase order
                  </Link>
                </Can>
                {s.isActive && (
                  <Can anyOf={['supplier:write']}>
                    <button type="button" className="btn danger" onClick={() => setConfirmDeactivate(true)}>
                      Deactivate
                    </button>
                  </Can>
                )}
              </>
            }
          />
          <ActionMessage message={action.message} />
          <div className="grid-2">
            <Section title="Details">
              <dl className="dl">
                <dt>Type</dt>
                <dd>{s.type === 'FINISHED_GOODS' ? 'Finished goods' : 'Manufacturing'}</dd>
                <dt>Contact</dt>
                <dd>{s.contactName ?? '—'}</dd>
                <dt>Email</dt>
                <dd>{s.contactEmail ?? '—'}</dd>
                <dt>Phone</dt>
                <dd>{s.contactPhone ?? '—'}</dd>
                <dt>Payment terms</dt>
                <dd>{s.paymentTerms ?? '—'}</dd>
                <dt>Lead time</dt>
                <dd>{s.leadTimeDays === null ? '—' : `${s.leadTimeDays} days`}</dd>
                <dt>Since</dt>
                <dd>
                  <DateText value={s.createdAt} />
                </dd>
              </dl>
            </Section>
            <Can anyOf={['po:read']}>
            <Section title="Recent purchase orders">
              <DataState state={pos}>
                {(p) => (
                  <DataTable
                    caption="Recent purchase orders"
                    rows={p.items}
                    rowKey={(r) => r.id}
                    empty="No purchase orders."
                    columns={[
                      {
                        header: 'PO',
                        cell: (r) => (
                          <Link href={`/dashboard/purchase-orders/${r.id}`}>
                            <Ident>{r.poNumber}</Ident>
                          </Link>
                        ),
                      },
                      { header: 'Status', cell: (r) => <StatusBadge status={r.status} /> },
                      { header: 'Total', numeric: true, cell: (r) => <Money value={r.totalCost} /> },
                      { header: 'Created', cell: (r) => <DateText value={r.createdAt} /> },
                    ]}
                  />
                )}
              </DataState>
            </Section>
            </Can>
          </div>

          <Section title="SKU cost links">
            <DataState state={links}>
              {(l) => (
                <>
                  <DataTable
                    caption="SKU cost links"
                    rows={l.items}
                    rowKey={(r) => r.id}
                    empty="No SKUs linked to this supplier yet."
                    columns={[
                      { header: 'SKU', cell: (r) => <Ident>{r.sku.skuCode}</Ident> },
                      {
                        header: 'Style',
                        cell: (r) => (
                          <Link href={`/dashboard/products/${r.style.id}`}>
                            {r.style.styleCode} · {r.style.name}
                          </Link>
                        ),
                      },
                      { header: 'Colour / size', cell: (r) => `${r.sku.colour.name} / ${r.sku.size.label}` },
                      { header: 'Cost', numeric: true, cell: (r) => <Money value={r.cost} currency={r.currency} /> },
                      { header: 'Preferred', cell: (r) => <YesNo value={r.isPreferred} /> },
                    ]}
                  />
                  <Pagination total={l.total} take={TAKE} skip={skip} onChange={setSkip} />
                </>
              )}
            </DataState>
            <Can anyOf={['supplier:write']}>
              <form
                style={{ marginTop: '0.75rem', maxWidth: 560 }}
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (!sku) return;
                  const ok = await action.run(
                    () => apiSend('POST', '/suppliers/sku-links', { supplierId: s.id, skuId: sku.id, styleId: sku.style.id, cost: Number(cost), isPreferred: preferred }),
                    `${sku.skuCode} linked at ₹${cost}.`,
                  );
                  if (ok) {
                    setSku(null);
                    setCost('');
                    setPreferred(false);
                    links.reload();
                  }
                }}
              >
                <h3>Link a SKU</h3>
                <SkuPicker value={sku} onChange={setSku} />
                <TextField label="Unit cost (INR)" type="number" step="0.01" required value={cost} onChange={setCost} />
                <Checkbox label="Preferred supplier for this SKU" checked={preferred} onChange={setPreferred} />
                <button className="primary" type="submit" disabled={!sku || action.busy}>
                  Save link
                </button>
              </form>
            </Can>
          </Section>

          <ConfirmDialog
            open={confirmDeactivate}
            title="Deactivate supplier"
            confirmLabel="Deactivate"
            danger
            busy={action.busy}
            onCancel={() => setConfirmDeactivate(false)}
            onConfirm={async () => {
              const ok = await action.run(() => apiSend('POST', `/suppliers/${s.id}/deactivate`), 'Supplier deactivated.');
              setConfirmDeactivate(false);
              if (ok) supplier.reload();
            }}
          >
            <p>Deactivated suppliers stay on existing purchase orders and history.</p>
          </ConfirmDialog>
        </div>
      )}
    </DataState>
  );
}
