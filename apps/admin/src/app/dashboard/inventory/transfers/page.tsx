'use client';

import { useState } from 'react';
import { LocationSelect, SkuPicker, type SkuOption } from '@/components/pickers';
import { ActionMessage, Can, ConfirmDialog, DataState, DataTable, DateText, Ident, PageHeader, Pagination, Section, SelectField, StatusBadge, TextField } from '@/components/ui';
import { apiSend, qs, type Page } from '@/lib/api';
import { useAction, useApi, useCan, useUrlFilter } from '@/lib/session';

interface TransferRow {
  id: string;
  quantity: number;
  status: string;
  createdAt: string;
  completedAt: string | null;
  sku: { id: string; skuCode: string; style: { name: string } };
  fromLocation: { id: string; name: string; code: string };
  toLocation: { id: string; name: string; code: string };
}

const TAKE = 50;

/**
 * Stock transfers. Sending posts TRANSFER_OUT at the source (the stock is
 * in transit); receiving posts TRANSFER_IN at the destination. Both are
 * the inventory service's own transitions.
 */
export default function TransfersPage() {
  const canRead = useCan('inventory:read');
  const [status, setStatus, ready] = useUrlFilter('status');
  const [skip, setSkip] = useState(0);
  const transfers = useApi<Page<TransferRow>>(canRead && ready ? `/admin/inventory/transfers${qs({ status, take: TAKE, skip })}` : null);
  const action = useAction();
  const [receiving, setReceiving] = useState<TransferRow | null>(null);

  return (
    <div>
      <PageHeader title="Stock transfers" breadcrumbs={[{ label: 'Inventory' }, { label: 'Transfers' }]} />
      <ActionMessage message={action.message} />
      <Can anyOf={['inventory:transfer']}>
        <NewTransfer onSent={transfers.reload} />
      </Can>
      <Can anyOf={['inventory:read']}>
        <div className="filter-bar">
          <SelectField
            label="Status"
            value={status}
            placeholder="All statuses"
            options={['IN_TRANSIT', 'COMPLETED', 'CANCELLED'].map((s) => ({ value: s, label: s.replace('_', ' ').toLowerCase() }))}
            onChange={(v) => {
              setStatus(v);
              setSkip(0);
            }}
          />
        </div>
        <DataState state={transfers}>
          {(data) => (
            <>
              <DataTable
                caption="Transfers"
                rows={data.items}
                rowKey={(r) => r.id}
                empty="No transfers."
                columns={[
                  { header: 'SKU', cell: (r) => <Ident>{r.sku.skuCode}</Ident> },
                  { header: 'Item', cell: (r) => r.sku.style.name },
                  { header: 'From', cell: (r) => r.fromLocation.name },
                  { header: 'To', cell: (r) => r.toLocation.name },
                  { header: 'Qty', numeric: true, cell: (r) => r.quantity },
                  { header: 'Status', cell: (r) => <StatusBadge status={r.status} /> },
                  { header: 'Sent', cell: (r) => <DateText value={r.createdAt} withTime /> },
                  { header: 'Received', cell: (r) => <DateText value={r.completedAt} withTime /> },
                  {
                    header: 'Actions',
                    cell: (r) =>
                      r.status === 'IN_TRANSIT' ? (
                        <Can anyOf={['inventory:transfer']}>
                          <button type="button" className="btn small" onClick={() => setReceiving(r)}>
                            Receive
                          </button>
                        </Can>
                      ) : null,
                  },
                ]}
              />
              <Pagination total={data.total} take={TAKE} skip={skip} onChange={setSkip} />
            </>
          )}
        </DataState>
      </Can>
      <ConfirmDialog
        open={receiving !== null}
        title="Receive transfer"
        confirmLabel="Receive"
        busy={action.busy}
        onCancel={() => setReceiving(null)}
        onConfirm={async () => {
          if (!receiving) return;
          const r = receiving;
          const ok = await action.run(() => apiSend('POST', `/inventory/transfers/${r.id}/in`), `Received ${r.quantity} × ${r.sku.skuCode} at ${r.toLocation.name}.`);
          setReceiving(null);
          if (ok) transfers.reload();
        }}
      >
        <p>
          Confirm {receiving?.quantity} × <span className="mono">{receiving?.sku.skuCode}</span> arrived at {receiving?.toLocation.name}.
        </p>
      </ConfirmDialog>
    </div>
  );
}

function NewTransfer({ onSent }: { onSent: () => void }) {
  const action = useAction();
  const [sku, setSku] = useState<SkuOption | null>(null);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [quantity, setQuantity] = useState('');
  return (
    <Section title="Send stock to another location">
      <ActionMessage message={action.message} />
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (!sku) return;
          const ok = await action.run(
            () => apiSend('POST', '/inventory/transfers/out', { skuId: sku.id, fromLocationId: from, toLocationId: to, quantity: Number(quantity) }),
            `Transfer sent: ${quantity} × ${sku.skuCode}.`,
          );
          if (ok) {
            setQuantity('');
            onSent();
          }
        }}
      >
        <SkuPicker value={sku} onChange={setSku} />
        <div className="form-row">
          <LocationSelect label="From location" value={from} onChange={setFrom} required />
          <LocationSelect label="To location" value={to} onChange={setTo} required />
          <TextField label="Quantity" type="number" min={1} required value={quantity} onChange={setQuantity} />
        </div>
        <button className="primary" type="submit" disabled={!sku || action.busy}>
          Send transfer
        </button>
      </form>
    </Section>
  );
}
