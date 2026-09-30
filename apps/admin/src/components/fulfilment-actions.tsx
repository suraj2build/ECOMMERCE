'use client';

import { useState } from 'react';
import { apiSend, newIdempotencyKey } from '@/lib/api';
import { useAction } from '@/lib/session';
import { ActionMessage, Can, ConfirmDialog, TextField } from './ui';

export interface FulfilmentLike {
  id: string;
  status: string;
  shipment: { id: string; status: string; provider: string; trackingRef: string | null } | null;
}

type Step = 'pack' | 'ready-to-ship' | 'shipment' | 'ship' | 'deliver';

const STEPS: Record<Step, { label: string; perm: string; body: string }> = {
  pack: { label: 'Mark packed', perm: 'order:fulfil', body: 'Confirms every unit in this fulfilment is packed.' },
  'ready-to-ship': { label: 'Ready to ship', perm: 'order:fulfil', body: 'Hands the package from the warehouse to shipping.' },
  shipment: {
    label: 'Book shipment with carrier',
    perm: 'shipping:manage',
    body: 'Books the shipment with the configured carrier and marks the fulfilment shipped. A retry uses the same request key, so it never double-books.',
  },
  ship: { label: 'Mark shipped manually', perm: 'order:fulfil', body: 'Records a shipment handed over outside the carrier integration.' },
  deliver: { label: 'Mark delivered', perm: 'order:fulfil', body: 'Records delivery. Normally the carrier reports this.' },
};

/**
 * Fulfilment transitions for one package. Every button calls the existing
 * order/shipping route; which transition is legal from the current status
 * is decided by the server and its refusal is shown as-is. The same
 * controls serve order- and exchange-sourced fulfilments.
 */
export function FulfilmentActions({ fulfilment, onChanged }: { fulfilment: FulfilmentLike; onChanged: () => void }) {
  const action = useAction();
  const [step, setStep] = useState<Step | null>(null);
  const [key, setKey] = useState('');
  const [carrierName, setCarrierName] = useState('');
  const [trackingRef, setTrackingRef] = useState('');

  const open = (s: Step) => {
    // One idempotency key per dialog opening, reused if the operator retries.
    setKey(newIdempotencyKey('shipment'));
    setStep(s);
  };

  async function run(s: Step) {
    const path =
      s === 'shipment' ? `/orders/fulfilments/${fulfilment.id}/shipment` : `/orders/fulfilments/${fulfilment.id}/${s}`;
    const body = s === 'shipment' ? { idempotencyKey: key } : s === 'ship' ? { carrierName: carrierName || undefined, trackingRef: trackingRef || undefined } : undefined;
    const ok = await action.run(() => apiSend('POST', path, body), `${STEPS[s].label}: done.`);
    if (ok) {
      setStep(null);
      onChanged();
    }
  }

  return (
    <div>
      <ActionMessage message={action.message} />
      <div className="row">
        {(Object.keys(STEPS) as Step[]).map((s) => (
          <Can key={s} anyOf={[STEPS[s].perm]}>
            <button type="button" className="btn small" disabled={action.busy} onClick={() => open(s)}>
              {STEPS[s].label}
            </button>
          </Can>
        ))}
      </div>
      <ConfirmDialog
        open={step !== null}
        title={step ? STEPS[step].label : ''}
        confirmLabel={step ? STEPS[step].label : 'Confirm'}
        busy={action.busy}
        onCancel={() => setStep(null)}
        onConfirm={() => step && void run(step)}
      >
        <p>{step && STEPS[step].body}</p>
        {step === 'ship' && (
          <>
            <TextField label="Carrier name" value={carrierName} onChange={setCarrierName} />
            <TextField label="Tracking reference" value={trackingRef} onChange={setTrackingRef} />
          </>
        )}
        {action.message?.kind === 'error' && <ActionMessage message={action.message} />}
      </ConfirmDialog>
    </div>
  );
}
