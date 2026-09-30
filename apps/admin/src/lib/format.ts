/**
 * Display formatting only. Values are shown exactly as the API returned
 * them - zero, negative and null stay visible (null renders as an em
 * dash, never as 0).
 */

const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2 });
const num = new Intl.NumberFormat('en-IN');

export function formatMoney(value: number | string | null | undefined, currency = 'INR'): string {
  if (value === null || value === undefined || value === '') return '—';
  const n = typeof value === 'string' ? Number(value) : value;
  if (!Number.isFinite(n)) return String(value);
  if (currency !== 'INR') return `${currency} ${n.toFixed(2)}`;
  return inr.format(n);
}

export function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return num.format(value);
}

/** A 0..1 ratio as a percentage. */
export function formatRatio(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined) return '—';
  return `${(value * 100).toFixed(digits)}%`;
}

export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const d = typeof value === 'string' ? new Date(value) : value;
  return d.toLocaleDateString('en-IN', { year: 'numeric', month: 'short', day: 'numeric' });
}

export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const d = typeof value === 'string' ? new Date(value) : value;
  return d.toLocaleString('en-IN', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/** ENUM_VALUE -> "Enum value" for status badges and filters. */
export function humanize(value: string | null | undefined): string {
  if (!value) return '—';
  const s = value.replace(/_/g, ' ').toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** A short, copyable form of an internal id for places a business identifier does not exist. */
export function shortId(id: string | null | undefined): string {
  if (!id) return '—';
  return id.slice(0, 8);
}
