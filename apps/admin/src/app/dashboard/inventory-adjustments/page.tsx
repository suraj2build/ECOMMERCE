'use client';

import { useState } from 'react';
import { apiFetch, ApiError } from '@/lib/api';

/**
 * Manual inventory adjustment (M29, ADM-003; FLOW 20). Below-threshold
 * adjustments complete with the submitting Warehouse-Manager-or-above
 * authorization alone; above-threshold adjustments require a Finance
 * co-approver. Server-side validation (packages under
 * services/commerce-api/src/modules/inventory) is authoritative - this
 * form never computes or enforces the threshold itself, it only submits
 * and surfaces whatever the server decides, including a 403 (FLOW 19)
 * that this screen shows honestly rather than hiding.
 */
export default function InventoryAdjustmentsPage() {
  const [skuId, setSkuId] = useState('');
  const [locationId, setLocationId] = useState('');
  const [quantityDelta, setQuantityDelta] = useState('');
  const [reason, setReason] = useState('');
  const [coApproverStaffId, setCoApproverStaffId] = useState('');
  const [message, setMessage] = useState<{ kind: 'error' | 'success'; text: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    setSubmitting(true);
    try {
      await apiFetch('/inventory/adjustments', {
        method: 'POST',
        body: JSON.stringify({
          skuId,
          locationId,
          quantityDelta: Number(quantityDelta),
          reason: reason || undefined,
          coApproverStaffId: coApproverStaffId || undefined,
        }),
      });
      setMessage({ kind: 'success', text: 'Adjustment recorded.' });
    } catch (err) {
      const text =
        err instanceof ApiError && err.status === 403
          ? `Forbidden: ${err.message}`
          : err instanceof Error
            ? err.message
            : 'Adjustment failed.';
      setMessage({ kind: 'error', text });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={{ maxWidth: 480 }}>
      <h1 style={{ fontSize: '1.25rem' }}>Manual Inventory Adjustment</h1>
      <form onSubmit={onSubmit} className="card">
        {message && <p className={message.kind === 'error' ? 'error-banner' : 'success-banner'} role="status">{message.text}</p>}
        <div className="field">
          <label htmlFor="skuId">SKU ID</label>
          <input id="skuId" required value={skuId} onChange={(e) => setSkuId(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="locationId">Location ID</label>
          <input id="locationId" required value={locationId} onChange={(e) => setLocationId(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="quantityDelta">Quantity delta</label>
          <input id="quantityDelta" type="number" required value={quantityDelta} onChange={(e) => setQuantityDelta(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="reason">Justification (required by the server)</label>
          <textarea id="reason" value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="coApproverStaffId">Finance co-approver staff ID (required above threshold)</label>
          <input id="coApproverStaffId" value={coApproverStaffId} onChange={(e) => setCoApproverStaffId(e.target.value)} />
        </div>
        <button className="primary" type="submit" disabled={submitting}>
          {submitting ? 'Submitting...' : 'Submit adjustment'}
        </button>
      </form>
    </div>
  );
}
