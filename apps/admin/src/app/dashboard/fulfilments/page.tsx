'use client';

import Link from 'next/link';
import { useState } from 'react';
import { FulfilmentActions } from '@/components/fulfilment-actions';
import { ActionMessage, Can, DataState, DataTable, DateText, Drawer, Ident, Notice, PageHeader, Pagination, SelectField, StatusBadge } from '@/components/ui';
import { apiSend, qs, type Page } from '@/lib/api';
import { useAction, useApi, useUrlFilter } from '@/lib/session';

interface FulfilmentRow {
  id: string;
  orderId: string;
  exchangeId: string | null;
  status: string;
  /** Booked with a courier vs actually collected (AO-D5). */
  dispatchStage: string;
  carrierName: string | null;
  trackingRef: string | null;
  packedAt: string | null;
  shippedAt: string | null;
  deliveredAt: string | null;
  createdAt: string;
  order: { orderNumber: string };
  exchange: { exchangeNumber: string } | null;
  shipment: { id: string; provider: string; status: string; trackingRef: string | null; deliveryAttempts: number; maxDeliveryAttempts: number; bookedAt: string | null; handedOverAt: string | null } | null;
  _count: { lines: number };
}

const TAKE = 50;

/**
 * Pack & ship: every fulfilment (order- or exchange-sourced) by status.
 * Each package's transitions call the same order/shipping routes as the
 * order page.
 */
export default function FulfilmentsPage() {
  const [status, setStatus, ready] = useUrlFilter('status', 'PENDING');
  const [skip, setSkip] = useState(0);
  const rows = useApi<Page<FulfilmentRow>>(ready ? `/admin/fulfilments${qs({ status, take: TAKE, skip })}` : null);
  const [open, setOpen] = useState<FulfilmentRow | null>(null);
  const poll = useAction();
  const [updated, setUpdated] = useState<string | null>(null);

  return (
    <div>
      <PageHeader
        title="Pack & ship"
        breadcrumbs={[{ label: 'Orders' }, { label: 'Pack & ship' }]}
        actions={
          <Can anyOf={['shipping:manage']}>
            <button
              type="button"
              className="btn"
              disabled={poll.busy}
              onClick={async () => {
                if (await poll.run(() => apiSend('POST', '/shipments/poll'), 'Carrier tracking polled.')) rows.reload();
              }}
            >
              Poll carrier tracking
            </button>
          </Can>
        }
      />
      <ActionMessage message={poll.message} />
      {updated && <Notice kind="success">{updated}</Notice>}
      <div className="filter-bar">
        <SelectField
          label="Status"
          value={status}
          placeholder="All statuses"
          options={[
            { value: 'PENDING', label: 'Pending' },
            { value: 'PACKED', label: 'Packed' },
            { value: 'READY_TO_SHIP', label: 'Ready to ship' },
            { value: 'BOOKED_AWAITING_COLLECTION', label: 'Booked — awaiting collection' },
            { value: 'HANDED_OVER', label: 'Handed over to the courier' },
            { value: 'SHIPPED', label: 'Shipped (booked or handed over)' },
            { value: 'DELIVERED', label: 'Delivered' },
          ]}
          onChange={(v) => {
            setStatus(v);
            setSkip(0);
          }}
        />
      </div>
      <DataState state={rows}>
        {(data) => (
          <>
            <DataTable
              caption="Fulfilments"
              rows={data.items}
              rowKey={(f) => f.id}
              empty="No packages in this status."
              columns={[
                {
                  header: 'For',
                  cell: (f) =>
                    f.exchange ? (
                      <Link href={`/dashboard/exchanges/${f.exchangeId}`}>
                        Exchange <Ident>{f.exchange.exchangeNumber}</Ident>
                      </Link>
                    ) : (
                      <Link href={`/dashboard/orders/${f.orderId}`}>
                        <Ident>{f.order.orderNumber}</Ident>
                      </Link>
                    ),
                },
                { header: 'Contents', cell: (f) => (f.exchangeId ? 'Exchange replacement' : `${f._count.lines} order line(s)`) },
                {
                  header: 'Status',
                  cell: (f) => (
                    <>
                      <StatusBadge status={f.dispatchStage} />
                      {f.dispatchStage === 'BOOKED_AWAITING_COLLECTION' && <div className="muted">Stock already deducted at booking</div>}
                      {f.dispatchStage === 'HANDED_OVER' && f.shipment?.handedOverAt && (
                        <div className="muted">
                          <DateText value={f.shipment.handedOverAt} withTime />
                        </div>
                      )}
                    </>
                  ),
                },
                {
                  header: 'Shipment',
                  cell: (f) =>
                    f.shipment ? (
                      <>
                        <StatusBadge status={f.shipment.status} /> <Ident>{f.shipment.trackingRef ?? ''}</Ident>
                      </>
                    ) : (
                      '—'
                    ),
                },
                { header: 'Created', cell: (f) => <DateText value={f.createdAt} withTime /> },
                {
                  header: 'Actions',
                  cell: (f) => (
                    <button type="button" className="btn small" onClick={() => setOpen(f)}>
                      Open
                    </button>
                  ),
                },
              ]}
            />
            <Pagination total={data.total} take={TAKE} skip={skip} onChange={setSkip} />
          </>
        )}
      </DataState>
      <Drawer open={open !== null} title={open ? `Package for ${open.exchange ? open.exchange.exchangeNumber : open.order.orderNumber}` : ''} onClose={() => setOpen(null)}>
        {open && (
          <>
            <p>
              <StatusBadge status={open.status} /> packed <DateText value={open.packedAt} withTime />, shipped <DateText value={open.shippedAt} withTime />, delivered{' '}
              <DateText value={open.deliveredAt} withTime />
            </p>
            <FulfilmentActions
              fulfilment={open}
              onChanged={() => {
                setUpdated(`Package for ${open.exchange ? open.exchange.exchangeNumber : open.order.orderNumber} updated.`);
                setOpen(null);
                rows.reload();
              }}
            />
          </>
        )}
      </Drawer>
    </div>
  );
}
