import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';
import helmet from '@fastify/helmet';

/**
 * M31 Security Hardening (5D - security headers). This API served no
 * hardening response headers at all before this pass (confirmed absent:
 * no CSP, no clickjacking/frame-ancestors protection, no MIME-sniffing
 * guard, no referrer-policy) - a genuine gap for a JSON API that a
 * browser-based storefront/admin app calls directly with credentials.
 *
 * `contentSecurityPolicy: false` - this is a pure JSON API, never a page
 * renderer; a CSP is the STOREFRONT/ADMIN Next.js apps' own concern
 * (they render HTML and therefore have a real script/style/img source
 * surface to restrict), not this API's. Shipping a CSP header on JSON
 * responses would be inert (browsers only enforce CSP on the document
 * that carries it, an HTML response) and would misrepresent this as
 * having done the storefront's own CSP hardening, which it has not.
 * `crossOriginResourcePolicy`/`crossOriginEmbedderPolicy` are similarly
 * left at helmet's own sane defaults - not relevant to a same-origin
 * fetch/XHR JSON API already gated by the explicit `CORS_ORIGINS`
 * allow-list (plugins/cors.ts), never a wildcard.
 *
 * What this DOES turn on (helmet's defaults, kept rather than
 * individually reinvented): `X-Content-Type-Options: nosniff`,
 * `X-Frame-Options: SAMEORIGIN` (clickjacking protection - helmet's own
 * default value; this API is never meant to be framed by a
 * cross-origin page at all, but SAMEORIGIN is the shipped default and
 * changing it isn't this pass's concern), `Strict-Transport-Security`
 * (a no-op over plain HTTP in local dev, meaningful once behind TLS in
 * production), and a conservative `Referrer-Policy`.
 */
const securityHeadersPlugin: FastifyPluginAsync = async (fastify) => {
  await fastify.register(helmet, {
    contentSecurityPolicy: false,
  });
};

export default fp(securityHeadersPlugin, { name: 'security-headers' });
