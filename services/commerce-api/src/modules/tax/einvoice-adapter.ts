/**
 * E-invoice / IRP adapter boundary (M08, specs/32-india-tax-invoicing.md
 * "E-invoice readiness"). No real IRP integration is authorized - this
 * exists so a real provider can be plugged in later, behind this same
 * interface, without an Invoice schema change.
 *
 * Deliberately kept as two separate concerns per the spec:
 *  1. whether e-invoicing APPLIES at all (isEInvoiceApplicable, driven by
 *     ComplianceProfile - AATO/turnover profile, effective date);
 *  2. IRP submission mechanics themselves (this adapter interface).
 * Applicability is decided by the caller (InvoiceService) before ever
 * consulting an adapter; the adapter never guesses applicability itself.
 */
import type { Invoice } from '@fcp/db';

export interface EInvoiceSubmissionResult {
  status: 'SUBMITTED' | 'ACKNOWLEDGED' | 'FAILED';
  irn?: string;
  irnAckNumber?: string;
  irnAckDate?: Date;
  irnQrPayload?: string;
  errorDetail?: string;
}

export interface EInvoiceAdapter {
  /** Submit an already-issued invoice for IRP reporting. */
  submitInvoice(invoice: Invoice): Promise<EInvoiceSubmissionResult>;
}

/**
 * Default adapter: no approved IRP provider/configuration exists yet.
 * Always reports FAILED with a clear, non-misleading reason rather than
 * pretending to have submitted anything - callers must not silently
 * treat this as success.
 */
export class NoOpEInvoiceAdapter implements EInvoiceAdapter {
  async submitInvoice(_invoice: Invoice): Promise<EInvoiceSubmissionResult> {
    return {
      status: 'FAILED',
      errorDetail: 'No IRP provider is configured. E-invoice submission is not yet authorized/available.',
    };
  }
}

/**
 * Applicability gate (concern 1 above). Fails safe: with no
 * ComplianceProfile row, or one not yet effective, e-invoicing is
 * NOT applicable - never assumed applicable, never assumed exempt by
 * guessing at turnover.
 */
export function isEInvoiceApplicable(
  profile: { einvoiceApplicable: boolean; einvoiceApplicableFrom: Date | null } | null,
  atDate: Date,
): boolean {
  if (!profile) return false;
  if (!profile.einvoiceApplicable) return false;
  if (profile.einvoiceApplicableFrom && atDate < profile.einvoiceApplicableFrom) return false;
  return true;
}
