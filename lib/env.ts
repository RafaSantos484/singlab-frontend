/**
 * Typed environment variable helper.
 *
 * All public env vars must be accessed through this module.
 * Never read `process.env` directly — use `Env.*` instead.
 *
 * Variables prefixed with `NEXT_PUBLIC_` are inlined at build time
 * by Next.js and are safe to use in client components.
 */

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const Env = {
  /** Base URL of the singlab-api backend */
  apiUrl: requireEnv('NEXT_PUBLIC_API_URL'),

  firebase: {
    apiKey: requireEnv('NEXT_PUBLIC_FIREBASE_API_KEY'),
    authDomain: requireEnv('NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN'),
    projectId: requireEnv('NEXT_PUBLIC_FIREBASE_PROJECT_ID'),
    storageBucket: requireEnv('NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET'),
    messagingSenderId: requireEnv('NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID'),
    appId: requireEnv('NEXT_PUBLIC_FIREBASE_APP_ID'),
  },
} as const;
