'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { LocationSelect, StaffSelect } from '@/components/pickers';
import {
  ActionMessage,
  Can,
  ConfirmDialog,
  DataState,
  DataTable,
  DateText,
  Ident,
  Money,
  Notice,
  PageHeader,
  Section,
  StatusBadge,
  TextArea,
} from '@/components/ui';
import { apiSend, qs } from '@/lib/api';
import { useAction, useApi, useCan } from '@/lib/session';

interface Po {
  id: string;
  poNumber: string;
  status: string;
  totalCost: string;
  currency: string;
  approvalThresholdApplied: string | null;
  expectedDate: string | null;
  createdAt: string;
  supplier: { id: string; name: string; code: string };
  location: { id: string; name: string; code: string };
}

interface PoLines {
  submittedBy: { fullName: string } | null;
  approvedBy: { fullName: string } | null;
  lines: Array<{
    id: string;
    skuId: string;
    orderedQty: number;
    receivedQty: number;
    unitCost: number;
    sku: { skuCode: string; style: { name: string }; colour: { name: string }; size: { label: string } };
  }>;
  approvals: Array<{ id: string; action: string; comment: string | null; createdAt: string; staff: { fullName: string } }>;
}

interface Grn {
  id: string;
  grnNumber: string;
  createdAt: string;
  lines: Array<{ id: string; skuId: string; receivedQty: number; acceptedQty: number; damagedQty: number; rejectedQty: number; shortQty: number; excessQty: number; qcResult: string }>;
}

type Decision = 'submit' | 'approve' | 'reject' | 'cancel';
const DECISIONS: Record<Decision, { label: string; perm: string; danger?: boolean; comment?: boolean; body: string }> = {
  submit: { label: 'Submit for approval', perm: 'po:submit', body: 'The order is locked for editing and sent for approval.' },
  approve: { label: 'Approve', perm: 'po:approve', comment: true, body: 'Approval must come from someone other than the submitter; the server enforces it and the approval threshold.' },
  reject: { label: 'Reject', perm: 'po:approve', comment: true, danger: true, body: 'The order returns to the buyer as rejected.' },
  cancel: { label: 'Cancel order', perm: 'po:create', danger: true, body: 'Cancelled orders cannot be received against.' },
};

