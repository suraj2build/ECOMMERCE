'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { ActionMessage, Can, ConfirmDialog, DataState, DataTable, DateText, Ident, Money, PageHeader, Section, SelectField, StatusBadge, TextArea, YesNo } from '@/components/ui';
import { apiSend, errorMessage, newIdempotencyKey, qs } from '@/lib/api';
import { getStoredSession, API_URL } from '@/lib/staff-auth';
import { useAction, useApi, useCan } from '@/lib/session';

interface ReturnDetail {
  id: string;
  returnNumber: string;
  orderId: string;
  status: string;
  method: string;
  initiatedBy: string;
  cancelledReason: string | null;
  createdAt: string;
  pickup: { status: string; provider: string | null; trackingRef: string | null; scheduledAt: string | null; pickedUpAt: string | null } | null;
  lines: Array<{
    id: string;
    orderLineId: string;
    skuId: string;
    quantity: number;
    reason: string;
    qcResult: string | null;
    disposition: string | null;
    qcNotes: string | null;
    receivedAt: string | null;
    refundEligible: boolean;
    evidenceRequired: boolean;
  }>;
}

interface Refund {
  id: string;
  orderLineId: string;
  method: string;
  status: string;
  amount: string;
  failureReason: string | null;
}

const DISPOSITIONS = ['RESTOCK_SELLABLE', 'RESTOCK_DAMAGED', 'WRITE_OFF', 'RETURN_TO_SUPPLIER'];
type Step = 'pickup' | 'pickup/complete' | 'receive' | 'cancel';
const STEPS: Record<Step, { label: string; perm: string; body: string; danger?: boolean }> = {
  pickup: { label: 'Schedule carrier pickup', perm: 'return:receive', body: 'Books a reverse pickup with the configured carrier.' },
  'pickup/complete': { label: 'Mark picked up', perm: 'return:receive', body: 'The carrier has collected the parcel.' },
  receive: { label: 'Mark received at warehouse', perm: 'return:receive', body: 'The parcel is at the warehouse, ready for QC.' },
  cancel: { label: 'Cancel return', perm: 'return:initiate', body: 'Cancels the return request.', danger: true },
};

