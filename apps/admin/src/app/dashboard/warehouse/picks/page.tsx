'use client';

import Link from 'next/link';
import { useState } from 'react';
import { LocationSelect, StaffSelect } from '@/components/pickers';
import { ActionMessage, Can, DataState, DataTable, DateText, Drawer, Ident, PageHeader, Pagination, SelectField, StatusBadge, TextArea, TextField } from '@/components/ui';
import { apiSend, newIdempotencyKey, qs, type Page } from '@/lib/api';
import { useAction, useApi, useCan, useSession, useUrlFilter } from '@/lib/session';
import { SelfApprovalFields, useSelfApproval } from '@/components/self-approval';

interface PickTask {
  id: string;
  orderId: string | null;
  orderLineId: string | null;
  exchangeId: string | null;
  skuId: string;
  styleName: string;
  colourName: string;
  sizeLabel: string;
  locationId: string;
  locationCode: string;
  allocatedQuantity: number;
  pickedQuantity: number | null;
  status: string;
  exceptionType: string | null;
  exceptionReason: string | null;
  createdAt: string;
  pickedAt: string | null;
}

const TAKE = 50;
const EXCEPTION_TYPES = ['STOCK_NOT_FOUND', 'INSUFFICIENT_STOCK', 'DAMAGED', 'WRONG_SKU_FOUND', 'OTHER'];

/** Pick queue (GET /warehouse/pick-tasks). Recording a pick calls the warehouse service, which owns shortfall handling. */
export default function PickQueuePage() {
  const [status, setStatus] = useUrlFilter('status', 'PENDING');
  const [locationId, setLocationId, ready] = useUrlFilter('locationId');
  const [skip, setSkip] = useState(0);
  const tasks = useApi<Page<PickTask>>(ready ? `/warehouse/pick-tasks${qs({ status, locationId, take: TAKE, skip })}` : null);
  const canOrders = useCan('order:read');
  const orderIds = [...new Set((tasks.data?.items ?? []).map((t) => t.orderId).filter((x): x is string => !!x))];
  const labels = useApi<{ orders: Record<string, string> }>(canOrders && orderIds.length ? `/admin/lookup/labels${qs({ orderIds: orderIds.join(',') })}` : null);
  const [picking, setPicking] = useState<PickTask | null>(null);

  return (
    <div>
      <PageHeader title="Pick queue" breadcrumbs={[{ label: 'Orders' }, { label: 'Pick queue' }]} description="Oldest first. Record each pick as full, short or an exception." />
      <div className="filter-bar">
        <SelectField
          label="Status"
          value={status}
          placeholder="All statuses"
          options={['PENDING', 'PICKED', 'SHORT_PICKED', 'EXCEPTION', 'CANCELLED'].map((s) => ({ value: s, label: s.replace('_', ' ').toLowerCase() }))}
          onChange={(v) => {
            setStatus(v);
            setSkip(0);
          }}
        />
        <LocationSelect
          value={locationId}
          allowAny="All locations"
          onChange={(v) => {
            setLocationId(v);
            setSkip(0);
          }}
        />
      </div>
      <DataState state={tasks}>
        {(data) => (
          <>
            <DataTable
              caption="Pick tasks"
              rows={data.items}
              rowKey={(t) => t.id}
              empty="No pick tasks match."
              columns={[
                {
                  header: 'For',
                  cell: (t) =>
                    t.exchangeId ? (
                      <Link href={`/dashboard/exchanges/${t.exchangeId}`}>Exchange replacement</Link>
                    ) : t.orderId ? (
                      <Link href={`/dashboard/orders/${t.orderId}`}>
                        <Ident>{labels.data?.orders[t.orderId] ?? 'Order'}</Ident>
                      </Link>
                    ) : (
                      '—'
                    ),
                },
                { header: 'Item', cell: (t) => `${t.styleName} · ${t.colourName} · ${t.sizeLabel}` },
                { header: 'Location', cell: (t) => <Ident>{t.locationCode}</Ident> },
                { header: 'Allocated', numeric: true, cell: (t) => t.allocatedQuantity },
                { header: 'Picked', numeric: true, cell: (t) => t.pickedQuantity ?? '—' },
                {
                  header: 'Status',
                  cell: (t) => (
                    <>
                      <StatusBadge status={t.status} />
                      {t.exceptionType && <div className="muted">{t.exceptionType}</div>}
                    </>
                  ),
                },
                { header: 'Created', cell: (t) => <DateText value={t.createdAt} withTime /> },
                {
                  header: 'Actions',
                  cell: (t) => (
                    <Can anyOf={['warehouse:pick']}>
                      <button type="button" className="btn small" onClick={() => setPicking(t)}>
                        Record pick
                      </button>
                    </Can>
                  ),
                },
              ]}
            />
            <Pagination total={data.total} take={TAKE} skip={skip} onChange={setSkip} />
          </>
        )}
      </DataState>
      <Drawer open={picking !== null} title="Record pick" onClose={() => setPicking(null)}>
        {picking && (
          <PickForm
            task={picking}
            onDone={() => {
              setPicking(null);
              tasks.reload();
            }}
          />
        )}
      </Drawer>
    </div>
  );
}

