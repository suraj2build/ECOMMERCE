'use client';

import Link from 'next/link';
import { useState } from 'react';
import { ActionMessage, Can, ConfirmDialog, DataState, DataTable, DateText, Money, PageHeader, StatusBadge, YesNo } from '@/components/ui';
import { apiSend } from '@/lib/api';
import { useAction, useApi } from '@/lib/session';

interface Promotion {
  id: string;
  name: string;
  promotionTypeId: string;
  isCoupon: boolean;
  couponCode: string | null;
  discountType: string;
  discountValue: string;
  maxDiscountAmount: string | null;
  minCartValue: string | null;
  stackGroup: string | null;
  priority: number;
  startsAt: string;
  endsAt: string | null;
  isActive: boolean;
  usageLimitTotal: number | null;
  usageCountTotal: number;
  usageLimitPerCustomer: number | null;
  loyaltyCompatible: boolean;
  storeCreditCompatible: boolean;
  giftCardCompatible: boolean;
}

/**
 * Promotions (M24). Eligibility, stacking and usage caps are evaluated by
 * checkout; the console creates promotions and switches them on or off.
 */
export default function PromotionsPage() {
  const promotions = useApi<Promotion[]>('/promotions');
  const types = useApi<Array<{ id: string; key: string; name: string }>>('/admin/promotion-types');
  const action = useAction();
  const [toggle, setToggle] = useState<Promotion | null>(null);

  return (
    <div>
      <PageHeader
        title="Promotions"
        breadcrumbs={[{ label: 'Commercial' }, { label: 'Promotions' }]}
        description="Ordered by priority (lower applies first). Promotions sharing a stack group never combine."
        actions={
          <Can anyOf={['promotion:manage']}>
            <Link href="/dashboard/promotions/new" className="btn primary">
              New promotion
            </Link>
          </Can>
        }
      />
      <ActionMessage message={toggle ? null : action.message} />
      <DataState state={promotions}>
        {(rows) => (
          <DataTable
            caption="Promotions"
            rows={rows}
            rowKey={(p) => p.id}
            empty="No promotions yet."
            columns={[
              { header: 'Name', cell: (p) => p.name },
              { header: 'Type', cell: (p) => types.data?.find((t) => t.id === p.promotionTypeId)?.name ?? '—' },
              { header: 'Code', cell: (p) => (p.isCoupon ? <span className="mono">{p.couponCode}</span> : <span className="muted">Automatic</span>) },
              {
                header: 'Discount',
                cell: (p) =>
                  p.discountType === 'PERCENTAGE' ? (
                    <>
                      {Number(p.discountValue)}%{p.maxDiscountAmount && <span className="muted"> (max <Money value={p.maxDiscountAmount} />)</span>}
                    </>
                  ) : (
                    <Money value={p.discountValue} />
                  ),
              },
              { header: 'Min cart', numeric: true, cell: (p) => <Money value={p.minCartValue} /> },
              { header: 'Stack group', cell: (p) => p.stackGroup ?? '—' },
              { header: 'Priority', numeric: true, cell: (p) => p.priority },
              { header: 'Window', cell: (p) => (
                  <>
                    <DateText value={p.startsAt} /> – {p.endsAt ? <DateText value={p.endsAt} /> : 'open'}
                  </>
                ) },
              { header: 'Used', numeric: true, cell: (p) => `${p.usageCountTotal}${p.usageLimitTotal !== null ? ` / ${p.usageLimitTotal}` : ''}` },
              {
                header: 'Combines with',
                cell: (p) => (
                  <span className="muted" style={{ fontSize: '0.8rem' }}>
                    loyalty <YesNo value={p.loyaltyCompatible} /> credit <YesNo value={p.storeCreditCompatible} /> gift card <YesNo value={p.giftCardCompatible} />
                  </span>
                ),
              },
              { header: 'Status', cell: (p) => <StatusBadge status={p.isActive ? 'ACTIVE' : 'INACTIVE'} /> },
              {
                header: 'Actions',
                cell: (p) => (
                  <Can anyOf={['promotion:manage']}>
                    <button type="button" className={p.isActive ? 'btn small danger' : 'btn small'} onClick={() => setToggle(p)}>
                      {p.isActive ? 'Deactivate' : 'Activate'}
                    </button>
                  </Can>
                ),
              },
            ]}
          />
        )}
      </DataState>
      <ConfirmDialog
        open={toggle !== null}
        title={toggle?.isActive ? 'Deactivate promotion' : 'Activate promotion'}
        confirmLabel={toggle?.isActive ? 'Deactivate' : 'Activate'}
        danger={toggle?.isActive}
        busy={action.busy}
        onCancel={() => setToggle(null)}
        onConfirm={async () => {
          if (!toggle) return;
          const t = toggle;
          const ok = await action.run(() => apiSend('PATCH', `/promotions/${t.id}/active`, { isActive: !t.isActive }), `${t.name} ${t.isActive ? 'deactivated' : 'activated'}.`);
          setToggle(null);
          if (ok) promotions.reload();
        }}
      >
        <p>
          {toggle?.isActive
            ? `${toggle?.name} stops applying at checkout immediately. Orders already placed keep their discount.`
            : `${toggle?.name} applies at checkout from its start date, subject to its rules.`}
        </p>
      </ConfirmDialog>
    </div>
  );
}