export default function ReturnDetailPage() {
  const { id } = useParams<{ id: string }>();
  const ret = useApi<ReturnDetail>(`/returns/${id}`);
  const canProduct = useCan('product:read');
  const canRefund = useCan('payment:refund');
  const skuIds = (ret.data?.lines ?? []).map((l) => l.skuId);
  const labels = useApi<{ skus: Record<string, string> }>(canProduct && skuIds.length ? `/admin/lookup/labels${qs({ skuIds: skuIds.join(',') })}` : null);
  const orderLabel = useApi<{ orders: Record<string, string> }>(useCan('order:read') && ret.data ? `/admin/lookup/labels${qs({ orderIds: ret.data.orderId })}` : null);
  const refunds = useApi<Refund[]>(canRefund && ret.data ? `/orders/${ret.data.orderId}/refunds` : null);
  const action = useAction();
  const [step, setStep] = useState<Step | null>(null);
  const [key, setKey] = useState('');
  const [reason, setReason] = useState('');
  const [qcLine, setQcLine] = useState<ReturnDetail['lines'][number] | null>(null);
  const [qc, setQc] = useState({ qcResult: 'PASS', disposition: 'RESTOCK_SELLABLE', notes: '' });
  const [refundLine, setRefundLine] = useState<ReturnDetail['lines'][number] | null>(null);

  const reload = () => {
    ret.reload();
    refunds.reload();
  };

  return (
    <DataState state={ret}>
      {(r) => (
        <div>
          <PageHeader
            title={`Return ${r.returnNumber}`}
            description={
              <>
                <StatusBadge status={r.status} /> {r.method === 'PICKUP' ? 'Carrier pickup' : 'Drop-off'} · requested <DateText value={r.createdAt} withTime /> by{' '}
                {r.initiatedBy.toLowerCase()} ·{' '}
                <Link href={`/dashboard/orders/${r.orderId}`}>
                  order <Ident>{orderLabel.data?.orders[r.orderId] ?? ''}</Ident>
                </Link>
              </>
            }
            breadcrumbs={[{ label: 'Post-purchase' }, { label: 'Returns', href: '/dashboard/returns' }, { label: r.returnNumber }]}
            actions={(Object.keys(STEPS) as Step[]).map((s) => (
              <Can key={s} anyOf={[STEPS[s].perm]}>
                <button
                  type="button"
                  className={STEPS[s].danger ? 'btn danger' : 'btn'}
                  onClick={() => {
                    setKey(newIdempotencyKey('return-pickup'));
                    setReason('');
                    action.clear();
                    setStep(s);
                  }}
                >
                  {STEPS[s].label}
                </button>
              </Can>
            ))}
          />
          <ActionMessage message={step || qcLine || refundLine ? null : action.message} />
          {r.cancelledReason && <p className="muted">Cancelled: {r.cancelledReason}</p>}
          {r.pickup && (
            <Section title="Reverse pickup">
              <dl className="dl">
                <dt>Status</dt>
                <dd>
                  <StatusBadge status={r.pickup.status} />
                </dd>
                <dt>Carrier</dt>
                <dd>
                  {r.pickup.provider ?? '—'} <Ident>{r.pickup.trackingRef ?? ''}</Ident>
                </dd>
                <dt>Scheduled</dt>
                <dd>
                  <DateText value={r.pickup.scheduledAt} withTime />
                </dd>
                <dt>Picked up</dt>
                <dd>
                  <DateText value={r.pickup.pickedUpAt} withTime />
                </dd>
              </dl>
            </Section>
          )}
          <Section title="Lines">
            <DataTable
              caption="Return lines"
              rows={r.lines}
              rowKey={(l) => l.id}
              columns={[
                { header: 'SKU', cell: (l) => <Ident>{labels.data?.skus[l.skuId] ?? l.skuId.slice(0, 8)}</Ident> },
                { header: 'Qty', numeric: true, cell: (l) => l.quantity },
                { header: 'Reason', cell: (l) => l.reason },
                { header: 'Received', cell: (l) => <DateText value={l.receivedAt} withTime /> },
                { header: 'QC', cell: (l) => <StatusBadge status={l.qcResult} /> },
                { header: 'Disposition', cell: (l) => (l.disposition ? l.disposition.replace(/_/g, ' ').toLowerCase() : '—') },
                { header: 'Refund eligible', cell: (l) => <YesNo value={l.refundEligible} /> },
                {
                  header: 'Refund',
                  cell: (l) => {
                    const refund = refunds.data?.find((x) => x.orderLineId === l.orderLineId);
                    return refund ? (
                      <>
                        <StatusBadge status={refund.status} /> <Money value={refund.amount} /> <span className="muted">{refund.method.replace(/_/g, ' ').toLowerCase()}</span>
                        {refund.failureReason && <div className="muted">{refund.failureReason}</div>}
                      </>
                    ) : (
                      '—'
                    );
                  },
                },
                {
                  header: 'Actions',
                  cell: (l) => (
                    <span className="row">
                      <Can anyOf={['return:qc']}>
                        <button
                          type="button"
                          className="btn small"
                          onClick={() => {
                            action.clear();
                            setQc({ qcResult: 'PASS', disposition: 'RESTOCK_SELLABLE', notes: '' });
                            setQcLine(l);
                          }}
                        >
                          Record QC
                        </button>
                      </Can>
                      <Can anyOf={['payment:refund']}>
                        <button
                          type="button"
                          className="btn small"
                          onClick={() => {
                            action.clear();
                            setKey(newIdempotencyKey('refund'));
                            setRefundLine(l);
                          }}
                        >
                          Issue refund
                        </button>
                      </Can>
                      <Evidence returnId={r.id} lineId={l.id} />
                    </span>
                  ),
                },
              ]}
            />
          </Section>

          <ConfirmDialog
            open={step !== null}
            title={step ? STEPS[step].label : ''}
            confirmLabel={step ? STEPS[step].label : 'Confirm'}
            danger={step ? STEPS[step].danger : false}
            busy={action.busy}
            onCancel={() => setStep(null)}
            onConfirm={async () => {
              if (!step) return;
              const body = step === 'pickup' ? { idempotencyKey: key } : step === 'cancel' ? { reason: reason || undefined } : undefined;
              if (await action.run(() => apiSend('POST', `/returns/${r.id}/${step}`, body), `${STEPS[step].label}: done.`)) {
                setStep(null);
                reload();
              }
            }}
          >
            <p>{step && STEPS[step].body}</p>
            {step === 'cancel' && <TextArea label="Reason (optional)" value={reason} onChange={setReason} />}
            {action.message?.kind === 'error' && <ActionMessage message={action.message} />}
          </ConfirmDialog>

          <ConfirmDialog
            open={qcLine !== null}
            title="Record QC and disposition"
            confirmLabel="Record QC"
            busy={action.busy}
            onCancel={() => setQcLine(null)}
            onConfirm={async () => {
              if (!qcLine) return;
              const ok = await action.run(
                () => apiSend('POST', `/returns/${r.id}/lines/${qcLine.id}/qc`, { qcResult: qc.qcResult, disposition: qc.disposition, notes: qc.notes || undefined }),
                'QC recorded.',
              );
              if (ok) {
                setQcLine(null);
                reload();
              }
            }}
          >
            <p className="muted">
              A pass makes the line refund-eligible. The disposition decides where the unit goes in stock; the return service posts the inventory movement.
            </p>
            <SelectField
              label="QC result"
              value={qc.qcResult}
              onChange={(v) => setQc((x) => ({ ...x, qcResult: v }))}
              options={[
                { value: 'PASS', label: 'Pass' },
                { value: 'FAIL', label: 'Fail' },
              ]}
            />
            <SelectField
              label="Disposition"
              value={qc.disposition}
              onChange={(v) => setQc((x) => ({ ...x, disposition: v }))}
              options={DISPOSITIONS.map((d) => ({ value: d, label: d.replace(/_/g, ' ').toLowerCase() }))}
            />
            <TextArea label="QC notes" value={qc.notes} onChange={(v) => setQc((x) => ({ ...x, notes: v }))} />
            {action.message?.kind === 'error' && <ActionMessage message={action.message} />}
          </ConfirmDialog>

          <ConfirmDialog
            open={refundLine !== null}
            title="Issue refund"
            confirmLabel="Issue refund"
            busy={action.busy}
            onCancel={() => setRefundLine(null)}
            onConfirm={async () => {
              if (!refundLine) return;
              const ok = await action.run(
                () => apiSend('POST', '/refunds', { orderId: r.orderId, orderLineId: refundLine.orderLineId, idempotencyKey: key }),
                'Refund processed - its status is shown on the line.',
              );
              if (ok) {
                setRefundLine(null);
                reload();
              }
            }}
          >
            <p>
              The refund service checks eligibility (QC pass), the amount (the line&apos;s paid value) and the method (original payment for prepaid, store credit
              for COD).
            </p>
            {action.message?.kind === 'error' && <ActionMessage message={action.message} />}
          </ConfirmDialog>
        </div>
      )}
    </DataState>
  );
}

