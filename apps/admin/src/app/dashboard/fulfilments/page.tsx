'use client';

import Link from 'next/link';
import { useState } from 'react';
import { FulfilmentActions, shipmentDisplayStatus } from '@/components/fulfilment-actions';
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
  /** A replacement package whose courier booking was cancelled; the exchange carries on with a new package. */
  cancelledExchangeId: string | null;
  cancelledExchange: { exchangeNumber: string } | null;
  /** An order package whose booking was cancelled with its items kept, to be packed and booked again. */
  releasedForRebook: boolean;
  shipment: { id: string; provider: string; status: string; trackingRef: string | null; deliveryAttempts: number; maxDeliveryAttempts: number; bookedAt: string | null; handedOverAt: string | null } | null;
  _count: { lines: number };
}

const TAKE = 50;

interface ReadyToPack {
  total: number;
  orders: Array<{ orderId: string; orderNumber: string; placedAt: string; lineIds: string[]; pickedLines: number; linesStillToPick: number }>;
}

/**
 * Pack & ship: every fulfilment (order- or exchange-sourced) by status.
 * Each package's transitions call the same order/shipping routes as the
 * order page.
 */
export default function FulfilmentsPage() {
  // Opens on everything that still needs someone to act; finished
  // packages are one filter away.
  const [status, setStatus, ready] = useUrlFilter('status', 'IN_PROGRESS');
  const [skip, setSkip] = useState(0);
  const rows = useApi<Page<FulfilmentRow>>(ready ? `/admin/fulfilments${qs({ status, take: TAKE, skip })}` : null);
  const [open, setOpen] = useState<FulfilmentRow | null>(null);
  const poll = useAction();
  const [updated, setUpdated] = useState<string | null>(null);
  const toPack = useApi<ReadyToPack>('/admin/fulfilments/ready-to-pack');
  const create = useAction();

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
                let result: { polled: number; updated: number } | undefined;
                const ok = await poll.run(async () => {
                  result = await apiSend<{ polled: number; updated: number }>('POST', '/shipments/poll');
                });
                if (ok && result) {
                  poll.clear();
                  setUpdated(
                    result.polled === 0
                      ? 'No parcels are out with the courier, so there was nothing to check.'
                      : `Checked ${result.polled} parcel(s) with the courier: ${result.updated === 0 ? 'no new tracking updates' : `${result.updated} updated`}.`,
                  );
                  rows.reload();
                }
              }}
            >
              Poll carrier tracking
            </button>
          </Can>
        }
      />
      <ActionMessage message={poll.message} />
      {updated && <Notice kind="success">{updated}</Notice>}
      {/* Outside the list: creating the last package empties (and hides) it. */}
      <ActionMessage message={create.message} />
      <DataState state={toPack}>
        {(tp) =>
          tp.total > 0 ? (
            <section className="card" aria-label="Picked, waiting for a package" style={{ marginBottom: '1rem' }}>
              <h2 style={{ marginTop: 0 }}>Picked, waiting for a package ({tp.total})</h2>
              <p className="muted" style={{ marginTop: 0 }}>
                These orders have picked items that are not in a package yet. Create the package, then pack it below.
              </p>
              <DataTable
                caption="Picked orders waiting for a package"
                rows={tp.orders}
                rowKey={(o) => o.orderId}
                columns={[
                  {
                    header: 'Order',
                    cell: (o) => (
                      <Link href={`/dashboard/orders/${o.orderId}`}>
                        <Ident>{o.orderNumber}</Ident>
                      </Link>
                    ),
                  },
                  { header: 'Picked items', numeric: true, cell: (o) => o.pickedLines },
                  {
                    header: 'Still to pick',
                    cell: (o) => (o.linesStillToPick > 0 ? `${o.linesStillToPick} item(s): packing now sends this order in more than one parcel` : '—'),
                  },
                  {
                    header: 'Actions',
                    cell: (o) => (
                      <Can anyOf={['order:fulfil']}>
                        <button
                          type="button"
                          className="btn small primary"
                          disabled={create.busy}
                          onClick={async () => {
                            const ok = await create.run(
                              () => apiSend('POST', `/orders/${o.orderId}/fulfilments`, { lineIds: o.lineIds }),
                              `Package created for ${o.orderNumber}. Pack it below.`,
                            );
                            if (ok) {
                              toPack.reload();
                              setStatus('IN_PROGRESS');
                              rows.reload();
                            }
                          }}
                        >
                          Create package
                        </button>
                      </Can>
                    ),
                  },
                ]}
              />
            </section>
          ) : null
        }
      </DataState>
      <div className="filter-bar">
        <SelectField
          label="Status"
          value={status}
          placeholder="All statuses"
          options={[
            { value: 'IN_PROGRESS', label: 'In progress (not yet with the courier)' },
            { value: 'PENDING', label: 'Pending' },
            { value: 'PACKED', label: 'Packed' },
            { value: 'READY_TO_SHIP', label: 'Ready to ship' },
            { value: 'BOOKED_AWAITING_COLLECTION', label: 'Booked — awaiting collection' },
            { value: 'HANDED_OVER', label: 'Handed over to the courier' },
            { value: 'SHIPPED', label: 'Shipped' },
            { value: 'DELIVERED', label: 'Delivered' },
            { value: 'CANCELLED', label: 'Booking cancelled before collection' },
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
              empty={status === 'IN_PROGRESS' ? 'Nothing to pack or ship right now.' : 'No packages in this status.'}
              columns={[
                {
                  header: 'For',
                  cell: (f) =>
                    f.exchange ? (
                      <Link href={`/dashboard/exchanges/${f.exchangeId}`}>
                        Exchange <Ident>{f.exchange.exchangeNumber}</Ident>
                      </Link>
                    ) : f.cancelledExchange ? (
                      <Link href={`/dashboard/exchanges/${f.cancelledExchangeId}`}>
                        Exchange <Ident>{f.cancelledExchange.exchangeNumber}</Ident>
                      </Link>
                    ) : (
                      <Link href={`/dashboard/orders/${f.orderId}`}>
                        <Ident>{f.order.orderNumber}</Ident>
                      </Link>
                    ),
                },
                {
                  header: 'Contents',
                  cell: (f) =>
                    f.exchangeId
                      ? 'Exchange replacement'
                      : f.cancelledExchangeId
                        ? 'Exchange replacement - booking cancelled before collection'
                        : f.releasedForRebook
                          ? 'Booking cancelled before collection - items kept, back under "Picked, waiting for a package"'
                          : f.status === 'CANCELLED'
                            ? 'Items cancelled'
                            : `${f._count.lines} order line(s)`,
                },
                {
                  header: 'Status',
                  cell: (f) => (
                    <>
                      <StatusBadge status={f.dispatchStage} />
                      {f.dispatchStage === 'BOOKED_AWAITING_COLLECTION' && (
                        <div className="muted">{f.status === 'BOOKED' ? 'Stock leaves at handover' : 'Booked before handover posting; stock already deducted'}</div>
                      )}
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
                        <StatusBadge status={shipmentDisplayStatus(f.shipment)} /> <Ident>{f.shipment.trackingRef ?? ''}</Ident>
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
      <Drawer open={open !== null} title={open ? `Package for ${(open.exchange ?? open.cancelledExchange)?.exchangeNumber ?? open.order.orderNumber}` : ''} onClose={() => setOpen(null)}>
        {open && (
          <>
            <p>
              <StatusBadge status={open.status} /> packed <DateText value={open.packedAt} withTime />, shipped <DateText value={open.shippedAt} withTime />, delivered{' '}
              <DateText value={open.deliveredAt} withTime />
            </p>
            <FulfilmentActions
              fulfilment={open}
              onChanged={(done) => {
                setUpdated(`${open.exchange ? open.exchange.exchangeNumber : open.order.orderNumber}: ${done}`);
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
