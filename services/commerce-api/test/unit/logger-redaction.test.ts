import { describe, it, expect } from 'vitest';
import { Writable } from 'node:stream';
import { createLogger } from '@fcp/shared';

describe('logger redaction', () => {
  it('redacts passwords and authenticator codes, including the nested step-up confirmations', () => {
    const lines: string[] = [];
    const sink = new Writable({
      write(chunk, _enc, done) {
        lines.push(String(chunk));
        done();
      },
    });
    const logger = createLogger('redaction-test', 'info', sink);
    logger.info({
      body: {
        password: 'top-secret-1',
        mfaCode: '111111',
        selfApproval: { reason: 'Sole owner', password: 'top-secret-2', mfaCode: '222222' },
        confirmation: { password: 'top-secret-3', mfaCode: '333333' },
      },
    });
    const out = lines.join('');
    for (const secret of ['top-secret-1', 'top-secret-2', 'top-secret-3', '111111', '222222', '333333']) {
      expect(out).not.toContain(secret);
    }
    expect(out).toContain('Sole owner');
    expect(out).toContain('[REDACTED]');
  });
});
