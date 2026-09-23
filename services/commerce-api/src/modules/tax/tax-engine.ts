/**
 * Pure GST computation functions (M08, specs/32-india-tax-invoicing.md).
 * No database access here deliberately - every rate/registration/HSN
 * value is a parameter, resolved by the caller from configurable
 * reference data (TaxConfigService). This is what "pluggable,
 * configurable tax engine" means concretely: swapping the configured
 * rate/registration rows changes computed tax with no code deployment,
 * because none of that data is hard-coded in these functions.
 */

/**
 * India's GST/financial year runs April 1 - March 31, expressed as
 * "YYYY-YY" (e.g. a date in Nov 2026 -> "2026-27"; a date in Feb 2027 is
 * still FY 2026-27).
 */
export function getIndianFinancialYear(date: Date): string {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth(); // 0-indexed; 3 = April
  const startYear = month >= 3 ? year : year - 1;
  const endYearShort = String((startYear + 1) % 100).padStart(2, '0');
  return `${startYear}-${endYearShort}`;
}

/**
 * CGST+SGST/UTGST applies when the supplying registration's state and the
 * place of supply are the same State/UT; IGST applies otherwise
 * (TAX-001's engineering-decided determination rule - see spec 32).
 */
export function determinePlaceOfSupply(params: {
  supplierStateCode: string;
  shippingStateCode: string;
}): { isIntraState: boolean } {
  return { isIntraState: params.supplierStateCode === params.shippingStateCode };
}

export interface TaxSplitInput {
  taxableValue: number;
  gstRatePercent: number;
  cessPercent?: number | null;
  isIntraState: boolean;
}

export interface TaxSplitResult {
  cgst: number;
  sgst: number;
  igst: number;
  cess: number;
  totalTax: number;
  lineTotal: number;
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * Splits a taxable value into CGST+SGST (intra-state, split evenly) or
 * IGST (inter-state), plus cess if configured. Never both CGST/SGST and
 * IGST nonzero on the same line - enforced here and again at the
 * database level (invoice_lines_cgst_sgst_igst_exclusive).
 */
export function splitTax(input: TaxSplitInput): TaxSplitResult {
  const totalGst = round2((input.taxableValue * input.gstRatePercent) / 100);
  const cess = round2((input.taxableValue * (input.cessPercent ?? 0)) / 100);

  if (input.isIntraState) {
    const half = round2(totalGst / 2);
    const cgst = half;
    const sgst = round2(totalGst - half); // absorb rounding remainder in sgst
    return {
      cgst,
      sgst,
      igst: 0,
      cess,
      totalTax: round2(cgst + sgst + cess),
      lineTotal: round2(input.taxableValue + cgst + sgst + cess),
    };
  }

  return {
    cgst: 0,
    sgst: 0,
    igst: totalGst,
    cess,
    totalTax: round2(totalGst + cess),
    lineTotal: round2(input.taxableValue + totalGst + cess),
  };
}

export { round2 };
