'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { LocationSelect, SkuPicker, SupplierPicker, type SkuOption, type SupplierOption } from '@/components/pickers';
import { ActionMessage, PageHeader, Section, TextField } from '@/components/ui';
import { apiFetch, apiSend } from '@/lib/api';
import { useAction } from '@/lib/session';

interface DraftLine {
  key: number;
  sku: SkuOption | null;
  orderedQty: string;
  unitCost: string;
}

/**
 * Creates a DRAFT purchase order (POST /procurement/purchase-orders). The
 * total, approval threshold and every status change are the procurement
 * service's; submission and approval happen on the PO's own page.
 */
export default function NewPurchaseOrderPage() {
  const router = useRouter();
  const action = useAction();
  const [supplier, setSupplier] = useState<SupplierOption | null>(null);
  const [locationId, setLocationId] = useState('');
  const [expectedDate, setExpectedDate] = useState('');
  const [lines, setLines] = useState<DraftLine[]>([{ key: 1, sku: null, orderedQty: '', unitCost: '' }]);

  // Deep link from a supplier page: ?supplierId=...
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('supplierId');
    if (id) {
      apiFetch<SupplierOption>(`/suppliers/${id}`)
        .then(setSupplier)
        .catch(() => undefined);
    }
  }, []);

  const update = (key: number, patch: Partial<DraftLine>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!supplier) return;
    let id = '';
    const ok = await action.run(async () => {
      id = (
        await apiSend<{ id: string }>('POST', '/procurement/purchase-orders', {
          supplierId: supplier.id,
          locationId,
          expectedDate: expectedDate || undefined,
          lines: lines.filter((l) => l.sku).map((l) => ({ skuId: l.sku!.id, orderedQty: Number(l.orderedQty), unitCost: Number(l.unitCost) })),
        })
      ).id;
    });
    if (ok) router.push(`/dashboard/purchase-orders/${id}`);
  }

  return (
    <div style={{ maxWidth: 900 }}>
      <PageHeader
        title="New purchase order"
        description="The order is saved as a draft. Submit it for approval from its page."
        breadcrumbs={[{ label: 'Procurement' }, { label: 'Purchase orders', href: '/dashboard/purchase-orders' }, { label: 'New' }]}
      />
      <form onSubmit={onSubmit}>
        <ActionMessage message={action.message} />
        <Section title="Supplier and delivery">
          <div className="form-row">
            <SupplierPicker value={supplier} onChange={setSupplier} required />
            <LocationSelect label="Deliver to" value={locationId} onChange={setLocationId} required />
            <TextField label="Expected date" type="date" value={expectedDate} onChange={setExpectedDate} />
          </div>
        </Section>
        <Section
          title="Lines"
          actions={
            <button
              type="button"
              className="btn small"
              onClick={() => setLines((ls) => [...ls, { key: Math.max(0, ...ls.map((l) => l.key)) + 1, sku: null, orderedQty: '', unitCost: '' }])}
            >
              Add line
            </button>
          }
        >
          {lines.map((l, i) => (
            <fieldset key={l.key} className="card" style={{ background: 'var(--color-surface-muted)' }}>
              <legend className="muted">Line {i + 1}</legend>
              <SkuPicker value={l.sku} onChange={(sku) => update(l.key, { sku })} />
              <div className="form-row">
                <TextField label="Quantity" type="number" min={1} required value={l.orderedQty} onChange={(v) => update(l.key, { orderedQty: v })} />
                <TextField label="Unit cost (INR)" type="number" step="0.01" required value={l.unitCost} onChange={(v) => update(l.key, { unitCost: v })} />
              </div>
              {lines.length > 1 && (
                <button type="button" className="btn small" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}>
                  Remove line {i + 1}
                </button>
              )}
            </fieldset>
          ))}
        </Section>
        <button className="primary" type="submit" disabled={action.busy || !supplier || !locationId || lines.every((l) => !l.sku)}>
          {action.busy ? 'Saving…' : 'Save draft purchase order'}
        </button>
      </form>
    </div>
  );
}
