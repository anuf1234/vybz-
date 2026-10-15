import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== "production";

// Only the provider origins we actually use. YouTube embeds go through the
// privacy-enhanced youtube-nocookie.com domain; Apple previews and artwork are
// played and shown straight from Apple's CDNs, never proxied.
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https://*.mzstatic.com https://i.ytimg.com",
  "media-src https://*.itunes.apple.com https://*.apple.com",
  "frame-src https://www.youtube-nocookie.com",
  "connect-src 'self'",
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@vybz/providers"],
  poweredByHeader: false,
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "*.mzstatic.com" },
      { protocol: "https", hostname: "i.ytimg.com" },
    ],
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
