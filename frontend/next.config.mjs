import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export default {
  output: 'standalone',
  outputFileTracingRoot: root,
  poweredByHeader: false,
  webpack(config) {
    config.module.rules.push({ test: /\.html$/, type: 'asset/source' });
    return config;
  },
  async redirects() {
    return ['/pulse/wire', '/pulse/desk', '/pulse/inbox/:id/canvas'].map((source) => ({
      source,
      destination: '/pulse',
      permanent: false,
    }));
  },
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: (process.env.INTERNAL_API_ORIGIN || 'http://127.0.0.1:4000') + '/api/:path*',
      },
    ];
  },
};
