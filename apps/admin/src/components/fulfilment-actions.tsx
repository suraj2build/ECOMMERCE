'use client';

import Link from 'next/link';
import { useState } from 'react';
import { apiSend, newIdempotencyKey } from '@/lib/api';
import { useAction, useApi } from '@/lib/session';
import { ActionMessage, Can, ConfirmDialog, TextField } from './ui';

interface PackLine {
  skuCode: string;
  name: string;
  colour: string;
  size: string;
  quantity: number;
  barcode: string | null;
}

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

const STEPS: Record<Step, { label: string; perm: string; body: string; done: string }> = {
  pack: {
    label: 'Mark packed',
    perm: 'order:fulfil',
    body: 'Confirms every unit in this package is packed. Scan each unit as it goes into the parcel; the server checks the scans match the order exactly.',
    done: 'Packed. Next: mark it ready to ship.',
  },
  'ready-to-ship': {
    label: 'Ready to ship',
    perm: 'order:fulfil',
    body: 'Hands the package from the warehouse to shipping.',
    done: 'Ready to ship. Next: book it with the courier.',
  },
  shipment: {
    label: 'Book shipment with carrier',
    perm: 'shipping:manage',
    body: 'Books the shipment with the configured carrier. The parcel weight and size recorded at packing are sent with the booking. A retry uses the same request key, so it never double-books. Booking takes the units out of stock and marks the package shipped now; it shows as "Booked — awaiting collection" until the handover to the courier is confirmed on the Courier handover page.',
    done: 'Booked with the courier. When they collect it, confirm the handover on the Courier handover page.',
  },
  ship: { label: 'Mark shipped manually', perm: 'order:fulfil', body: 'Records a shipment handed over outside the carrier integration.', done: 'Marked shipped.' },
  deliver: { label: 'Mark delivered', perm: 'order:fulfil', body: 'Records delivery. Normally the carrier reports this.', done: 'Marked delivered.' },
};

/** The steps that apply to a package in this status, in the order they happen. */
const STEPS_FOR: Record<string, Step[]> = {
  PENDING: ['pack'],
  PACKED: ['ready-to-ship'],
  READY_TO_SHIP: ['shipment', 'ship'],
  SHIPPED: ['deliver'],
};

/** What happens next for a package in this status. */
const NEXT_FOR: Record<string, string> = {
  PENDING: 'Next: pack it, scanning each unit.',
  PACKED: 'Next: mark it ready to ship.',
  READY_TO_SHIP: 'Next: book it with the courier (or record a shipment sent another way).',
};

/**
 * Fulfilment transitions for one package. Every button calls the existing
 * order/shipping route; which transition is legal from the current status
 * is decided by the server and its refusal is shown as-is. The same
 * controls serve order- and exchange-sourced fulfilments.
 */
/** `onChanged` receives the step's own confirmation, for screens that close their panel and show it elsewhere. */
export function FulfilmentActions({ fulfilment, onChanged }: { fulfilment: FulfilmentLike; onChanged: (done: string) => void }) {
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
  // What should go in the parcel, so each scan can be named rather than shown as a bare code.
  // Needs order:read; without it the dialog falls back to the codes alone.
  const contents = useApi<{ lines: PackLine[] }>(step === 'pack' ? `/orders/fulfilments/${fulfilment.id}/documents` : null);

  const open = (s: Step) => {
    // One idempotency key per dialog opening, reused if the operator retries.
    setKey(newIdempotencyKey('shipment'));
    action.clear();
    setStep(s);
  };
  const steps = STEPS_FOR[fulfilment.status] ?? [];

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
    const ok = await action.run(() => apiSend('POST', path, body), STEPS[s].done);
    if (ok) {
      setStep(null);
      setScans([]);
      setWeight('');
      setDims({ l: '', w: '', h: '' });
      onChanged(STEPS[s].done);
    }
  }

  return (
    <div>
      {step === null && <ActionMessage message={action.message} />}
      {NEXT_FOR[fulfilment.status] && step === null && action.message === null && <p className="muted">{NEXT_FOR[fulfilment.status]}</p>}
      <div className="row">
        <Link className="btn small" href={`/dashboard/fulfilments/${fulfilment.id}/documents?doc=slip`}>
          Packing slip
        </Link>
        <Link className="btn small" href={`/dashboard/fulfilments/${fulfilment.id}/documents?doc=label`}>
          Address label
        </Link>
        {steps.map((s, i) => (
          <Can key={s} anyOf={[STEPS[s].perm]}>
            <button type="button" className={i === 0 ? 'btn small primary' : 'btn small'} disabled={action.busy} onClick={() => open(s)}>
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
        onCancel={() => {
          action.clear();
          setStep(null);
        }}
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
            {contents.data ? (
              <PackProgress lines={contents.data.lines} scans={scans} />
            ) : (
              scans.length > 0 && (
                <p>
                  Scanned {scans.length}: <span className="mono">{scans.join(', ')}</span>
                </p>
              )
            )}
            {scans.length > 0 && (
              <button type="button" className="link-button" onClick={() => setScans((cur) => cur.slice(0, -1))}>
                Undo last scan
              </button>
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

/** Scan progress per item; the server still makes the binding check when the package is marked packed. */
function PackProgress({ lines, scans }: { lines: PackLine[]; scans: string[] }) {
  const known = new Set(lines.map((l) => l.barcode).filter((b): b is string => Boolean(b)));
  const strays = scans.filter((code) => !known.has(code));
  return (
    <div>
      <ul aria-label="Items in this package" style={{ listStyle: 'none', paddingLeft: 0 }}>
        {lines.map((l, i) => {
          const scanned = l.barcode ? scans.filter((code) => code === l.barcode).length : 0;
          const state = !l.barcode ? 'no barcode' : scanned === l.quantity ? 'done' : scanned > l.quantity ? 'too many' : 'to scan';
          return (
            <li key={`${l.skuCode}-${i}`}>
              {state === 'done' ? '✓ ' : state === 'too many' ? '⚠ ' : '○ '}
              {l.name} · {l.colour} · {l.size} — {l.barcode ? `${scanned} of ${l.quantity} scanned` : `${l.quantity} (no barcode on file)`}
              {state === 'too many' && <strong> - scanned more than ordered; undo the extra scan</strong>}
            </li>
          );
        })}
      </ul>
      {strays.length > 0 && (
        <p className="error-banner" role="alert">
          Not in this package: <span className="mono">{strays.join(', ')}</span>. Take that item out and undo the scan.
        </p>
      )}
    </div>
  );
}
