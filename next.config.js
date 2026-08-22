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
};

export default nextConfig;
