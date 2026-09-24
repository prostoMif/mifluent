import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,

  // The packages are TypeScript source in this repository, not published
  // builds. Transpiling them here keeps the dev server from needing a separate
  // watch-and-rebuild step for every edit in packages/.
  transpilePackages: [
    "@mifluent/core",
    "@mifluent/db",
    "@mifluent/delivery",
    "@mifluent/digest",
    "@mifluent/domain",
  ],

  // Loaded by the server at runtime rather than bundled: pg-boss reads its
  // own SQL at startup and does not survive being inlined.
  serverExternalPackages: ["pg-boss"],

  // Produces a self-contained server bundle, which is what the Docker image
  // will copy. Without it the image has to carry all of node_modules.
  output: "standalone",

  // Nothing here loads an external script or frames another site, so the
  // defaults can be strict. A Content-Security-Policy is added alongside the
  // first page that renders content fetched from elsewhere — see
  // docs/security.md.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-DNS-Prefetch-Control", value: "off" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
          },
        ],
      },
    ];
  },
};

export default config;
