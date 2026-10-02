'use client';

import { useState } from 'react';
import { PoTable, type PoRow } from '@/components/po-table';
import { Can, DataState, DataTable, DateText, Ident, PageHeader, Pagination, Section } from '@/components/ui';
import { qs, type Page } from '@/lib/api';
import { useApi, useCan } from '@/lib/session';

interface GrnRow {
  id: string;
  grnNumber: string;
  poId: string;
  createdAt: string;
  lines: Array<{ id: string }>;
}

/**
 * Goods-receiving queue: approved and part-received POs (open the PO to
 * receive against it), plus the latest goods receipts.
 */
export default function ReceivingPage() {
  const [approvedSkip, setApprovedSkip] = useState(0);
  const [partialSkip, setPartialSkip] = useState(0);
  const [grnSkip, setGrnSkip] = useState(0);
  const canReadPo = useCan('po:read');
  const canReadGrn = useCan('grn:read');
  const approved = useApi<Page<PoRow>>(canReadPo ? `/admin/purchase-orders${qs({ status: 'APPROVED', take: 50, skip: approvedSkip })}` : null);
  const partial = useApi<Page<PoRow>>(canReadPo ? `/admin/purchase-orders${qs({ status: 'PARTIALLY_RECEIVED', take: 50, skip: partialSkip })}` : null);
  const grns = useApi<GrnRow[]>(canReadGrn ? `/grn${qs({ take: 20, skip: grnSkip })}` : null);
  const poIds = [...new Set((grns.data ?? []).map((g) => g.poId))];
  const labels = useApi<{ purchaseOrders: Record<string, string> }>(canReadPo && poIds.length ? `/admin/lookup/labels${qs({ purchaseOrderIds: poIds.join(',') })}` : null);

  return (
    <div>
      <PageHeader
        title="Goods receiving"
        description="Purchase orders ready to receive. Open one to record a goods receipt with QC outcomes."
        breadcrumbs={[{ label: 'Procurement' }, { label: 'Goods receiving' }]}
      />
      <Can anyOf={['po:read']}>
        <Section title="Approved - awaiting first receipt">
          <DataState state={approved}>{(d) => <><PoTable rows={d.items} /><Pagination total={d.total} take={50} skip={approvedSkip} onChange={setApprovedSkip} /></>}</DataState>
        </Section>
        <Section title="Partially received">
          <DataState state={partial}>{(d) => <><PoTable rows={d.items} /><Pagination total={d.total} take={50} skip={partialSkip} onChange={setPartialSkip} /></>}</DataState>
        </Section>
      </Can>
      <Can anyOf={['grn:read']}>
        <Section title="Latest goods receipts" actions={<span className="muted">Open the PO for per-line QC outcomes.</span>}>
          <DataState state={grns}>
            {(rows) => (
              <>
              <DataTable
                caption="Latest goods receipts"
                rows={rows}
                rowKey={(g) => g.id}
                empty="No goods receipts yet."
                columns={[
                  { header: 'GRN', cell: (g) => <Ident>{g.grnNumber}</Ident> },
                  { header: 'PO', cell: (g) => <Ident>{labels.data?.purchaseOrders[g.poId] ?? '…'}</Ident> },
                  { header: 'Lines', numeric: true, cell: (g) => g.lines.length },
                  { header: 'Received', cell: (g) => <DateText value={g.createdAt} withTime /> },
                ]}
              />
              <div className="filter-bar"><button disabled={grnSkip === 0} onClick={() => setGrnSkip(Math.max(0, grnSkip - 20))}>Previous receipts</button><button disabled={rows.length < 20} onClick={() => setGrnSkip(grnSkip + 20)}>Next receipts</button></div>
              </>
            )}
          </DataState>
        </Section>
      </Can>
    </div>
  );
}
