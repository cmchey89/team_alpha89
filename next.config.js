/** @type {import('next').NextConfig} */
const nextConfig = {
  // gdal3.js ships .wasm + .data assets that must be served as static files,
  // and webassembly needs async loading enabled in webpack.
  webpack: (config, { isServer }) => {
    config.experiments = { ...config.experiments, asyncWebAssembly: true };
    if (!isServer) {
      // gdal3.js / geoimport are browser-only — never bundle them server-side.
      config.resolve.fallback = { ...config.resolve.fallback, fs: false, path: false };
    }
    return config;
  },
  // gdal3.js wasm/data files are large (tens of MB) — they're served from /public
  // and fetched lazily client-side, not bundled into the JS chunk.
  headers: async () => [
    {
      source: '/gdal3wasm/:path*',
      headers: [{ key: 'Cross-Origin-Embedder-Policy', value: 'require-corp' }],
    },
  ],
};

module.exports = nextConfig;
