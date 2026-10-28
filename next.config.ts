import type { NextConfig } from "next";
import { contentSecurityPolicy } from "./src/lib/security-headers";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Project guidance lives in CLAUDE.md; stop `next dev` from recreating AGENTS.md.
  agentRules: false,
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          {
            key: "Content-Security-Policy",
            value: contentSecurityPolicy(undefined, process.env.NODE_ENV === "development"),
          },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