/**
 * Evidence photos for one line. Files are fetched with the staff token and
 * opened from a local object URL - never embedded from an unauthenticated
 * URL.
 */
function Evidence({ returnId, lineId }: { returnId: string; lineId: string }) {
  const canRead = useCan('return:read');
  const list = useApi<Array<{ id: string; mimeType: string; createdAt: string }>>(canRead ? `/returns/${returnId}/lines/${lineId}/evidence` : null);
  const [error, setError] = useState<string | null>(null);
  if (!list.data || list.data.length === 0) return null;
  return (
    <span className="row">
      {list.data.map((e, i) => (
        <button
          key={e.id}
          type="button"
          className="link-button"
          onClick={async () => {
            setError(null);
            try {
              const res = await fetch(`${API_URL}/api/v1/returns/${returnId}/lines/${lineId}/evidence/${e.id}`, {
                headers: { authorization: `Bearer ${getStoredSession()?.token ?? ''}` },
              });
              if (!res.ok) throw new Error(`Could not open evidence (${res.status})`);
              const url = URL.createObjectURL(await res.blob());
              window.open(url, '_blank', 'noopener,noreferrer');
              setTimeout(() => URL.revokeObjectURL(url), 60_000);
            } catch (err) {
              setError(errorMessage(err));
            }
          }}
        >
          Evidence {i + 1}
        </button>
      ))}
      {error && <span style={{ color: 'var(--color-danger)' }}>{error}</span>}
    </span>
  );
}
