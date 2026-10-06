/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Produces a self-contained .next/standalone folder (only the
  // node_modules this app actually needs, traced from its imports) —
  // what Dockerfile's production stage copies, instead of the whole
  // monorepo's node_modules tree.
  output: 'standalone',
};

export default nextConfig;
