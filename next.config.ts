import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  turbopack: {
    resolveAlias: {
      // jsmediatags has optional React Native dependencies that are unavailable
      // in the Next.js web environment. Alias them to an empty module to prevent
      // build errors while maintaining all web-compatible jsmediatags features.
      'react-native-fs': './lib/empty-module.ts',
    },
  },
};

export default nextConfig;