export default function PurchaseOrderDetail() {
  const { id } = useParams<{ id: string }>();
  const po = useApi<Po>(`/procurement/purchase-orders/${id}`);
  const lines = useApi<PoLines>(`/admin/purchase-orders/${id}/lines`);
  const canReadGrn = useCan('grn:read');
  const grns = useApi<Grn[]>(canReadGrn ? `/grn${qs({ poId: id })}` : null);
  const action = useAction();
  const [decision, setDecision] = useState<Decision | null>(null);
  const [comment, setComment] = useState('');

  const reloadAll = () => {
    po.reload();
    lines.reload();
    grns.reload();
  };

  async function decide(d: Decision) {
    const ok = await action.run(
      () => apiSend('POST', `/procurement/purchase-orders/${id}/${d}`, DECISIONS[d].comment ? { comment: comment || undefined } : {}),
      `${DECISIONS[d].label}: done.`,
    );
    setDecision(null);
    setComment('');
    if (ok) reloadAll();
  }

  return (
    <DataState state={po}>
      {(p) => (
        <div>
          <PageHeader
            title={`Purchase order ${p.poNumber}`}
            description={
              <>
                <StatusBadge status={p.status} /> {p.supplier.name} → {p.location.name}
              </>
            }
            breadcrumbs={[{ label: 'Procurement' }, { label: 'Purchase orders', href: '/dashboard/purchase-orders' }, { label: p.poNumber }]}
            actions={(Object.keys(DECISIONS) as Decision[]).map((d) => (
              <Can key={d} anyOf={[DECISIONS[d].perm]}>
                <button type="button" className={DECISIONS[d].danger ? 'btn danger' : 'btn'} onClick={() => setDecision(d)} disabled={action.busy}>
                  {DECISIONS[d].label}
                </button>
              </Can>
            ))}
          />
          <ActionMessage message={action.message} />

          <div className="grid-2">
            <Section title="Summary">
              <dl className="dl">
                <dt>Supplier</dt>
                <dd>
                  <Link href={`/dashboard/suppliers/${p.supplier.id}`}>{p.supplier.name}</Link> <span className="mono muted">{p.supplier.code}</span>
                </dd>
                <dt>Deliver to</dt>
                <dd>
                  {p.location.name} <span className="mono muted">{p.location.code}</span>
                </dd>
                <dt>Total cost</dt>
                <dd>
                  <Money value={p.totalCost} currency={p.currency} />
                </dd>
                <dt>Approval threshold applied</dt>
                <dd>{p.approvalThresholdApplied === null ? '—' : <Money value={p.approvalThresholdApplied} />}</dd>
                <dt>Expected</dt>
                <dd>
                  <DateText value={p.expectedDate} />
                </dd>
                <dt>Submitted by</dt>
                <dd>{lines.data?.submittedBy?.fullName ?? '—'}</dd>
                <dt>Approved by</dt>
                <dd>{lines.data?.approvedBy?.fullName ?? '—'}</dd>
              </dl>
            </Section>
            <Section title="Approval history">
              <DataState state={lines}>
                {(l) => (
                  <DataTable
                    caption="Approval history"
                    rows={l.approvals}
                    rowKey={(a) => a.id}
                    empty="No approval activity yet."
                    columns={[
                      { header: 'Action', cell: (a) => <StatusBadge status={a.action} /> },
                      { header: 'By', cell: (a) => a.staff.fullName },
                      { header: 'Comment', cell: (a) => a.comment ?? '—' },
                      { header: 'When', cell: (a) => <DateText value={a.createdAt} withTime /> },
                    ]}
                  />
                )}
              </DataState>
            </Section>
          </div>

          <Section title="Lines">
            <DataState state={lines}>
              {(l) => (
                <DataTable
                  caption="Purchase order lines"
                  rows={l.lines}
                  rowKey={(r) => r.id}
                  columns={[
                    { header: 'SKU', cell: (r) => <Ident>{r.sku.skuCode}</Ident> },
                    { header: 'Item', cell: (r) => `${r.sku.style.name} · ${r.sku.colour.name} · ${r.sku.size.label}` },
                    { header: 'Ordered', numeric: true, cell: (r) => r.orderedQty },
                    { header: 'Received', numeric: true, cell: (r) => r.receivedQty },
                    { header: 'Unit cost', numeric: true, cell: (r) => <Money value={r.unitCost} /> },
                  ]}
                />
              )}
            </DataState>
          </Section>

          <Can anyOf={['grn:create']}>
            {lines.data && <ReceiveForm po={p} lines={lines.data.lines} onReceived={reloadAll} />}
          </Can>

          <Can anyOf={['grn:read']}>
            <Section title="Goods receipts">
              <DataState state={grns}>
                {(rows) => (
                  <DataTable
                    caption="Goods receipts"
                    rows={rows}
                    rowKey={(g) => g.id}
                    empty="Nothing received against this order yet."
                    columns={[
                      { header: 'GRN', cell: (g) => <Ident>{g.grnNumber}</Ident> },
                      { header: 'Received', cell: (g) => <DateText value={g.createdAt} withTime /> },
                      {
                        header: 'Lines',
                        cell: (g) => (
                          <ul style={{ margin: 0, paddingLeft: '1rem' }}>
                            {g.lines.map((gl) => (
                              <li key={gl.id}>
                                {lines.data?.lines.find((pl) => pl.skuId === gl.skuId)?.sku.skuCode ?? gl.skuId.slice(0, 8)}: received {gl.receivedQty}, accepted{' '}
                                {gl.acceptedQty}, damaged {gl.damagedQty}, rejected {gl.rejectedQty}
                                {gl.shortQty > 0 && `, short ${gl.shortQty}`}
                                {gl.excessQty > 0 && `, excess ${gl.excessQty}`} <StatusBadge status={gl.qcResult} />
                              </li>
                            ))}
                          </ul>
                        ),
                      },
                    ]}
                  />
                )}
              </DataState>
            </Section>
          </Can>

          <ConfirmDialog
            open={decision !== null}
            title={decision ? `${DECISIONS[decision].label} ${p.poNumber}` : ''}
            confirmLabel={decision ? DECISIONS[decision].label : 'Confirm'}
            danger={decision ? DECISIONS[decision].danger : false}
            busy={action.busy}
            onCancel={() => setDecision(null)}
            onConfirm={() => decision && void decide(decision)}
          >
            <p>{decision && DECISIONS[decision].body}</p>
            {decision && DECISIONS[decision].comment && <TextArea label="Comment (optional)" value={comment} onChange={setComment} />}
          </ConfirmDialog>
        </div>
      )}
    </DataState>
  );
}

interface ReceiveRow {
  receivedQty: string;
  acceptedQty: string;
  damagedQty: string;
  rejectedQty: string;
  qcNotes: string;
}

/**
 * GRN with QC outcome per line (POST /grn). The GRN service validates the
 * PO status, that accepted + damaged + rejected = received, and whether
 * the failed quantity needs a manager's sign-off; it computes short and
 * excess itself.
 */
