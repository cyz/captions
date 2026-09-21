/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  serverExternalPackages: ["@napi-rs/canvas"],
};

module.exports = nextConfig;
