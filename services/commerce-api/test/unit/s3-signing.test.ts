import { describe, it, expect } from 'vitest';
import { signV4 } from '../../src/lib/s3.js';

// AWS's published SigV4 example for S3 ("GET Object" with a Range header,
// Amazon S3 API Reference, "Signature Calculations for the Authorization
// Header: Transferring Payload in a Single Chunk"). The documentation's
// example credentials are split so they are not mistaken for real ones.
const EXAMPLE_ACCESS_KEY = ['AKIAIOSFODNN7', 'EXAMPLE'].join('');
const EXAMPLE_SECRET = ['wJalrXUtnFEMI/K7MDENG/bPxRfiCY', 'EXAMPLEKEY'].join('');
const EMPTY_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

describe('S3 SigV4 signing', () => {
  it('reproduces the signature from the AWS documentation example', () => {
    const authorization = signV4({
      method: 'GET',
      path: '/test.txt',
      query: '',
      headers: { host: 'examplebucket.s3.amazonaws.com', range: 'bytes=0-9', 'x-amz-content-sha256': EMPTY_SHA256, 'x-amz-date': '20130524T000000Z' },
      payloadHash: EMPTY_SHA256,
      region: 'us-east-1',
      accessKeyId: EXAMPLE_ACCESS_KEY,
      secretAccessKey: EXAMPLE_SECRET,
    });
    expect(authorization).toBe(
      `AWS4-HMAC-SHA256 Credential=${EXAMPLE_ACCESS_KEY}/20130524/us-east-1/s3/aws4_request, ` +
      'SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, ' +
      'Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41',
    );
  });
});
