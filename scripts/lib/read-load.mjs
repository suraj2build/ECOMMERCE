import http from 'node:http';
import https from 'node:https';
import { performance } from 'node:perf_hooks';

function summarize(samples) {
  const values = [...samples].sort((a, b) => a - b);
  const percentile = (p) => values.length ? values[Math.max(0, Math.ceil(values.length * p) - 1)] : 0;
  const mean = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
  return { min: values[0] ?? 0, max: values.at(-1) ?? 0, average: mean, mean,
    p50: percentile(0.5), p97_5: percentile(0.975), p99: percentile(0.99), totalCount: values.length };
}

function readOnce(url, agent, headers, deadlineMs) {
  const transport = url.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    let settled = false;
    let timer;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) { reject(error); request.destroy(error); }
      else resolve(value);
    };
    const request = transport.request(url, { agent, headers, method: 'GET' }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { body += chunk; });
      response.on('error', (error) => finish(error));
      response.on('aborted', () => finish(new Error('Response aborted before completion')));
      response.on('end', () => finish(null, { status: response.statusCode ?? 0, body }));
    });
    request.on('error', (error) => finish(error));
    // Includes DNS/TCP setup and the complete body, rather than only socket inactivity.
    timer = setTimeout(() => {
      const error = new Error('Read-load request deadline exceeded');
      error.code = 'LOAD_TIMEOUT';
      finish(error);
    }, deadlineMs);
    request.end();
  });
}

/** First admit every client with one real validated request. Do not let early
 * connections repeatedly flood the listener while later clients are still
 * connecting. Then maintain one request loop per admitted shopper connection.
 * Setup failures remain in the final failure counters; no error is discarded.
 */
export async function measureReadLoad({
  url: target, connections, duration, verifyBody, headerFactory = () => ({}), deadlineMs = 10_000,
}) {
  const url = new URL(target);
  const Agent = url.protocol === 'https:' ? https.Agent : http.Agent;
  const clients = Array.from({ length: connections }, () => ({
    agent: new Agent({ keepAlive: true, maxSockets: 1, maxFreeSockets: 1 }),
    headers: headerFactory(),
  }));
  const counters = { errors: 0, timeouts: 0, non2xx: 0, mismatches: 0 };
  const admissionLatency = [];
  const latency = [];
  let sent = 0;
  async function read(client, samples) {
    const start = performance.now();
    try {
      const response = await readOnce(url, client.agent, client.headers, deadlineMs);
      samples.push(performance.now() - start);
      if (response.status < 200 || response.status >= 300) counters.non2xx += 1;
      let valid = false;
      try { valid = Boolean(verifyBody(response.body)); } catch { /* Invalid bodies fail below. */ }
      if (!valid) counters.mismatches += 1;
    } catch (error) {
      counters.errors += 1;
      if (error.code === 'LOAD_TIMEOUT') counters.timeouts += 1;
    }
  }
  try {
    await Promise.all(clients.map((client) => read(client, admissionLatency)));
    const admission = { sent: connections, completed: admissionLatency.length,
      latency: summarize(admissionLatency), ...counters };
    const start = performance.now();
    const end = start + duration * 1000;
    await Promise.all(clients.map(async (client) => {
      while (performance.now() < end) { sent += 1; await read(client, latency); }
    }));
    const elapsedSeconds = (performance.now() - start) / 1000;
    return { requests: { total: latency.length, sent, average: latency.length / elapsedSeconds },
      latency: summarize(latency), ...counters, admission,
      measurement: { connections, durationSeconds: duration, elapsedSeconds,
        method: 'validated connection admission, then one persistent HTTP request loop per shopper' } };
  } finally {
    for (const client of clients) client.agent.destroy();
  }
}
