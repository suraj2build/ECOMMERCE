/** Indian rupees in the en-IN style (₹1,23,456; paise only when present). */
export function formatINR(amount: number | string): string {
  const value = Number(amount);
  if (!Number.isFinite(value)) return '—';
  const whole = Number.isInteger(value);
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: whole ? 0 : 2,
  }).format(value);
}
