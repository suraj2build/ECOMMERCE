'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { LocationSelect, StaffSelect } from '@/components/pickers';
import { SelfApprovalFields, useSelfApproval } from '@/components/self-approval';
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
import { useAction, useApi, useCan, useSession } from '@/lib/session';

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
  submittedBy: { id: string; fullName: string } | null;
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
const DECISIONS: Record<Decision, { label: string; perm: string; danger?: boolean; comment?: boolean; body: string; done: string }> = {
  submit: {
    label: 'Submit for approval',
    perm: 'po:submit',
    body: 'The order is locked for editing and sent for approval.',
    done: 'Submitted for approval. Once it is approved, receive the goods on this page.',
  },
  approve: {
    label: 'Approve',
    perm: 'po:approve',
    comment: true,
    body: 'Approval must come from someone other than the submitter, unless owner approval is on (Approvals page); the server enforces it and the approval threshold.',
    done: 'Approved. Receive the goods below as they arrive.',
  },
  reject: { label: 'Reject', perm: 'po:approve', comment: true, danger: true, body: 'The order returns to the buyer as rejected.', done: 'Rejected.' },
  cancel: { label: 'Cancel order', perm: 'po:create', danger: true, body: 'Cancelled orders cannot be received against.', done: 'Order cancelled.' },
};

/** The steps that apply to an order in this status, in the order they happen. */
function decisionsFor(status: string, anythingReceived: boolean): Decision[] {
  switch (status) {
    case 'DRAFT':
      return ['submit', 'cancel'];
    case 'SUBMITTED':
      return ['approve', 'reject', 'cancel'];
    case 'APPROVED':
      return anythingReceived ? [] : ['cancel'];
    default:
      return [];
  }
}

const RECEIVABLE = ['APPROVED', 'PARTIALLY_RECEIVED'];

/** What happens next, in one sentence, for each status. */
const NEXT_STEP: Record<string, { kind: 'info' | 'success' | 'warning'; text: string }> = {
  DRAFT: { kind: 'info', text: 'Draft: check the lines, then submit it for approval. Goods can be received once it is approved.' },
  SUBMITTED: { kind: 'info', text: 'Waiting for approval. Goods can be received once it is approved.' },
  APPROVED: { kind: 'info', text: 'Approved: record the goods below as they arrive.' },
  PARTIALLY_RECEIVED: { kind: 'info', text: 'Partly received: record the rest below as it arrives.' },
  FULLY_RECEIVED: { kind: 'success', text: 'Everything on this order has been received.' },
  CLOSED: { kind: 'success', text: 'This order is closed.' },
  REJECTED: { kind: 'warning', text: 'This order was rejected. Create a new purchase order if the goods are still needed.' },
  CANCELLED: { kind: 'warning', text: 'This order was cancelled; nothing can be received against it.' },
};

interface ApprovalPolicy {
  ownerApprovalEnabled: boolean;
  viewerIsOwner: boolean;
}

