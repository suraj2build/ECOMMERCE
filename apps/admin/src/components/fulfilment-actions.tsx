'use client';

import Link from 'next/link';
import { useState } from 'react';
import { apiSend, newIdempotencyKey } from '@/lib/api';
import { useAction, useApi } from '@/lib/session';
import { ActionMessage, Can, ConfirmDialog, TextField } from './ui';

interface DispatchSettings {
  requireScanAtPick: boolean;
  requireScanAtPack: boolean;
  requireParcelMeasurements: boolean;
}

export interface FulfilmentLike {
  id: string;
  status: string;
  shipment: { id: string; status: string; provider: string; trackingRef: string | null } | null;
}

type Step = 'pack' | 'ready-to-ship' | 'shipment' | 'ship' | 'deliver';

const STEPS: Record<Step, { label: string; perm: string; body: string }> = {
  pack: { label: 'Mark packed', perm: 'order:fulfil', body: 'Confirms every unit in this fulfilment is packed. Scan each unit as it goes into the parcel; the server checks the scans match the order exactly.' },
  'ready-to-ship': { label: 'Ready to ship', perm: 'order:fulfil', body: 'Hands the package from the warehouse to shipping.' },
  shipment: {
    label: 'Book shipment with carrier',
    perm: 'shipping:manage',
    body: 'Books the shipment with the configured carrier. The parcel weight and size recorded at packing are sent with the booking. A retry uses the same request key, so it never double-books. Handing the parcel to the courier is confirmed separately on the Courier handover page.',
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
  const settings = useApi<DispatchSettings>('/dispatch/settings');
  const [scan, setScan] = useState('');
  const [scans, setScans] = useState<string[]>([]);
  const [weight, setWeight] = useState('');
  const [dims, setDims] = useState({ l: '', w: '', h: '' });

  const open = (s: Step) => {
    // One idempotency key per dialog opening, reused if the operator retries.
    setKey(newIdempotencyKey('shipment'));
    setStep(s);
  };

  async function run(s: Step) {
    const path =
      s === 'shipment' ? `/orders/fulfilments/${fulfilment.id}/shipment` : `/orders/fulfilments/${fulfilment.id}/${s}`;
    const num = (v: string) => (v.trim() === '' ? undefined : Number(v));
    const body =
      s === 'shipment'
        ? { idempotencyKey: key }
        : s === 'ship'
          ? { carrierName: carrierName || undefined, trackingRef: trackingRef || undefined }
          : s === 'pack'
            ? {
                ...(scans.length > 0 ? { scannedBarcodes: scans } : {}),
                ...(weight || dims.l || dims.w || dims.h
                  ? { parcel: { weightGrams: num(weight), lengthCm: num(dims.l), widthCm: num(dims.w), heightCm: num(dims.h) } }
                  : {}),
              }
            : undefined;
    const ok = await action.run(() => apiSend('POST', path, body), `${STEPS[s].label}: done.`);
    if (ok) {
      setStep(null);
      setScans([]);
      setWeight('');
      setDims({ l: '', w: '', h: '' });
      onChanged();
    }
  }

  return (
    <div>
      <ActionMessage message={action.message} />
      <div className="row">
        <Link className="btn small" href={`/dashboard/fulfilments/${fulfilment.id}/documents?doc=slip`}>
          Packing slip
        </Link>
        <Link className="btn small" href={`/dashboard/fulfilments/${fulfilment.id}/documents?doc=label`}>
          Address label
        </Link>
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
        {step === 'pack' && (
          <>
            <TextField
              label={`Scan item barcode${settings.data?.requireScanAtPack ? ' (required)' : ''}`}
              value={scan}
              onChange={setScan}
              hint="A barcode scanner types the code and presses Enter. Scan every unit."
              onEnter={() => {
                if (scan.trim()) setScans((cur) => [...cur, scan.trim()]);
                setScan('');
              }}
            />
            {scans.length > 0 && (
              <p>
                Scanned {scans.length}: <span className="mono">{scans.join(', ')}</span>{' '}
                <button type="button" className="link-button" onClick={() => setScans((cur) => cur.slice(0, -1))}>
                  Undo last
                </button>
              </p>
            )}
            <div className="form-row">
              <TextField label={`Parcel weight (g)${settings.data?.requireParcelMeasurements ? ' (required)' : ''}`} type="number" min={1} value={weight} onChange={setWeight} />
              <TextField label="Length (cm)" type="number" min={1} value={dims.l} onChange={(v) => setDims((d) => ({ ...d, l: v }))} />
              <TextField label="Width (cm)" type="number" min={1} value={dims.w} onChange={(v) => setDims((d) => ({ ...d, w: v }))} />
              <TextField label="Height (cm)" type="number" min={1} value={dims.h} onChange={(v) => setDims((d) => ({ ...d, h: v }))} />
            </div>
          </>
        )}
        {action.message?.kind === 'error' && <ActionMessage message={action.message} />}
      </ConfirmDialog>
    </div>
  );
}
