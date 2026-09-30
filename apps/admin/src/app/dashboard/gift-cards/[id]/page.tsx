'use client';

import { useParams } from 'next/navigation';
import { useState } from 'react';
import { ActionMessage, Can, ConfirmDialog, DataState, DataTable, DateText, Money, PageHeader, Section, StatusBadge, TextArea, TextField } from '@/components/ui';
import { apiSend, newIdempotencyKey } from '@/lib/api';
import { useAction, useApi } from '@/lib/session';

interface GiftCard {
  id: string;
  codeLast4: string;
  status: string;
  initialValue: number;
  balance: number;
  currency: string;
  recipientEmail: string | null;
  issuedAt: string | null;
  expiresAt: string | null;
  disabledAt: string | null;
  disabledReason: string | null;
  entries: Array<{ id: string; type: string; amount: number; balanceAfter: number; referenceType: string | null; reason: string | null; createdAt: string }>;
}

/** Card detail and ledger. Balance changes only through the gift-card service's ledger entries. */
export default function GiftCardDetailPage() {
  const { id } = useParams<{ id: string }>();
  const card = useApi<GiftCard>(`/gift-cards/${id}`);
  const action = useAction();
  const [dialog, setDialog] = useState<'adjust' | 'disable' | null>(null);
  const [delta, setDelta] = useState('');
  const [reason, setReason] = useState('');
  const [key, setKey] = useState('');

  return (
    <DataState state={card}>
      {(c) => (
        <div>
          <PageHeader
            title={`Gift card •••• ${c.codeLast4}`}
            description={<StatusBadge status={c.status} />}
            breadcrumbs={[{ label: 'Commercial' }, { label: 'Gift cards', href: '/dashboard/gift-cards' }, { label: `•••• ${c.codeLast4}` }]}
            actions={
              <Can anyOf={['giftcard:manage']}>
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    setDelta('');
                    setReason('');
                    setKey(newIdempotencyKey('giftcard-adjust'));
                    action.clear();
                    setDialog('adjust');
                  }}
                >
                  Adjust balance
                </button>
                {c.status !== 'DISABLED' && (
                  <button
                    type="button"
                    className="btn danger"
                    onClick={() => {
                      setReason('');
                      action.clear();
                      setDialog('disable');
                    }}
                  >
                    Disable card
                  </button>
                )}
              </Can>
            }
          />
          <ActionMessage message={dialog ? null : action.message} />
          <Section title="Balance">
            <dl className="dl">
              <dt>Balance</dt>
              <dd data-testid="gift-card-balance">
                <strong>
                  <Money value={c.balance} currency={c.currency} />
                </strong>
              </dd>
              <dt>Initial value</dt>
              <dd>
                <Money value={c.initialValue} currency={c.currency} />
              </dd>
              <dt>Recipient</dt>
              <dd>{c.recipientEmail ?? '—'}</dd>
              <dt>Issued</dt>
              <dd>
                <DateText value={c.issuedAt} withTime />
              </dd>
              <dt>Expires</dt>
              <dd>
                <DateText value={c.expiresAt} />
              </dd>
              {c.disabledAt && (
                <>
                  <dt>Disabled</dt>
                  <dd>
                    <DateText value={c.disabledAt} withTime /> — {c.disabledReason}
                  </dd>
                </>
              )}
            </dl>
          </Section>
          <Section title="Ledger">
            <DataTable
              caption="Gift card ledger"
              rows={c.entries}
              rowKey={(e) => e.id}
              columns={[
                { header: 'When', cell: (e) => <DateText value={e.createdAt} withTime /> },
                { header: 'Type', cell: (e) => <StatusBadge status={e.type} /> },
                { header: 'Amount', numeric: true, cell: (e) => <Money value={e.amount} /> },
                { header: 'Balance after', numeric: true, cell: (e) => <Money value={e.balanceAfter} /> },
                { header: 'Reference', cell: (e) => e.referenceType ?? '—' },
                { header: 'Reason', cell: (e) => e.reason ?? '—' },
              ]}
            />
          </Section>
          <ConfirmDialog
            open={dialog !== null}
            title={dialog === 'adjust' ? 'Adjust balance' : 'Disable gift card'}
            confirmLabel={dialog === 'adjust' ? 'Record adjustment' : 'Disable card'}
            danger={dialog === 'disable'}
            busy={action.busy}
            onCancel={() => setDialog(null)}
            onConfirm={async () => {
              const ok = await action.run(
                () =>
                  dialog === 'adjust'
                    ? apiSend('POST', `/gift-cards/${c.id}/adjust`, { delta: Number(delta), reason, idempotencyKey: key })
                    : apiSend('POST', `/gift-cards/${c.id}/disable`, { reason }),
                dialog === 'adjust' ? 'Adjustment recorded.' : 'Card disabled.',
              );
              if (ok) {
                setDialog(null);
                card.reload();
              }
            }}
          >
            {dialog === 'adjust' && (
              <TextField label="Change (INR)" type="number" step="0.01" required value={delta} onChange={setDelta} hint="Positive credits the card, negative debits it. The balance cannot go below zero." />
            )}
            {dialog === 'disable' && <p>A disabled card cannot be redeemed. Its balance and ledger are kept.</p>}
            <TextArea label="Reason" required value={reason} onChange={setReason} />
            {action.message?.kind === 'error' && <ActionMessage message={action.message} />}
          </ConfirmDialog>
        </div>
      )}
    </DataState>
  );
}