function ReceiveForm({ po, lines, onReceived }: { po: Po; lines: PoLines['lines']; onReceived: () => void }) {
  const action = useAction();
  const [locationId, setLocationId] = useState(po.location.id);
  const [signoff, setSignoff] = useState('');
  const [rows, setRows] = useState<Record<string, ReceiveRow>>({});
  const [exceptions, setExceptions] = useState<Array<{ skuId: string; shortQty: number; excessQty: number; isExcessException: boolean }>>([]);
  const [recorded, setRecorded] = useState<string | null>(null);
  const row = (lineId: string): ReceiveRow => rows[lineId] ?? { receivedQty: '', acceptedQty: '', damagedQty: '0', rejectedQty: '0', qcNotes: '' };
  const set = (lineId: string, k: keyof ReceiveRow, v: string) => setRows((r) => ({ ...r, [lineId]: { ...row(lineId), [k]: v } }));

  return (
    <Section title="Receive goods (GRN + QC)">
      <p className="muted" style={{ marginTop: 0 }}>
        Enter what physically arrived for each line. Leave a line blank to skip it. Accepted units post as sellable stock; damaged and rejected units
        post as damaged.
      </p>
      <ActionMessage message={action.message} />
      {recorded && <Notice kind="success">Goods receipt {recorded} recorded.</Notice>}
      {exceptions.length > 0 && (
        <Notice kind="warning">
          Receipt exceptions recorded:{' '}
          {exceptions
            .map((x) => `${lines.find((l) => l.skuId === x.skuId)?.sku.skuCode ?? x.skuId}: short ${x.shortQty}, excess ${x.excessQty}${x.isExcessException ? ' (over tolerance)' : ''}`)
            .join('; ')}
        </Notice>
      )}
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const payloadLines = lines
            .filter((l) => row(l.id).receivedQty !== '')
            .map((l) => {
              const r = row(l.id);
              return {
                poLineId: l.id,
                skuId: l.skuId,
                receivedQty: Number(r.receivedQty),
                acceptedQty: Number(r.acceptedQty || 0),
                damagedQty: Number(r.damagedQty || 0),
                rejectedQty: Number(r.rejectedQty || 0),
                qcNotes: r.qcNotes || undefined,
              };
            });
          setRecorded(null);
          const ok = await action.run(async () => {
            const res = await apiSend<{ grnNumber: string; exceptions: typeof exceptions }>('POST', '/grn', {
              poId: po.id,
              locationId,
              managerSignoffStaffId: signoff || undefined,
              lines: payloadLines,
            });
            setRecorded(res.grnNumber);
            setExceptions(res.exceptions);
          });
          if (ok) {
            setRows({});
            onReceived();
          }
        }}
      >
        <div className="form-row">
          <LocationSelect label="Receiving location" value={locationId} onChange={setLocationId} required />
          <StaffSelect
            label="Manager QC sign-off"
            capability="grn-qc-signoff"
            value={signoff}
            onChange={setSignoff}
            hint="Needed when damaged + rejected units reach the configured threshold."
          />
        </div>
        <div className="table-wrap" style={{ marginBottom: '0.75rem' }}>
          <table>
            <caption className="sr-only">Quantities to receive</caption>
            <thead>
              <tr>
                <th scope="col">SKU</th>
                <th scope="col" className="num">
                  Open
                </th>
                <th scope="col">Received</th>
                <th scope="col">Accepted</th>
                <th scope="col">Damaged</th>
                <th scope="col">Rejected</th>
                <th scope="col">QC notes</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => {
                const r = row(l.id);
                const qty = (k: keyof ReceiveRow, label: string) => (
                  <input
                    className="input"
                    type="number"
                    min={0}
                    style={{ width: '6rem' }}
                    aria-label={`${label} for ${l.sku.skuCode}`}
                    value={r[k]}
                    onChange={(e) => set(l.id, k, e.target.value)}
                  />
                );
                return (
                  <tr key={l.id}>
                    <td>
                      <Ident>{l.sku.skuCode}</Ident>
                    </td>
                    <td className="num">
                      {l.receivedQty}/{l.orderedQty}
                    </td>
                    <td>{qty('receivedQty', 'Received')}</td>
                    <td>{qty('acceptedQty', 'Accepted')}</td>
                    <td>{qty('damagedQty', 'Damaged')}</td>
                    <td>{qty('rejectedQty', 'Rejected')}</td>
                    <td>
                      <input className="input" aria-label={`QC notes for ${l.sku.skuCode}`} value={r.qcNotes} onChange={(e) => set(l.id, 'qcNotes', e.target.value)} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <button className="primary" type="submit" disabled={action.busy}>
          {action.busy ? 'Recording…' : 'Record goods receipt'}
        </button>
      </form>
    </Section>
  );
}
