/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  serverExternalPackages: [
    "@napi-rs/canvas",
    "@huggingface/transformers",
    "onnxruntime-node",
  ],
};

module.exports = nextConfig;
