'use client';

import Link from 'next/link';
import { useState } from 'react';
import { ActionMessage, Can, ConfirmDialog, DataState, DataTable, DateText, Drawer, Money, Notice, PageHeader, Pagination, SelectField, StatusBadge, TextField } from '@/components/ui';
import { apiSend, newIdempotencyKey, qs, type Page } from '@/lib/api';
import { useAction, useApi, useUrlFilter } from '@/lib/session';

interface GiftCardRow {
  id: string;
  codeLast4: string;
  status: string;
  initialValue: number;
  balance: number;
  currency: string;
  issuedAt: string | null;
  expiresAt: string | null;
  disabledAt: string | null;
  createdAt: string;
}

const TAKE = 50;

/**
 * Gift cards (M30). Cards are found by status or the last four characters
 * of the code; the full code is never listed or re-derivable. It is shown
 * once, in the response to issuing a card.
 */
export default function GiftCardsPage() {
  const [status, setStatus] = useUrlFilter('status');
  const [last4, setLast4, ready] = useUrlFilter('last4');
  const [skip, setSkip] = useState(0);
  const lookup = last4.trim().length === 4 ? last4.trim() : '';
  const cards = useApi<Page<GiftCardRow>>(ready ? `/admin/gift-cards${qs({ status, last4: lookup, take: TAKE, skip })}` : null);
  const [issuing, setIssuing] = useState(false);
  const sweep = useAction();
  const [confirmSweep, setConfirmSweep] = useState(false);

  return (
    <div>
      <PageHeader
        title="Gift cards"
        breadcrumbs={[{ label: 'Commercial' }, { label: 'Gift cards' }]}
        actions={
          <Can anyOf={['giftcard:manage']}>
            <button type="button" className="btn" onClick={() => setConfirmSweep(true)}>
              Release stale checkout holds
            </button>
            <button type="button" className="primary" onClick={() => setIssuing(true)}>
              Issue gift card
            </button>
          </Can>
        }
      />
      <ActionMessage message={sweep.message} />
      <div className="filter-bar" role="search">
        <TextField
          label="Last four of code"
          value={last4}
          placeholder="e.g. 7K2Q"
          onChange={(v) => {
            setLast4(v);
            setSkip(0);
          }}
        />
        <SelectField
          label="Status"
          value={status}
          placeholder="All statuses"
          options={['ACTIVE', 'DISABLED', 'DEPLETED'].map((s) => ({ value: s, label: s.toLowerCase() }))}
          onChange={(v) => {
            setStatus(v);
            setSkip(0);
          }}
        />
      </div>
      <DataState state={cards}>
        {(data) => (
          <>
            <DataTable
              caption="Gift cards"
              rows={data.items}
              rowKey={(c) => c.id}
              empty="No gift cards match."
              columns={[
                {
                  header: 'Card',
                  cell: (c) => (
                    <Link href={`/dashboard/gift-cards/${c.id}`}>
                      <span className="mono">•••• {c.codeLast4}</span>
                    </Link>
                  ),
                },
                { header: 'Status', cell: (c) => <StatusBadge status={c.status} /> },
                { header: 'Initial value', numeric: true, cell: (c) => <Money value={c.initialValue} currency={c.currency} /> },
                { header: 'Balance', numeric: true, cell: (c) => <Money value={c.balance} currency={c.currency} /> },
                { header: 'Issued', cell: (c) => <DateText value={c.issuedAt} /> },
                { header: 'Expires', cell: (c) => <DateText value={c.expiresAt} /> },
              ]}
            />
            <Pagination total={data.total} take={TAKE} skip={skip} onChange={setSkip} />
          </>
        )}
      </DataState>
      <Drawer open={issuing} title="Issue gift card" onClose={() => setIssuing(false)}>
        <IssueForm onIssued={cards.reload} />
      </Drawer>
      <ConfirmDialog
        open={confirmSweep}
        title="Release stale checkout holds"
        confirmLabel="Release holds"
        busy={sweep.busy}
        onCancel={() => setConfirmSweep(false)}
        onConfirm={async () => {
          await sweep.run(async () => {
            const r = await apiSend<{ released: number }>('POST', '/gift-cards/sweep/release-stale-holds');
            setConfirmSweep(false);
            return r;
          }, 'Stale gift-card holds released.');
          setConfirmSweep(false);
          cards.reload();
        }}
      >
        <p>Releases gift-card balance held by checkouts that were abandoned. Safe to repeat.</p>
      </ConfirmDialog>
    </div>
  );
}

function IssueForm({ onIssued }: { onIssued: () => void }) {
  const action = useAction();
  const [key, setKey] = useState(() => newIdempotencyKey('giftcard'));
  const [value, setValue] = useState('');
  const [recipientEmail, setRecipientEmail] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [issued, setIssued] = useState<{ id: string; code: string; codeLast4: string } | null>(null);

  if (issued) {
    return (
      <div>
        <Notice kind="warning">
          This is the only time the full code is shown. Give it to the recipient now; it cannot be retrieved later.
        </Notice>
        <p>
          Code: <strong className="mono" data-testid="issued-gift-card-code">{issued.code}</strong>
        </p>
        <p>
          <Link href={`/dashboard/gift-cards/${issued.id}`}>Open card •••• {issued.codeLast4}</Link>
        </p>
        <button
          type="button"
          className="btn"
          onClick={() => {
            setIssued(null);
            setValue('');
            setKey(newIdempotencyKey('giftcard'));
          }}
        >
          Issue another
        </button>
      </div>
    );
  }

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        await action.run(async () => {
          const res = await apiSend<{ giftCard: { id: string; codeLast4: string }; code?: string }>('POST', '/gift-cards/issue', {
            initialValue: Number(value),
            recipientEmail: recipientEmail || undefined,
            expiresAt: expiresAt ? new Date(expiresAt).toISOString() : undefined,
            idempotencyKey: key,
          });
          // A replayed request (same key) returns the card without its code again.
          setIssued({ id: res.giftCard.id, codeLast4: res.giftCard.codeLast4, code: res.code ?? '(already shown when first issued)' });
          onIssued();
        });
      }}
    >
      <ActionMessage message={action.message} />
      <TextField label="Value (INR)" type="number" step="0.01" required value={value} onChange={setValue} />
      <TextField label="Recipient email" type="email" value={recipientEmail} onChange={setRecipientEmail} />
      <TextField label="Expires" type="date" value={expiresAt} onChange={setExpiresAt} />
      <button className="primary" type="submit" disabled={action.busy}>
        Issue gift card
      </button>
    </form>
  );
}
