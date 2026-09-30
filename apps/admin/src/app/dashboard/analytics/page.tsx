'use client';

import { useState, type ReactNode } from 'react';
import { DataState, DataTable, Ident, Money, PageHeader, Pagination, Section, TextField, type Column } from '@/components/ui';
import { qs } from '@/lib/api';
import { formatMoney, formatNumber, formatRatio } from '@/lib/format';
import { useApi, useCan } from '@/lib/session';

interface CommerceReport {
  sales: { grossSales: number; netSales: number; refundedAmount: number; orderCount: number; cancelledOrderCount: number; avgOrderValue: number };
  returns: { totalReturns: number; byStatus: Record<string, number> };
  refunds: { totalRefunded: number; byMethod: Record<string, number> };
  inventory: { totalOnHand: number; totalReserved: number; totalDamaged: number };
  customers: { totalCustomers: number; repeatCustomerCount: number; repeatCustomerRate: number };
  margin: { revenue: number; cost: number; margin: number; marginPercent: number; skusWithoutCost: number };
}

interface FashionReport {
  stylePerformance: Array<{ styleId: string; unitsSold: number; revenue: number }>;
  colourPerformance: Array<{ colourId: string; unitsSold: number; revenue: number }>;
  sizePerformance: Array<{ sizeId: string; unitsSold: number; revenue: number }>;
  stockAgeing: Array<{ skuId: string; daysSinceLastReceipt: number | null }>;
  sellThrough: Array<{ styleId: string; sellThroughRate: number }>;
  availability: { totalSkus: number; inStockSkus: number; availabilityRate: number };
  returnReasons: Array<{ reason: string; count: number }>;
  sizeRelatedReturns: { count: number; rate: number };
}

interface ProcurementReport {
  supplierFillRate: Array<{ supplierId: string; fillRate: number }>;
  receiptQuality: Array<{ supplierId: string; shortQty: number; excessQty: number; damagedQty: number }>;
  leadTime: Array<{ supplierId: string; avgLeadTimeDays: number }>;
  purchaseVsSales: { totalPurchaseCost: number; salesRevenue: number };
  supplierPerformance: Array<{ supplierId: string; fillRate: number | null; defectRate: number | null; avgLeadTimeDays: number | null }>;
}

type LabelGroup = 'styleIds' | 'skuIds' | 'colourIds' | 'sizeIds' | 'supplierIds';
const GROUP_KEY: Record<LabelGroup, 'styles' | 'skus' | 'colours' | 'sizes' | 'suppliers'> = {
  styleIds: 'styles',
  skuIds: 'skus',
  colourIds: 'colours',
  sizeIds: 'sizes',
  supplierIds: 'suppliers',
};

/**
 * Analytics (M28). Every figure is the analytics service's own number,
 * shown as returned: zero, negative and missing (—) values stay visible,
 * no KPI is added or recomputed here. Ids are turned into names through
 * /admin/lookup/labels, only for entity types the viewer may read.
 */
