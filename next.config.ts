import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Transformers.js + ONNX runtime are native-binary packages that the
  // bundler shouldn't try to inline. Treat them as external so Node loads
  // them from node_modules at runtime.
  serverExternalPackages: [
    "@xenova/transformers",
    "onnxruntime-node",
    "sharp",
  ],
};

export default nextConfig;
