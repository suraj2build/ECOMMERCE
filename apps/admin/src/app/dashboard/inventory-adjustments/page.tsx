'use client';

import { useRef, useState } from 'react';
import { LocationSelect, SkuPicker, StaffSelect, type SkuOption } from '@/components/pickers';
import { BalanceCard, useSkuLocationFromUrl } from '@/components/sku-location';
import { ConfirmDialog, PageHeader, TextField } from '@/components/ui';
import { apiSend, errorMessage } from '@/lib/api';
import { useCan, useSession } from '@/lib/session';
import { SelfApprovalFields, useSelfApproval } from '@/components/self-approval';
import { randomUuid } from '@/lib/random-id';

/**
 * Manual inventory adjustment (M29, ADM-003; FLOW 20). Below-threshold
 * adjustments complete with the submitting Warehouse-Manager-or-above
 * authorization alone; above-threshold adjustments require a Finance
 * co-approver. Server-side validation (services/commerce-api/src/modules/
 * inventory) is authoritative - this form never computes or enforces the
 * threshold itself, it only submits and surfaces whatever the server
 * decides, including a 403 (FLOW 19) that this screen shows honestly
 * rather than hiding.
 *
 * P1: the SKU and location are chosen by SKU code and location name
 * rather than typed as ids, the balance is shown before and after, and
 * the co-approver is picked from staff who hold the approving
 * permission. The outcome stays in one role="status" region.
 */
export default function InventoryAdjustmentsPage() {
  const canReadInventory = useCan('inventory:read');
  const [sku, setSku] = useState<SkuOption | null>(null);
  const [locationId, setLocationId] = useState('');
  const [quantityDelta, setQuantityDelta] = useState('');
  const [reason, setReason] = useState('');
  const [coApproverStaffId, setCoApproverStaffId] = useState('');
  const session = useSession();
  const selfApproval = useSelfApproval();
  const approvingOwn = coApproverStaffId !== '' && coApproverStaffId === session.staffUserId;
  const [message, setMessage] = useState<{ kind: 'error' | 'success'; text: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [version, setVersion] = useState(0);
  const idempotencyKeyRef = useRef<string | null>(null);
  useSkuLocationFromUrl(setSku, setLocationId);

  function startNewAdjustment() {
    idempotencyKeyRef.current = null;
  }

  async function submit() {
    setConfirming(false);
    setMessage(null);
    setSubmitting(true);
    const idempotencyKey = idempotencyKeyRef.current ?? randomUuid();
    idempotencyKeyRef.current = idempotencyKey;
    try {
      const res = await apiSend<{ pendingApproval?: { approver: string } }>('POST', '/inventory/adjustments', {
        skuId: sku?.id,
        locationId,
        quantityDelta: Number(quantityDelta),
        reason: reason || undefined,
        coApproverStaffId: coApproverStaffId || undefined,
        ...(approvingOwn ? { selfApproval: selfApproval.value } : {}),
        idempotencyKey,
      });
      selfApproval.reset();
      idempotencyKeyRef.current = null;
      setMessage(
        res.pendingApproval
          ? {
              kind: 'success',
              text: `Sent to ${res.pendingApproval.approver} for approval. Stock does not change until they approve it on their Approvals page.`,
            }
          : { kind: 'success', text: `Adjustment recorded for ${sku?.skuCode}.` },
      );
      setQuantityDelta('');
      setReason('');
      setVersion((v) => v + 1);
    } catch (err) {
      selfApproval.clearSecrets();
      setMessage({ kind: 'error', text: errorMessage(err, 'Adjustment failed.') });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Manual inventory adjustment"
        description="Corrects on-hand stock with a recorded justification. Large adjustments need a Finance co-approver; the server applies the threshold."
        breadcrumbs={[{ label: 'Inventory' }, { label: 'Adjustments' }]}
      />
      <div className="grid-2">
        <form
          className="card"
          onSubmit={(e) => {
            e.preventDefault();
            setConfirming(true);
          }}
        >
          {message && (
            <p className={message.kind === 'error' ? 'error-banner' : 'success-banner'} role="status">
              {message.text}
            </p>
          )}
          <SkuPicker
            value={sku}
            onChange={(value) => {
              startNewAdjustment();
              setSku(value);
            }}
            required
          />
          <LocationSelect
            value={locationId}
            onChange={(value) => {
              startNewAdjustment();
              setLocationId(value);
            }}
            required
          />
          <TextField
            label="Quantity delta"
            type="number"
            required
            value={quantityDelta}
            onChange={(value) => {
              startNewAdjustment();
              setQuantityDelta(value);
            }}
            hint="Positive adds stock, negative removes it. The result can never go below zero."
          />
          <div className="field">
            <label htmlFor="reason">Justification (required by the server)</label>
            <textarea
              id="reason"
              value={reason}
              onChange={(e) => {
                startNewAdjustment();
                setReason(e.target.value);
              }}
            />
          </div>
          <StaffSelect
            label="Finance co-approver (required above threshold)"
            capability="inventory-coapprover"
            hint="Someone else approves it from their own login before stock changes."
            value={coApproverStaffId}
            onChange={(value) => {
              startNewAdjustment();
              setCoApproverStaffId(value);
            }}
          />
          {approvingOwn && <SelfApprovalFields what="stock adjustment" state={selfApproval} />}
          <button className="primary" type="submit" disabled={submitting || !sku || !locationId}>
            {submitting ? 'Submitting...' : 'Submit adjustment'}
          </button>
        </form>
        <div>
          {sku && locationId && canReadInventory ? (
            <BalanceCard skuId={sku.id} locationId={locationId} version={version} />
          ) : (
            <p className="muted">Choose a SKU and location to see the current balance.</p>
          )}
        </div>
      </div>
      <ConfirmDialog
        open={confirming}
        title="Confirm adjustment"
        confirmLabel="Record adjustment"
        busy={submitting}
        onCancel={() => setConfirming(false)}
        onConfirm={() => void submit()}
      >
        <p>
          Adjust <strong className="mono">{sku?.skuCode}</strong> by <strong>{quantityDelta}</strong> unit(s)? This writes an audited ledger entry.
        </p>
      </ConfirmDialog>
    </div>
  );
}