export default function AnalyticsPage() {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const range = qs({ from: from ? new Date(from).toISOString() : undefined, to: to ? new Date(`${to}T23:59:59`).toISOString() : undefined });
  const commerce = useApi<CommerceReport>(`/analytics/commerce${range}`);
  const fashion = useApi<FashionReport>('/analytics/fashion');
  const procurement = useApi<ProcurementReport>(`/analytics/procurement${range}`);

  return (
    <div>
      <PageHeader
        title="Analytics"
        breadcrumbs={[{ label: 'Insights' }, { label: 'Analytics' }]}
        description="Computed from the order, refund, return, purchase-order, goods-receipt and inventory ledgers. The date range applies to commerce and procurement figures."
      />
      <div className="filter-bar">
        <TextField label="From" type="date" value={from} onChange={setFrom} />
        <TextField label="To" type="date" value={to} onChange={setTo} />
      </div>

      <h2 style={{ fontSize: '1.05rem' }}>Commerce</h2>
      <DataState state={commerce}>
        {(c) => (
          <>
            <section className="kpis" aria-label="Sales">
              <Kpi label="Gross sales" value={formatMoney(c.sales.grossSales)} hint="Excludes cancelled orders" />
              <Kpi label="Net sales" value={formatMoney(c.sales.netSales)} hint="Gross minus completed refunds" testId="kpi-net-sales" />
              <Kpi label="Refunded" value={formatMoney(c.sales.refundedAmount)} />
              <Kpi label="Orders" value={formatNumber(c.sales.orderCount)} hint={`${formatNumber(c.sales.cancelledOrderCount)} cancelled`} testId="kpi-orders" />
              <Kpi label="Average order value" value={formatMoney(c.sales.avgOrderValue)} />
              <Kpi label="Customers" value={formatNumber(c.customers.totalCustomers)} hint={`${formatNumber(c.customers.repeatCustomerCount)} repeat`} />
              <Kpi label="Repeat customer rate" value={formatRatio(c.customers.repeatCustomerRate)} />
            </section>
            <div className="grid-3">
              <Section title="Margin">
                <dl className="dl">
                  <dt>Revenue (taxable value)</dt>
                  <dd>{formatMoney(c.margin.revenue)}</dd>
                  <dt>Cost (PO unit cost)</dt>
                  <dd>{formatMoney(c.margin.cost)}</dd>
                  <dt>Margin</dt>
                  <dd>{formatMoney(c.margin.margin)}</dd>
                  <dt>Margin %</dt>
                  <dd>{formatRatio(c.margin.marginPercent)}</dd>
                  <dt>Lines without a PO cost</dt>
                  <dd>{formatNumber(c.margin.skusWithoutCost)}</dd>
                </dl>
              </Section>
              <Section title="Returns and refunds">
                <dl className="dl">
                  <dt>Returns</dt>
                  <dd>{formatNumber(c.returns.totalReturns)}</dd>
                  {Object.entries(c.returns.byStatus).map(([k, v]) => (
                    <Pair key={k} k={k.replace(/_/g, ' ').toLowerCase()} v={formatNumber(v)} />
                  ))}
                  <dt>Refunded total</dt>
                  <dd>{formatMoney(c.refunds.totalRefunded)}</dd>
                  {Object.entries(c.refunds.byMethod).map(([k, v]) => (
                    <Pair key={k} k={k.replace(/_/g, ' ').toLowerCase()} v={formatMoney(v)} />
                  ))}
                </dl>
              </Section>
              <Section title="Inventory">
                <dl className="dl">
                  <dt>On hand</dt>
                  <dd>{formatNumber(c.inventory.totalOnHand)}</dd>
                  <dt>Reserved</dt>
                  <dd>{formatNumber(c.inventory.totalReserved)}</dd>
                  <dt>Damaged</dt>
                  <dd>{formatNumber(c.inventory.totalDamaged)}</dd>
                </dl>
              </Section>
            </div>
          </>
        )}
      </DataState>

      <h2 style={{ fontSize: '1.05rem' }}>Fashion</h2>
      <DataState state={fashion}>
        {(f) => (
          <>
            <section className="kpis" aria-label="Availability">
              <Kpi label="SKUs" value={formatNumber(f.availability.totalSkus)} />
              <Kpi label="SKUs in stock" value={formatNumber(f.availability.inStockSkus)} hint="Available to sell > 0" />
              <Kpi label="Availability rate" value={formatRatio(f.availability.availabilityRate)} />
              <Kpi label="Size-related returns" value={formatNumber(f.sizeRelatedReturns.count)} hint={formatRatio(f.sizeRelatedReturns.rate)} />
            </section>
            <div className="grid-2">
              <LabelledTable title="Style performance" rows={f.stylePerformance} idKey="styleId" group="styleIds" perm="product:read" cols={salesCols} />
              <LabelledTable title="Sell-through by style" rows={f.sellThrough} idKey="styleId" group="styleIds" perm="product:read" cols={[{ header: 'Sell-through', numeric: true, cell: (r) => formatRatio(r.sellThroughRate) }]} />
              <LabelledTable title="Colour performance" rows={f.colourPerformance} idKey="colourId" group="colourIds" perm="product:read" cols={salesCols} />
              <LabelledTable title="Size performance" rows={f.sizePerformance} idKey="sizeId" group="sizeIds" perm="product:read" cols={salesCols} />
              <LabelledTable
                title="Stock ageing (days since last receipt)"
                rows={f.stockAgeing}
                idKey="skuId"
                group="skuIds"
                perm="product:read"
                cols={[{ header: 'Days', numeric: true, cell: (r) => (r.daysSinceLastReceipt === null ? '—' : formatNumber(r.daysSinceLastReceipt)) }]}
              />
              <Section title="Return reasons">
                <DataTable
                  caption="Return reasons"
                  rows={f.returnReasons}
                  rowKey={(r) => r.reason}
                  empty="No returns recorded."
                  columns={[
                    { header: 'Reason', cell: (r) => r.reason },
                    { header: 'Count', numeric: true, cell: (r) => formatNumber(r.count) },
                  ]}
                />
              </Section>
            </div>
          </>
        )}
      </DataState>

      <h2 style={{ fontSize: '1.05rem' }}>Procurement</h2>
      <DataState state={procurement}>
        {(p) => (
          <>
            <section className="kpis" aria-label="Purchasing">
              <Kpi label="Purchase cost (ordered)" value={formatMoney(p.purchaseVsSales.totalPurchaseCost)} />
              <Kpi label="Sales revenue (taxable)" value={formatMoney(p.purchaseVsSales.salesRevenue)} />
            </section>
            <div className="grid-2">
              <LabelledTable
                title="Supplier performance"
                rows={p.supplierPerformance}
                idKey="supplierId"
                group="supplierIds"
                perm="supplier:read"
                cols={[
                  { header: 'Fill rate', numeric: true, cell: (r) => formatRatio(r.fillRate) },
                  { header: 'Defect rate', numeric: true, cell: (r) => formatRatio(r.defectRate) },
                  { header: 'Avg lead time (days)', numeric: true, cell: (r) => (r.avgLeadTimeDays === null ? '—' : r.avgLeadTimeDays.toFixed(1)) },
                ]}
              />
              <LabelledTable
                title="Receipt quality"
                rows={p.receiptQuality}
                idKey="supplierId"
                group="supplierIds"
                perm="supplier:read"
                cols={[
                  { header: 'Short', numeric: true, cell: (r) => formatNumber(r.shortQty) },
                  { header: 'Excess', numeric: true, cell: (r) => formatNumber(r.excessQty) },
                  { header: 'Damaged', numeric: true, cell: (r) => formatNumber(r.damagedQty) },
                ]}
              />
            </div>
          </>
        )}
      </DataState>
    </div>
  );
}

