'use client';

import Link from 'next/link';
import { useState } from 'react';
import { ActionMessage, Can, DataState, DataTable, Drawer, PageHeader, Pagination, SelectField, StatusBadge, TextField } from '@/components/ui';
import { apiSend, qs, type Page } from '@/lib/api';
import { useAction, useApi, useDebounced, useUrlFilter } from '@/lib/session';

interface SupplierRow {
  id: string;
  code: string;
  name: string;
  type: string;
  contactName: string | null;
  leadTimeDays: number | null;
  paymentTerms: string | null;
  isActive: boolean;
  _count: { supplierSkus: number; purchaseOrders: number };
}

const TAKE = 25;
const TYPES = [
  { value: 'FINISHED_GOODS', label: 'Finished goods' },
  { value: 'MANUFACTURING', label: 'Manufacturing' },
];

export default function SuppliersPage() {
  const [q, setQ] = useUrlFilter('q');
  const [type, setType, ready] = useUrlFilter('type');
  const [skip, setSkip] = useState(0);
  const term = useDebounced(q);
  const suppliers = useApi<Page<SupplierRow>>(ready ? `/admin/suppliers${qs({ q: term, type, take: TAKE, skip })}` : null);
  const [creating, setCreating] = useState(false);

  return (
    <div>
      <PageHeader
        title="Suppliers"
        breadcrumbs={[{ label: 'Procurement' }, { label: 'Suppliers' }]}
        actions={
          <Can anyOf={['supplier:write']}>
            <button type="button" className="primary" onClick={() => setCreating(true)}>
              New supplier
            </button>
          </Can>
        }
      />
      <div className="filter-bar" role="search">
        <TextField
          label="Search"
          value={q}
          placeholder="Name or code"
          onChange={(v) => {
            setQ(v);
            setSkip(0);
          }}
        />
        <SelectField
          label="Type"
          value={type}
          placeholder="All types"
          options={TYPES}
          onChange={(v) => {
            setType(v);
            setSkip(0);
          }}
        />
      </div>
      <DataState state={suppliers}>
        {(data) => (
          <>
            <DataTable
              caption="Suppliers"
              rows={data.items}
              rowKey={(r) => r.id}
              empty="No suppliers match."
              columns={[
                { header: 'Name', cell: (r) => <Link href={`/dashboard/suppliers/${r.id}`}>{r.name}</Link> },
                { header: 'Code', cell: (r) => <span className="mono">{r.code}</span> },
                { header: 'Type', cell: (r) => TYPES.find((t) => t.value === r.type)?.label ?? r.type },
                { header: 'Contact', cell: (r) => r.contactName ?? '—' },
                { header: 'Lead time (days)', numeric: true, cell: (r) => r.leadTimeDays ?? '—' },
                { header: 'SKU links', numeric: true, cell: (r) => r._count.supplierSkus },
                { header: 'POs', numeric: true, cell: (r) => r._count.purchaseOrders },
                { header: 'Status', cell: (r) => <StatusBadge status={r.isActive ? 'ACTIVE' : 'INACTIVE'} /> },
              ]}
            />
            <Pagination total={data.total} take={TAKE} skip={skip} onChange={setSkip} />
          </>
        )}
      </DataState>
      <Drawer open={creating} title="New supplier" onClose={() => setCreating(false)}>
        <NewSupplierForm
          onCreated={() => {
            setCreating(false);
            suppliers.reload();
          }}
        />
      </Drawer>
    </div>
  );
}

function NewSupplierForm({ onCreated }: { onCreated: () => void }) {
  const action = useAction();
  const [f, setF] = useState({ code: '', name: '', type: 'FINISHED_GOODS', contactName: '', contactEmail: '', contactPhone: '', paymentTerms: '', leadTimeDays: '' });
  const set = (k: keyof typeof f) => (v: string) => setF((x) => ({ ...x, [k]: v }));
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        const ok = await action.run(() =>
          apiSend('POST', '/suppliers', {
            code: f.code,
            name: f.name,
            type: f.type,
            contactName: f.contactName || undefined,
            contactEmail: f.contactEmail || undefined,
            contactPhone: f.contactPhone || undefined,
            paymentTerms: f.paymentTerms || undefined,
            leadTimeDays: f.leadTimeDays ? Number(f.leadTimeDays) : undefined,
          }),
        );
        if (ok) onCreated();
      }}
    >
      <ActionMessage message={action.message} />
      <TextField label="Supplier code" required value={f.code} onChange={set('code')} />
      <TextField label="Supplier name" required value={f.name} onChange={set('name')} />
      <SelectField label="Supplier type" value={f.type} onChange={set('type')} options={TYPES} />
      <TextField label="Contact name" value={f.contactName} onChange={set('contactName')} />
      <TextField label="Contact email" type="email" value={f.contactEmail} onChange={set('contactEmail')} />
      <TextField label="Contact phone" value={f.contactPhone} onChange={set('contactPhone')} />
      <TextField label="Payment terms" value={f.paymentTerms} onChange={set('paymentTerms')} />
      <TextField label="Lead time (days)" type="number" min={0} value={f.leadTimeDays} onChange={set('leadTimeDays')} />
      <button className="primary" type="submit" disabled={action.busy}>
        Create supplier
      </button>
    </form>
  );
}
