// The storefront's own public address (NEXT_PUBLIC_SITE_URL, fixed at build
// time) may serve product images, e.g. demo images on a laptop opened from a
// phone at http://<laptop's Wi-Fi address>:3000.
const site = process.env.NEXT_PUBLIC_SITE_URL ? new URL(process.env.NEXT_PUBLIC_SITE_URL) : null;
const ownOrigin = site
  ? [{ protocol: site.protocol.replace(':', ''), hostname: site.hostname, ...(site.port ? { port: site.port } : {}) }]
  : [];

// Product photos and banner/page images uploaded in admin (Admin Ops Phase 1)
// are stored by the API and recorded as /media/products/<file> or
// /media/content/<file>, paths on the storefront's own origin; these
// rewrites fetch them from the API's public media routes.
const apiUrl = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000').replace(/\/$/, '');

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async rewrites() {
    return [
      { source: '/media/products/:file', destination: `${apiUrl}/api/v1/media/products/:file` },
      { source: '/media/content/:file', destination: `${apiUrl}/api/v1/media/content/:file` },
    ];
  },
  images: {
    remotePatterns: [
      { protocol: 'http', hostname: 'localhost' },
      { protocol: 'https', hostname: '**' },
      ...ownOrigin,
    ],
  },
};

export default nextConfig;
