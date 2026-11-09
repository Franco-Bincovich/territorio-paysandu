import path from "node:path";
import type { NextConfig } from "next";
const config: NextConfig = {
  output: "standalone",
  serverExternalPackages: ['ssh2','redis'],
  outputFileTracingRoot: path.join(__dirname, ".."),
  turbopack: { root: path.join(__dirname, "..") },
  poweredByHeader: false,
  // Search query strings contain personal documents. Never log incoming search URLs.
  logging: { incomingRequests: { ignore: [/\/api\//] }, browserToTerminal: false },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "no-referrer" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
      },
      {source:'/api/:path*',headers:[{key:'Content-Security-Policy',value:"default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"}]},
    ];
  },
};
export default config;
