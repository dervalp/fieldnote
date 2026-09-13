import type { NextConfig } from 'next';

// The product moved from the URL root to /app so that / could become the
// marketing site. These keep every link, bookmark and pasted URL from before
// the move working.
//
// `:path*` is zero-or-more, so one entry per section covers both the bare
// section root and any depth beneath it. Query values are carried to the
// destination by Next itself — which is what keeps ?days=, ?from=/?to= and
// ?projection= alive through a redirect, and is the main reason this is a
// config table rather than a redirect() in a page.
//
// 308, because the move is permanent. The cost is that a browser caches it
// indefinitely and a wrong destination cannot be withdrawn from anyone who
// already followed it, so src/lib/legacy-redirects.test.ts exercises every
// entry against a real URL rather than inspecting the table's shape.
//
// This file imports nothing from src/ on purpose. The same test asserts these
// sources match src/lib/app-routes.ts's `appSections`, so the two cannot drift
// without a build-time dependency from the config into application code.
const config: NextConfig = {
  distDir: process.env.NEXT_DIST_DIR ?? '.next',
  redirects: async () => [
    { source: '/dashboard/:path*', destination: '/app/dashboard/:path*', permanent: true },
    { source: '/repos/:path*', destination: '/app/repos/:path*', permanent: true },
    { source: '/prs/:path*', destination: '/app/prs/:path*', permanent: true },
    { source: '/settings/:path*', destination: '/app/settings/:path*', permanent: true },
    { source: '/onboarding/:path*', destination: '/app/onboarding/:path*', permanent: true },
    { source: '/app', destination: '/app/dashboard', permanent: true },
  ],
};
export default config;
