'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ActionMessage, Checkbox, PageHeader, Section, SelectField, TextArea, TextField } from '@/components/ui';
import { apiSend } from '@/lib/api';
import { useAction, useApi } from '@/lib/session';

/**
 * POST /promotions. The promotion service validates the rules (percentage
 * range, coupon uniqueness, dates); checkout alone decides eligibility and
 * stacking at order time.
 */
export default function NewPromotionPage() {
  const router = useRouter();
  const types = useApi<Array<{ id: string; key: string; name: string }>>('/admin/promotion-types');
  const action = useAction();
  const [f, setF] = useState({
    name: '',
    description: '',
    promotionTypeKey: '',
    isCoupon: false,
    couponCode: '',
    discountType: 'PERCENTAGE',
    discountValue: '',
    maxDiscountAmount: '',
    minCartValue: '',
    stackGroup: '',
    priority: '100',
    startsAt: '',
    endsAt: '',
    usageLimitTotal: '',
    usageLimitPerCustomer: '',
    loyaltyCompatible: true,
    storeCreditCompatible: true,
    giftCardCompatible: true,
  });
  const set = <K extends keyof typeof f>(k: K) => (v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const num = (v: string) => (v === '' ? undefined : Number(v));

  return (
    <div style={{ maxWidth: 860 }}>
      <PageHeader
        title="New promotion"
        breadcrumbs={[{ label: 'Commercial' }, { label: 'Promotions', href: '/dashboard/promotions' }, { label: 'New' }]}
        description="A new promotion is active from its start date unless you deactivate it."
      />
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const ok = await action.run(() =>
            apiSend('POST', '/promotions', {
              name: f.name,
              description: f.description || undefined,
              promotionTypeKey: f.promotionTypeKey,
              isCoupon: f.isCoupon,
              couponCode: f.isCoupon ? f.couponCode : undefined,
              discountType: f.discountType,
              discountValue: Number(f.discountValue),
              maxDiscountAmount: num(f.maxDiscountAmount),
              minCartValue: num(f.minCartValue),
              stackGroup: f.stackGroup || undefined,
              priority: num(f.priority),
              startsAt: new Date(f.startsAt).toISOString(),
              endsAt: f.endsAt ? new Date(f.endsAt).toISOString() : undefined,
              usageLimitTotal: num(f.usageLimitTotal),
              usageLimitPerCustomer: num(f.usageLimitPerCustomer),
              loyaltyCompatible: f.loyaltyCompatible,
              storeCreditCompatible: f.storeCreditCompatible,
              giftCardCompatible: f.giftCardCompatible,
            }),
          );
          if (ok) router.push('/dashboard/promotions');
        }}
      >
        <ActionMessage message={action.message} />
        <Section title="What it is">
          <div className="form-row">
            <TextField label="Name" required value={f.name} onChange={set('name')} />
            <SelectField
              label="Promotion type"
              required
              value={f.promotionTypeKey}
              onChange={set('promotionTypeKey')}
              placeholder={types.data ? 'Choose a type' : 'Loading…'}
              options={(types.data ?? []).map((t) => ({ value: t.key, label: t.name }))}
            />
          </div>
          <TextArea label="Description" value={f.description} onChange={set('description')} />
          <Checkbox label="Requires a coupon code (otherwise applies automatically)" checked={f.isCoupon} onChange={set('isCoupon')} />
          {f.isCoupon && <TextField label="Coupon code" required value={f.couponCode} onChange={set('couponCode')} />}
        </Section>
        <Section title="Discount">
          <div className="form-row">
            <SelectField
              label="Discount type"
              value={f.discountType}
              onChange={set('discountType')}
              options={[
                { value: 'PERCENTAGE', label: 'Percentage' },
                { value: 'FLAT_AMOUNT', label: 'Flat amount (INR)' },
              ]}
            />
            <TextField label={f.discountType === 'PERCENTAGE' ? 'Percent off' : 'Amount off (INR)'} type="number" step="0.01" required value={f.discountValue} onChange={set('discountValue')} />
            <TextField label="Maximum discount (INR)" type="number" step="0.01" value={f.maxDiscountAmount} onChange={set('maxDiscountAmount')} />
            <TextField label="Minimum cart value (INR)" type="number" step="0.01" value={f.minCartValue} onChange={set('minCartValue')} />
          </div>
        </Section>
        <Section title="Window, limits and stacking">
          <div className="form-row">
            <TextField label="Starts" type="datetime-local" required value={f.startsAt} onChange={set('startsAt')} />
            <TextField label="Ends" type="datetime-local" value={f.endsAt} onChange={set('endsAt')} />
            <TextField label="Total uses allowed" type="number" min={1} value={f.usageLimitTotal} onChange={set('usageLimitTotal')} />
            <TextField label="Uses per customer" type="number" min={1} value={f.usageLimitPerCustomer} onChange={set('usageLimitPerCustomer')} />
          </div>
          <div className="form-row">
            <TextField label="Stack group" value={f.stackGroup} onChange={set('stackGroup')} hint="Promotions in the same group never combine." />
            <TextField label="Priority" type="number" value={f.priority} onChange={set('priority')} hint="Lower applies first." />
          </div>
          <Checkbox label="Can combine with loyalty points" checked={f.loyaltyCompatible} onChange={set('loyaltyCompatible')} />
          <Checkbox label="Can combine with store credit" checked={f.storeCreditCompatible} onChange={set('storeCreditCompatible')} />
          <Checkbox label="Can combine with a gift card" checked={f.giftCardCompatible} onChange={set('giftCardCompatible')} />
        </Section>
        <button className="primary" type="submit" disabled={action.busy}>
          {action.busy ? 'Creating…' : 'Create promotion'}
        </button>
      </form>
    </div>
  );
}
