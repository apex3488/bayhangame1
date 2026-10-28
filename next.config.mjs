/** @type {import('next').NextConfig} */
const securityHeaders = [
  // The game must not be embedded in other sites (clickjacking). Telegram Web (web.telegram.org)
  // shows Mini Apps in an iframe, so it is the only allowed embedder; mobile and desktop
  // Telegram clients use their own webview and are not affected.
  { key: "Content-Security-Policy", value: "frame-ancestors 'self' https://web.telegram.org https://*.telegram.org" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
];

const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
