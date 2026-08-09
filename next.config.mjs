/** @type {import('next').NextConfig} */

// Public marketing microsite (insight.vercel.app) is marketing-ONLY: the
// product page is served at the root and the in-app routes are hidden, because
// the app itself ships as a standalone desktop download, not on the web. Set
// via the MICROSITE=1 env var on the Vercel project ONLY. The desktop (Tauri)
// build must never set it — that build serves the app at the root, and the
// bundled Node server it launches reads this same config.
const microsite = process.env.MICROSITE === "1";

const nextConfig = {
  // Emit a self-contained Node server (.next/standalone/server.js) with only
  // the traced dependencies, so the desktop bundle can run the app without a
  // full node_modules or the Next CLI. Tauri launches this as a sidecar.
  output: "standalone",

  // Keep runtime data OUT of the traced bundle. File tracing otherwise copies
  // the whole data/ dir (incl. ~700 MB of Whisper models) into
  // .next/standalone/data. Models/corpus ship as controlled bundle resources
  // (ASSETS_DIR); writable data lives in the OS app-data dir (DATA_DIR).
  outputFileTracingExcludes: {
    "*": ["data/**"],
  },

  ...(microsite
    ? {
        // Serve the marketing page at "/" without changing the URL. beforeFiles
        // so it wins over the app's own root route (app/page.tsx).
        async rewrites() {
          return {
            beforeFiles: [{ source: "/", destination: "/product" }],
          };
        },
        // Any in-app route on the marketing site lands on the marketing home.
        async redirects() {
          const toHome = (source) => ({
            source,
            destination: "/",
            permanent: false,
          });
          return [
            toHome("/live"),
            toHome("/sessions"),
            toHome("/sessions/:path*"),
            toHome("/documents"),
            toHome("/documents/:path*"),
            toHome("/glossary"),
          ];
        },
      }
    : {}),
};

export default nextConfig;