const salesCols: Column<{ unitsSold: number; revenue: number }>[] = [
  { header: 'Units', numeric: true, cell: (r) => formatNumber(r.unitsSold) },
  { header: 'Revenue', numeric: true, cell: (r) => <Money value={r.revenue} /> },
];

function Kpi({ label, value, hint, testId }: { label: string; value: ReactNode; hint?: string; testId?: string }) {
  return (
    <div className="kpi">
      <div className="kpi-label">{label}</div>
      <div className="kpi-value" data-testid={testId}>
        {value}
      </div>
      {hint && <div className="kpi-hint">{hint}</div>}
    </div>
  );
}

function Pair({ k, v }: { k: string; v: string }) {
  return (
    <>
      <dt style={{ paddingLeft: '1rem' }}>{k}</dt>
      <dd>{v}</dd>
    </>
  );
}

const PAGE = 20;

/** Every row the service returned, paged 20 at a time, with the id column named for the visible page only. */
function LabelledTable<R extends Record<string, unknown>>({
  title,
  rows,
  idKey,
  group,
  perm,
  cols,
}: {
  title: string;
  rows: R[];
  idKey: keyof R & string;
  group: LabelGroup;
  perm: string;
  cols: Column<R>[];
}) {
  const [skip, setSkip] = useState(0);
  const canLabel = useCan(perm);
  const page = rows.slice(skip, skip + PAGE);
  const ids = page.map((r) => String(r[idKey]));
  const labels = useApi<Record<string, Record<string, string>>>(canLabel && ids.length ? `/admin/lookup/labels${qs({ [group]: ids.join(',') })}` : null);
  const name = (id: string) => labels.data?.[GROUP_KEY[group]]?.[id];
  return (
    <Section title={title}>
      <DataTable
        caption={title}
        rows={page}
        rowKey={(r) => String(r[idKey])}
        empty="No data yet."
        columns={[{ header: 'Item', cell: (r) => name(String(r[idKey])) ?? <Ident>{String(r[idKey]).slice(0, 8)}</Ident> }, ...cols]}
      />
      {rows.length > PAGE && <Pagination total={rows.length} take={PAGE} skip={skip} onChange={setSkip} />}
    </Section>
  );
}
