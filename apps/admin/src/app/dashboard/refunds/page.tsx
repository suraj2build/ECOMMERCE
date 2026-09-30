'use client';

import Link from 'next/link';
import { useState } from 'react';
import { ActionMessage, Can, ConfirmDialog, DataState, DataTable, DateText, Ident, Money, PageHeader, Pagination, SelectField, StatusBadge } from '@/components/ui';
import { apiSend, qs, type Page } from '@/lib/api';
import { useAction, useApi, useUrlFilter } from '@/lib/session';

interface RefundRow {
  id: string;
  orderId: string;
  orderLineId: string;
  returnLineId: string | null;
  triggerType: string;
  method: string;
  amount: number;
  status: string;
  failureReason: string | null;
  processedAt: string | null;
  createdAt: string;
  order: { orderNumber: string };
}

const TAKE = 50;

/**
 * Refunds (payment:refund). Refunds are issued from an order line or a
 * return line; this queue follows them up. Retry re-attempts settlement of
 * one FAILED or stuck PENDING refund (RefundService.retryRefund). The
 * reconcile sweep (RefundService.reconcilePendingRefunds) processes every
 * line that currently qualifies for a refund and has none completed - a
 * bulk money movement, so it needs typed confirmation.
 */
export default function RefundsPage() {
  const [status, setStatus, ready] = useUrlFilter('status');
  const [skip, setSkip] = useState(0);
  const refunds = useApi<Page<RefundRow>>(ready ? `/admin/refunds${qs({ status, take: TAKE, skip })}` : null);
  const action = useAction();
  const [confirm, setConfirm] = useState<{ kind: 'retry'; refund: RefundRow } | { kind: 'reconcile' } | null>(null);

  return (
    <div>
      <PageHeader
        title="Refunds"
        breadcrumbs={[{ label: 'Post-purchase' }, { label: 'Refunds' }]}
        actions={
          <Can anyOf={['payment:refund']}>
            <button type="button" className="btn" onClick={() => setConfirm({ kind: 'reconcile' })}>
              Reconcile pending refunds
            </button>
          </Can>
        }
      />
      <ActionMessage message={confirm ? null : action.message} />
      <div className="filter-bar">
        <SelectField
          label="Status"
          value={status}
          placeholder="All statuses"
          options={['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED'].map((s) => ({ value: s, label: s.toLowerCase() }))}
          onChange={(v) => {
            setStatus(v);
            setSkip(0);
          }}
        />
      </div>
      <DataState state={refunds}>
        {(data) => (
          <>
            <DataTable
              caption="Refunds"
              rows={data.items}
              rowKey={(r) => r.id}
              empty="No refunds in this view."
              columns={[
                {
                  header: 'Order',
                  cell: (r) => (
                    <Link href={`/dashboard/orders/${r.orderId}`}>
                      <Ident>{r.order.orderNumber}</Ident>
                    </Link>
                  ),
                },
                { header: 'Trigger', cell: (r) => r.triggerType.replace(/_/g, ' ').toLowerCase() },
                { header: 'Method', cell: (r) => r.method.replace(/_/g, ' ').toLowerCase() },
                { header: 'Amount', numeric: true, cell: (r) => <Money value={r.amount} /> },
                {
                  header: 'Status',
                  cell: (r) => (
                    <>
                      <StatusBadge status={r.status} />
                      {r.failureReason && <div className="muted">{r.failureReason}</div>}
                    </>
                  ),
                },
                { header: 'Created', cell: (r) => <DateText value={r.createdAt} withTime /> },
                { header: 'Processed', cell: (r) => <DateText value={r.processedAt} withTime /> },
                {
                  header: 'Actions',
                  cell: (r) =>
                    r.status === 'FAILED' || r.status === 'PENDING' ? (
                      <Can anyOf={['payment:refund']}>
                        <button type="button" className="btn small" onClick={() => setConfirm({ kind: 'retry', refund: r })}>
                          Retry
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
      <ConfirmDialog
        open={confirm !== null}
        title={confirm?.kind === 'retry' ? 'Retry refund' : 'Reconcile pending refunds'}
        confirmLabel={confirm?.kind === 'retry' ? 'Retry refund' : 'Run reconciliation'}
        danger={confirm?.kind === 'reconcile'}
        requireText={confirm?.kind === 'reconcile' ? 'RUN' : undefined}
        busy={action.busy}
        onCancel={() => setConfirm(null)}
        onConfirm={async () => {
          if (!confirm) return;
          const ok = await action.run(
            () => (confirm.kind === 'retry' ? apiSend('POST', `/refunds/${confirm.refund.id}/retry`) : apiSend('POST', '/refunds/reconcile')),
            confirm.kind === 'retry' ? 'Refund retried - see its status.' : 'Reconciliation run finished.',
          );
          setConfirm(null);
          if (ok) refunds.reload();
        }}
      >
        {confirm?.kind === 'retry' ? (
          <p>
            Retry the refund of <Money value={confirm.refund.amount} /> on order {confirm.refund.order.orderNumber}? The refund service claims the refund before
            calling the payment provider, so two concurrent retries cannot both reach it.
          </p>
        ) : (
          <p>
            Processes a refund for every line that qualifies now - a cancelled prepaid line, or a QC-passed return line - and has no completed refund yet. Money
            moves: original payment for prepaid, store credit for COD. Each line goes through the same idempotent refund path, so repeating the run does not
            refund a line twice.
          </p>
        )}
      </ConfirmDialog>
    </div>
  );
}
