import { describe, it, expect } from 'vitest';
import { formatSequenceNumber } from '@fcp/shared';

describe('formatSequenceNumber', () => {
  it('zero-pads the sequence to 6 digits', () => {
    expect(formatSequenceNumber('PO', 2026, 42)).toBe('PO-2026-000042');
  });

  it('does not truncate a sequence wider than 6 digits', () => {
    expect(formatSequenceNumber('GRN', 2026, 1234567)).toBe('GRN-2026-1234567');
  });
});
