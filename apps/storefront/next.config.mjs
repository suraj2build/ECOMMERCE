// The storefront's own public address (NEXT_PUBLIC_SITE_URL, fixed at build
// time) may serve product images, e.g. demo images on a laptop opened from a
// phone at http://<laptop's Wi-Fi address>:3000.
const site = process.env.NEXT_PUBLIC_SITE_URL ? new URL(process.env.NEXT_PUBLIC_SITE_URL) : null;
const ownOrigin = site
  ? [{ protocol: site.protocol.replace(':', ''), hostname: site.hostname, ...(site.port ? { port: site.port } : {}) }]
  : [];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  images: {
    remotePatterns: [
      { protocol: 'http', hostname: 'localhost' },
      { protocol: 'https', hostname: '**' },
      ...ownOrigin,
    ],
  },
};

export default nextConfig;
