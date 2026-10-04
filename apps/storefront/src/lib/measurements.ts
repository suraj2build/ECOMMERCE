const UNITS: Record<string, string> = { in: 'in', inch: 'in', inches: 'in', cm: 'cm', mm: 'mm' };

/**
 * Size-chart measurements are free-form keys entered by staff. Data-style
 * keys are shown as words: chestIn: 38 -> "Chest 38 in", waist_cm: 76 ->
 * "Waist 76 cm", shoulder: 17 -> "Shoulder 17". A key that is already
 * written for people ("Chest (in)") is kept as it is.
 */
export function formatMeasurement(key: string, value: unknown): string {
  const shown = String(value);
  if (/\s|\(/.test(key)) return `${key}: ${shown}`;
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[_\-\s]+/)
    .filter(Boolean)
    .map((w) => w.toLowerCase());
  const unit = words.length > 1 ? UNITS[words[words.length - 1]!] : undefined;
  if (unit) words.pop();
  const label = words.join(' ');
  return `${label.charAt(0).toUpperCase()}${label.slice(1)} ${shown}${unit ? ` ${unit}` : ''}`;
}
