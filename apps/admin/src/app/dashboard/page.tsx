'use client';

import Link from 'next/link';
import { DataState, PageHeader } from '@/components/ui';
import { formatNumber } from '@/lib/format';
import { useApi, useSession } from '@/lib/session';

type Workload = Partial<Record<'orders' | 'warehouse' | 'returns' | 'exchanges' | 'refunds' | 'procurement' | 'inventory', Record<string, number>>>;

/**
 * Work waiting for this operator. Each tile is a plain count from GET
 * /admin/dashboard/workload, which only computes the sections the
 * caller may read, and links to the queue where the work is done.
 */
const TILES: Array<{ section: keyof Workload; key: string; label: string; href: string }> = [
  { section: 'orders', key: 'confirmed', label: 'Orders confirmed', href: '/dashboard/orders?status=CONFIRMED' },
  { section: 'orders', key: 'processing', label: 'Orders processing', href: '/dashboard/orders?status=PROCESSING' },
  { section: 'orders', key: 'exception', label: 'Orders in exception', href: '/dashboard/orders?status=EXCEPTION' },
  { section: 'orders', key: 'invoiceFailed', label: 'Invoice generation failed', href: '/dashboard/orders?invoiceStatus=FAILED' },
  { section: 'warehouse', key: 'pendingPicks', label: 'Picks pending', href: '/dashboard/warehouse/picks?status=PENDING' },
  { section: 'warehouse', key: 'pickExceptions', label: 'Pick shortfalls / exceptions', href: '/dashboard/warehouse/picks?status=EXCEPTION' },
  { section: 'procurement', key: 'awaitingApproval', label: 'POs awaiting approval', href: '/dashboard/purchase-orders?status=SUBMITTED' },
  { section: 'procurement', key: 'awaitingReceipt', label: 'POs awaiting receipt', href: '/dashboard/receiving' },
  { section: 'inventory', key: 'transfersInTransit', label: 'Transfers in transit', href: '/dashboard/inventory/transfers?status=IN_TRANSIT' },
  { section: 'returns', key: 'requested', label: 'Returns requested', href: '/dashboard/returns?status=REQUESTED' },
  { section: 'returns', key: 'inTransit', label: 'Returns in transit', href: '/dashboard/returns' },
  { section: 'returns', key: 'awaitingQc', label: 'Returns awaiting QC', href: '/dashboard/returns?status=RECEIVED' },
  { section: 'exchanges', key: 'open', label: 'Exchanges open', href: '/dashboard/exchanges' },
  { section: 'exchanges', key: 'replacementAllocated', label: 'Replacements to fulfil', href: '/dashboard/exchanges?status=REPLACEMENT_ALLOCATED' },
  { section: 'refunds', key: 'pending', label: 'Refunds pending', href: '/dashboard/refunds?status=PENDING' },
  { section: 'refunds', key: 'failed', label: 'Refunds failed', href: '/dashboard/refunds?status=FAILED' },
];

export default function DashboardHome() {
  const session = useSession();
  const workload = useApi<Workload>('/admin/dashboard/workload');

  return (
    <div>
      <PageHeader title="Overview" description={`Signed in with roles: ${session.roles.join(', ') || 'none'}.`} />
      <DataState state={workload}>
        {(data) => {
          const tiles = TILES.filter((t) => data[t.section] !== undefined);
          if (tiles.length === 0) {
            return <p className="muted">There are no work queues for your role. Use the navigation to open a section.</p>;
          }
          return (
            <section aria-label="Work queues" className="kpis">
              {tiles.map((t) => (
                <Link key={`${t.section}.${t.key}`} href={t.href} className="kpi">
                  <div className="kpi-label">{t.label}</div>
                  <div className="kpi-value">{formatNumber(data[t.section]?.[t.key] ?? 0)}</div>
                </Link>
              ))}
            </section>
          );
        }}
      </DataState>
    </div>
  );
}
