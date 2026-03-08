import createNextIntlPlugin from 'next-intl/plugin';
import type { NextConfig } from 'next';

const withNextIntl = createNextIntlPlugin('./lib/i18n/request.ts');

const nextConfig: NextConfig = {
  allowedDevOrigins: ['192.168.1.4', 'localhost', '127.0.0.1'],

  turbopack: {
    resolveAlias: {
      // jsmediatags has optional React Native dependencies that are unavailable
      // in the Next.js web environment. Alias them to an empty module to prevent
      // build errors while maintaining all web-compatible jsmediatags features.
      'react-native-fs': './lib/empty-module.ts',

      sharp$: './lib/empty-module.ts',
      'onnxruntime-node$': './lib/empty-module.ts',
    },
  },

  webpack: (config) => {
    config.resolve.alias = {
      ...config.resolve.alias,

      'react-native-fs': false,

      sharp$: false,
      'onnxruntime-node$': false,
    };

    return config;
  },
};

export default withNextIntl(nextConfig);
