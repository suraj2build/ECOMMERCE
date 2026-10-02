import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { measureReadLoad } from '../../scripts/lib/read-load.mjs';

async function fixture(handler, run) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    await run(`http://127.0.0.1:${server.address().port}`);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}
const options = { connections: 4, duration: 0.05, deadlineMs: 1000, verifyBody: (body) => body === 'valid' };

test('admits every client and measures persistent requests without transport errors', async () => {
  const peers = new Set();
  await fixture((req, res) => { peers.add(req.socket.remotePort); res.end('valid'); }, async (url) => {
    const report = await measureReadLoad({ ...options, url });
    assert.equal(report.admission.completed, 4);
    assert.equal(report.admission.errors, 0);
    assert.ok(report.requests.total > 4);
    assert.equal(report.errors + report.timeouts + report.non2xx + report.mismatches, 0);
    assert.equal(report.measurement.connections, 4);
    assert.equal(peers.size, 4);
    assert.ok(report.measurement.elapsedSeconds >= options.duration);
  });
});

test('non-2xx responses fail even when the body is valid', async () => {
  await fixture((_req, res) => { res.statusCode = 429; res.end('valid'); }, async (url) => {
    const report = await measureReadLoad({ ...options, url });
    assert.equal(report.admission.non2xx, 4);
    assert.ok(report.non2xx > 4);
  });
});

test('invalid complete response bodies fail admission and steady reads', async () => {
  await fixture((_req, res) => res.end('invalid'), async (url) => {
    const report = await measureReadLoad({ ...options, url });
    assert.equal(report.admission.mismatches, 4);
    assert.ok(report.mismatches > 4);
  });
});

test('requests without a complete response retain setup and read deadline failures', async () => {
  await fixture((_req, _res) => {}, async (url) => {
    const report = await measureReadLoad({ ...options, url, deadlineMs: 15 });
    assert.equal(report.admission.timeouts, 4);
    assert.ok(report.timeouts > 4);
    assert.equal(report.errors, report.timeouts);
    assert.equal(report.requests.total, 0);
  });
});
