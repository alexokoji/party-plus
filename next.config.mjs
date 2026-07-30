/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // `next build` and `next dev` share .next by default, so running a build
  // while the dev server is up overwrites the chunks the dev server is
  // serving and it starts throwing "Cannot find module './NNN.js'" until it
  // is restarted. Setting DIST_DIR lets a build write somewhere else — see
  // the `build:size` script, which is what bundle-size checks should use.
  distDir: process.env.DIST_DIR || ".next",
};

export default nextConfig;
