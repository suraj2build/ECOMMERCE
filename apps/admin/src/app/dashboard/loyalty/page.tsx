'use client';

import { useEffect, useState } from 'react';
import { ActionMessage, Can, ConfirmDialog, Notice, PageHeader, Section, TextArea, TextField } from '@/components/ui';
import { ApiError, apiFetch, apiSend, errorMessage, newIdempotencyKey, qs } from '@/lib/api';
import { formatNumber } from '@/lib/format';
import { useAction, useCan } from '@/lib/session';

interface CustomerSummary {
  id: string;
  fullName: string | null;
  mobile: string;
  loyalty: { availablePoints: number; pendingPoints: number };
}

type Sweep = 'vest' | 'expire' | 'release-stale-holds';
const SWEEPS: Record<Sweep, { label: string; body: string }> = {
  vest: {
    label: 'Vest eligible points',
    body: 'Moves PENDING points to AVAILABLE only for order lines that are delivered, whose return/exchange window has closed, and that have no open return or exchange (LOY-006). Points on any other line stay pending.',
  },
  expire: {
    label: 'Expire points',
    body: 'Expires vested points whose expiry date has passed, oldest first, and records an EXPIRE ledger entry for each.',
  },
  'release-stale-holds': {
    label: 'Release stale checkout holds',
    body: 'Releases points held by checkouts that were abandoned, making them spendable again. Nothing is deducted.',
  },
};

/**
 * Loyalty tools (loyalty:adjust). Manual adjustment and the three sweeps
 * call the loyalty service, which owns the ledger, vesting (LOY-006) and
 * expiry rules. Sweeps are privileged: each needs typed confirmation.
 */
export default function LoyaltyToolsPage() {
  return (
    <div>
      <PageHeader
        title="Loyalty tools"
        breadcrumbs={[{ label: 'Commercial' }, { label: 'Loyalty tools' }]}
        description="Manual point corrections and the scheduled-job sweeps, run by hand."
      />
      <AdjustPoints />
      <Can anyOf={['loyalty:adjust']}>
        <Sweeps />
      </Can>
    </div>
  );
}

function AdjustPoints() {
  const canLookup = useCan('customer_service:manage');
  const action = useAction();
  const [mobile, setMobile] = useState('');
  const [customer, setCustomer] = useState<CustomerSummary | null>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [points, setPoints] = useState('');
  const [reason, setReason] = useState('');
  const [key, setKey] = useState(() => newIdempotencyKey('loyalty-adjust'));
  const [confirming, setConfirming] = useState(false);

  async function lookup(m: string) {
    setLookupError(null);
    setCustomer(null);
    try {
      const found = await apiFetch<{ id: string }>(`/support/customers/lookup${qs({ mobile: m })}`);
      setCustomer(await apiFetch<CustomerSummary>(`/support/customers/${found.id}/360`));
    } catch (err) {
      setLookupError(err instanceof ApiError && err.status === 404 ? 'No customer has that mobile number.' : errorMessage(err));
    }
  }

  useEffect(() => {
    const m = new URLSearchParams(window.location.search).get('mobile');
    if (m && canLookup) {
      setMobile(m);
      void lookup(m);
    }
  }, [canLookup]);

  if (!canLookup) {
    return (
      <Section title="Adjust a customer's points">
        <Notice kind="info">
          Finding a customer needs Customer 360 access (customer_service:manage), which your role does not have. Whether Finance should get a separate customer
          lookup for loyalty corrections is an open decision (P1 decision D-1).
        </Notice>
      </Section>
    );
  }

  return (
    <Section title="Adjust a customer's points">
      <form
        className="row"
        style={{ alignItems: 'flex-end' }}
        onSubmit={(e) => {
          e.preventDefault();
          void lookup(mobile);
        }}
      >
        <TextField label="Customer mobile number" required value={mobile} onChange={setMobile} />
        <button className="btn" type="submit" style={{ marginBottom: '0.75rem' }}>
          Find customer
        </button>
      </form>
      {lookupError && <Notice kind="error">{lookupError}</Notice>}
      {customer && (
        <>
          <p>
            <strong>{customer.fullName ?? 'Unnamed customer'}</strong> · available <strong data-testid="loyalty-available">{formatNumber(customer.loyalty.availablePoints)}</strong>,
            pending {formatNumber(customer.loyalty.pendingPoints)} points
          </p>
          <ActionMessage message={confirming ? null : action.message} />
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setConfirming(true);
            }}
            style={{ maxWidth: 520 }}
          >
            <TextField label="Points to add or remove" type="number" required value={points} onChange={setPoints} hint="Negative removes points. The service does not cap a removal at the available balance (see P1 decision D-3), so check the balance above first." />
            <TextArea label="Reason" required value={reason} onChange={setReason} />
            <button className="primary" type="submit" disabled={action.busy}>
              Adjust points
            </button>
          </form>
          <ConfirmDialog
            open={confirming}
            title="Adjust loyalty points"
            confirmLabel="Record adjustment"
            busy={action.busy}
            onCancel={() => setConfirming(false)}
            onConfirm={async () => {
              const ok = await action.run(
                () => apiSend('POST', '/loyalty/adjust', { customerId: customer.id, pointsDelta: Number(points), reason, idempotencyKey: key }),
                'Adjustment recorded.',
              );
              setConfirming(false);
              if (ok) {
                setPoints('');
                setReason('');
                setKey(newIdempotencyKey('loyalty-adjust'));
                void lookup(mobile);
              }
            }}
          >
            <p>
              {Number(points) >= 0 ? 'Add' : 'Remove'} {formatNumber(Math.abs(Number(points)))} points for {customer.fullName ?? customer.mobile}. This writes an audited
              ADJUST ledger entry.
            </p>
            {action.message?.kind === 'error' && <ActionMessage message={action.message} />}
          </ConfirmDialog>
        </>
      )}
    </Section>
  );
}

function Sweeps() {
  const action = useAction();
  const [sweep, setSweep] = useState<Sweep | null>(null);
  const [done, setDone] = useState<string | null>(null);
  return (
    <Section title="Privileged sweeps">
      <Notice kind="warning">These change customer balances across the whole programme. They are safe to repeat, but run them deliberately.</Notice>
      <ActionMessage message={sweep ? null : action.message} />
      <div className="row">
        {(Object.keys(SWEEPS) as Sweep[]).map((s) => (
          <button
            key={s}
            type="button"
            className="btn"
            onClick={() => {
              action.clear();
              setDone(null);
              setSweep(s);
            }}
          >
            {SWEEPS[s].label}
          </button>
        ))}
      </div>
      <ConfirmDialog
        open={sweep !== null}
        title={sweep ? SWEEPS[sweep].label : ''}
        confirmLabel="Run sweep"
        danger
        requireText="RUN"
        busy={action.busy}
        onCancel={() => setSweep(null)}
        onConfirm={async () => {
          if (!sweep) return;
          const s = sweep;
          let summary = '';
          await action.run(async () => {
            const res = await apiSend<Record<string, number>>('POST', `/loyalty/sweep/${s}`);
            summary = Object.entries(res)
              .map(([k, v]) => `${k}: ${v}`)
              .join(', ');
          });
          setSweep(null);
          if (summary) setDone(`${SWEEPS[s].label} finished (${summary}).`);
        }}
      >
        <p>{sweep && SWEEPS[sweep].body}</p>
        {action.message?.kind === 'error' && <ActionMessage message={action.message} />}
      </ConfirmDialog>
      {done && <Notice kind="success">{done}</Notice>}
    </Section>
  );
}