export default function PurchaseOrderDetail() {
  const { id } = useParams<{ id: string }>();
  const po = useApi<Po>(`/procurement/purchase-orders/${id}`);
  const lines = useApi<PoLines>(`/admin/purchase-orders/${id}/lines`);
  const canReadGrn = useCan('grn:read');
  const grns = useApi<Grn[]>(canReadGrn ? `/grn${qs({ poId: id })}` : null);
  const action = useAction();
  const [decision, setDecision] = useState<Decision | null>(null);
  const [comment, setComment] = useState('');
  // Kept here rather than in the receiving form: a receipt that completes the
  // order hides the form, and its confirmation must stay visible.
  const [receipt, setReceipt] = useState<{ grnNumber: string; exceptions: string | null } | null>(null);
  const session = useSession();
  const selfApproval = useSelfApproval();
  const approvingOwn = lines.data?.submittedBy?.id === session.staffUserId;
  const policy = useApi<ApprovalPolicy>(approvingOwn ? '/approvals/policy' : null);
  // Approving your own order is only possible through owner approval; when
  // that is not available the dialog explains why and does not send.
  const ownApprovalBlocked = approvingOwn && Boolean(policy.data) && !(policy.data!.ownerApprovalEnabled && policy.data!.viewerIsOwner);

  const reloadAll = () => {
    po.reload();
    lines.reload();
    grns.reload();
  };

  function openDecision(d: Decision) {
    action.clear();
    setDecision(d);
  }

  function closeDecision() {
    action.clear();
    setDecision(null);
    setComment('');
    selfApproval.reset();
  }

  async function decide(d: Decision) {
    const ok = await action.run(
      () =>
        apiSend('POST', `/procurement/purchase-orders/${id}/${d}`, {
          ...(DECISIONS[d].comment ? { comment: comment || undefined } : {}),
          ...(d === 'approve' && approvingOwn && !ownApprovalBlocked ? { selfApproval: selfApproval.value } : {}),
        }),
      DECISIONS[d].done,
    );
    // A refusal keeps the dialog open with the reason and comment typed
    // and shows why there; the password and code are cleared.
    if (!ok) {
      selfApproval.clearSecrets();
      return;
    }
    setDecision(null);
    setComment('');
    selfApproval.reset();
    reloadAll();
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
            actions={decisionsFor(p.status, (lines.data?.lines ?? []).some((l) => l.receivedQty > 0)).map((d, i) => (
              <Can key={d} anyOf={[DECISIONS[d].perm]}>
                <button
                  type="button"
                  className={DECISIONS[d].danger ? 'btn danger' : i === 0 ? 'primary' : 'btn'}
                  onClick={() => openDecision(d)}
                  disabled={action.busy}
                >
                  {DECISIONS[d].label}
                </button>
              </Can>
            ))}
          />
          {decision === null && <ActionMessage message={action.message} />}
          {receipt && <Notice kind="success">Goods receipt {receipt.grnNumber} recorded.</Notice>}
          {receipt?.exceptions && <Notice kind="warning">Receipt exceptions recorded: {receipt.exceptions}</Notice>}
          {NEXT_STEP[p.status] && <Notice kind={NEXT_STEP[p.status]!.kind}>{NEXT_STEP[p.status]!.text}</Notice>}

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
            {lines.data && RECEIVABLE.includes(p.status) && <ReceiveForm
                po={p}
                lines={lines.data.lines}
                onStart={() => setReceipt(null)}
                onReceived={(r) => {
                  setReceipt(r);
                  reloadAll();
                }}
              />}
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
            confirmDisabled={decision === 'approve' && ownApprovalBlocked}
            onCancel={closeDecision}
            onConfirm={() => decision && void decide(decision)}
          >
            <p>{decision && DECISIONS[decision].body}</p>
            {/* Only a refusal belongs here: the dialog closes on success and the page shows the result. */}
            {action.message?.kind === 'error' && <ActionMessage message={action.message} />}
            {decision && DECISIONS[decision].comment && <TextArea label="Comment (optional)" value={comment} onChange={setComment} />}
            {decision === 'approve' && approvingOwn && <SelfApprovalFields what="purchase order" state={selfApproval} />}
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
function ReceiveForm({
  po,
  lines,
  onStart,
  onReceived,
}: {
  po: Po;
  lines: PoLines['lines'];
  onStart: () => void;
  onReceived: (receipt: { grnNumber: string; exceptions: string | null } | null) => void;
}) {
  const action = useAction();
  const [locationId, setLocationId] = useState(po.location.id);
  const [signoff, setSignoff] = useState('');
  const session = useSession();
  const selfApproval = useSelfApproval();
  const signingOwn = signoff !== '' && signoff === session.staffUserId;
  const [rows, setRows] = useState<Record<string, ReceiveRow>>({});
  type ReceiptException = { skuId: string; shortQty: number; excessQty: number; isExcessException: boolean };
  const [queuedFor, setQueuedFor] = useState<string | null>(null);
  const row = (lineId: string): ReceiveRow => rows[lineId] ?? { receivedQty: '', acceptedQty: '', damagedQty: '0', rejectedQty: '0', qcNotes: '' };
  const set = (lineId: string, k: keyof ReceiveRow, v: string) => setRows((r) => ({ ...r, [lineId]: { ...row(lineId), [k]: v } }));

  return (
    <Section title="Receive goods (GRN + QC)">
      <p className="muted" style={{ marginTop: 0 }}>
        Enter what physically arrived for each line. Leave a line blank to skip it. Accepted units post as sellable stock; damaged and rejected units
        post as damaged.
      </p>
      <ActionMessage message={action.message} />
      {queuedFor && (
        <Notice kind="info">
          Sent to {queuedFor} for QC sign-off. Nothing is received into stock until they approve it on their Approvals page.
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
          onStart();
          setQueuedFor(null);
          let receipt: { grnNumber: string; exceptions: string | null } | null = null;
          const ok = await action.run(async () => {
            const res = await apiSend<{ grnNumber: string; exceptions: ReceiptException[]; pendingApproval?: { approver: string } }>('POST', '/grn', {
              poId: po.id,
              locationId,
              managerSignoffStaffId: signoff || undefined,
              ...(signingOwn ? { selfApproval: selfApproval.value } : {}),
              lines: payloadLines,
            });
            if (res.pendingApproval) {
              setQueuedFor(res.pendingApproval.approver);
              return;
            }
            receipt = {
              grnNumber: res.grnNumber,
              exceptions:
                res.exceptions.length > 0
                  ? res.exceptions
                      .map((x) => `${lines.find((l) => l.skuId === x.skuId)?.sku.skuCode ?? x.skuId}: short ${x.shortQty}, excess ${x.excessQty}${x.isExcessException ? ' (over tolerance)' : ''}`)
                      .join('; ')
                  : null,
            };
          });
          if (ok) {
            setRows({});
            selfApproval.reset();
            onReceived(receipt);
          } else {
            selfApproval.clearSecrets();
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
            hint="Needed when damaged + rejected units reach the configured threshold. Someone else signs off from their own login before anything is received."
          />
        </div>
        {signingOwn && <SelfApprovalFields what="receiving QC sign-off" state={selfApproval} />}
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