function PickForm({ task, onDone }: { task: PickTask; onDone: () => void }) {
  const action = useAction();
  // One key per drawer opening: resubmitting the same pick replays the same outcome.
  const [key] = useState(() => newIdempotencyKey('pick'));
  const [outcome, setOutcome] = useState('FULL');
  const [picked, setPicked] = useState(String(task.allocatedQuantity));
  const [exceptionType, setExceptionType] = useState('STOCK_NOT_FOUND');
  const [reason, setReason] = useState('');
  const [coApprover, setCoApprover] = useState('');
  const session = useSession();
  const selfApproval = useSelfApproval();
  const approvingOwn = coApprover !== '' && coApprover === session.staffUserId;

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        const ok = await action.run(() =>
          apiSend('POST', `/warehouse/pick-tasks/${task.id}/pick`, {
            idempotencyKey: key,
            outcome,
            pickedQuantity: outcome === 'EXCEPTION' ? undefined : Number(picked),
            exceptionType: outcome === 'EXCEPTION' ? exceptionType : undefined,
            exceptionReason: reason || undefined,
            coApproverStaffId: coApprover || undefined,
            ...(approvingOwn ? { selfApproval: selfApproval.value } : {}),
          }),
        );
        if (ok) onDone();
      }}
    >
      <p>
        {task.styleName} · {task.colourName} · {task.sizeLabel} at <span className="mono">{task.locationCode}</span> — allocated {task.allocatedQuantity}
      </p>
      <ActionMessage message={action.message} />
      <SelectField
        label="Outcome"
        value={outcome}
        onChange={setOutcome}
        options={[
          { value: 'FULL', label: 'Full - picked everything allocated' },
          { value: 'SHORT', label: 'Short - picked fewer units' },
          { value: 'EXCEPTION', label: 'Exception - could not pick' },
        ]}
      />
      {outcome !== 'EXCEPTION' && <TextField label="Picked quantity" type="number" min={1} value={picked} onChange={setPicked} />}
      {outcome === 'EXCEPTION' && (
        <SelectField label="Exception type" value={exceptionType} onChange={setExceptionType} options={EXCEPTION_TYPES.map((t) => ({ value: t, label: t.replace(/_/g, ' ').toLowerCase() }))} />
      )}
      {outcome !== 'FULL' && (
        <>
          <TextArea label="Reason" value={reason} onChange={setReason} />
          <StaffSelect
            label="Finance co-approver"
            capability="pick-shortfall-coapprover"
            value={coApprover}
            onChange={setCoApprover}
            hint="A shortfall writes off stock; large shortfalls need a co-approver (the server applies the threshold)."
          />
          {approvingOwn && <SelfApprovalFields what="pick shortfall write-off" state={selfApproval} />}
        </>
      )}
      <button className="primary" type="submit" disabled={action.busy}>
        Record pick
      </button>
    </form>
  );
}
