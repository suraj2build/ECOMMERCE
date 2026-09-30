import fp from 'fastify-plugin';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { loadEnv } from '@fcp/config';

/**
 * M31 Security Hardening (5E - rate limiting/abuse). Nothing in this API
 * enforced any request-volume limit before this pass - OTP request/verify,
 * staff login, and checkout/payment were all reachable at unlimited rate,
 * the exact gap flagged as a genuine pre-production security finding
 * (this file's own commit message/DECISION_REGISTER.md entry records the
 * finding). Backed by the existing shared Redis instance (`fastify.redis`,
 * see plugins/redis.ts) rather than an in-memory store, since this
 * platform's own target envelope (specs/NFR, M32) assumes more than one
 * API process behind a load balancer - an in-memory counter would let an
 * attacker trivially multiply their effective rate by the process count.
 *
 * A conservative GLOBAL default applies to every route as defense in
 * depth (a slow-but-broad flood against any endpoint this list doesn't
 * name explicitly); individual routes that are genuinely sensitive
 * (auth, checkout, payment) get a much stricter override via each route's
 * own `config.rateLimit`, applied at the route registration in that
 * module rather than centralized here - see cart/routes.ts's own guest-
 * session mint, auth/routes.ts's OTP/login endpoints, checkout/routes.ts,
 * and payment/routes.ts's retry-payment route.
 *
 * `/health`/`/ready` are excluded entirely (`config: { rateLimit: false }`
 * at their own registration in app.ts) - they are unauthenticated
 * orchestration liveness/readiness probes called at a fixed, expected,
 * often sub-second interval by infrastructure that is not the attacker
 * surface this control exists for.
 *
 * Keyed by IP by default (`request.ip`, resolved through exactly
 * TRUST_PROXY_HOPS trusted proxies - see app.ts - so a client-supplied
 * X-Forwarded-For prefix cannot choose its own bucket) - genuinely
 * identity-aware routes (OTP by mobile, staff login by email)
 * additionally key by that identifier at the route level
 * so an attacker cannot defeat the per-identity limit by rotating source
 * IPs, and cannot defeat a naive shared-IP limit by targeting many
 * identities from one IP (e.g. an office NAT) - see each route's own
 * `keyGenerator`. This is ordinary IP/identifier-based throttling, not
 * device/browser fingerprinting (5E's own explicit "no invasive
 * fingerprinting" instruction).
 */
const rateLimitPlugin: FastifyPluginAsync = async (fastify) => {
  const env = loadEnv();
  await fastify.register(rateLimit, {
    global: true,
    timeWindow: '1 minute',
    redis: fastify.redis,
    nameSpace: 'fcp-rl:',
    // A Redis outage must not take the whole API down alongside it - the
    // rate limiter fails OPEN (allows the request) rather than 500ing
    // every request platform-wide. This is a documented, deliberate
    // availability-over-throttling tradeoff for an infrastructure
    // failure, never for a normal request.
    skipOnError: true,
    keyGenerator: (request: FastifyRequest) => request.ip,
    // Tests run against a real Redis instance but at a request volume
    // that would otherwise legitimately trip even a generous global
    // default across a full adversarial concurrency suite - the
    // per-route overrides (which exercise the actual security property)
    // stay active in every environment; only the broad global backstop
    // is relaxed outside production.
    max: env.NODE_ENV === 'production' ? 600 : 100_000,
  });
};

export default fp(rateLimitPlugin, { name: 'rate-limit', dependencies: ['redis'] });
