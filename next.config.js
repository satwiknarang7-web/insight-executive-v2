import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false,
  // alasql now runs only in the browser worker; these two are server-only native deps.
  serverExternalPackages: ['puppeteer-core', '@sparticuz/chromium', 'pg', 'mysql2', 'mssql', 'oracledb', 'snowflake-sdk', 'tedious'],
  
  // Pin the workspace root so Turbopack doesn't infer it from a parent folder.
  turbopack: {
    root: __dirname,
  },

  // 2. Performance Optimizations
  experimental: {
    optimizePackageImports: ['lucide-react', 'recharts'],
  },

  // Two screens folded into the profile page. Permanent, because the old paths
  // are in people's history and bookmarks, and a 404 is a worse answer than the
  // page the thing actually moved to.
  //
  // /connections went because a connection is now made from the data-source
  // dropdown at the moment you want data out of it; managing stored credentials
  // is what was left, and that is an account matter.
  //
  // /library went because it lived inside the shell that requires a loaded
  // dataset, which meant you could not open an analysis someone shared with you
  // without first opening an unrelated file of your own.
  async redirects() {
    return [
      { source: '/connections', destination: '/profile', permanent: true },
      { source: '/library', destination: '/profile', permanent: true },
    ];
  },
};

export default nextConfig;
