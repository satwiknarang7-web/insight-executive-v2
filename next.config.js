import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false,
  serverExternalPackages: ['alasql'],
  
  // 1. Turbopack Configuration
  turbopack: {
    // Explicitly set the root to this folder to fix the "workspace inference" warning
    root: '.',
  },

  // 2. Performance Optimizations
  experimental: {
    optimizePackageImports: ['lucide-react', 'recharts'],
  },
};

export default nextConfig;
