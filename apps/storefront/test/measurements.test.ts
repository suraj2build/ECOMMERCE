import { describe, expect, it } from 'vitest';
import { formatMeasurement } from '@/lib/measurements';

describe('size-chart measurements', () => {
  it('shows data-style keys as words with their unit', () => {
    expect(formatMeasurement('chestIn', 38)).toBe('Chest 38 in');
    expect(formatMeasurement('lengthIn', 41)).toBe('Length 41 in');
    expect(formatMeasurement('waist_cm', 76)).toBe('Waist 76 cm');
    expect(formatMeasurement('shoulderWidthIn', 17.5)).toBe('Shoulder width 17.5 in');
    expect(formatMeasurement('shoulder', 17)).toBe('Shoulder 17');
  });

  it('keeps keys that are already written for people', () => {
    expect(formatMeasurement('Chest (in)', 38)).toBe('Chest (in): 38');
    expect(formatMeasurement('Bust size', '34-36')).toBe('Bust size: 34-36');
  });

  it('does not mistake a one-word key for a unit', () => {
    expect(formatMeasurement('in', 3)).toBe('In 3');
  });
});
