/**
 * Typed environment variable helper.
 *
 * All public env vars must be accessed through this module.
 * Never read `process.env` directly — use `Env.*` instead.
 *
 * Variables prefixed with `NEXT_PUBLIC_` are inlined at build time
 * by Next.js and are safe to use in client components.
 *
 * IMPORTANT: Next.js/Turbopack can only statically inline `NEXT_PUBLIC_`
 * variables when they are referenced as literal property accesses
 * (e.g. `process.env.NEXT_PUBLIC_FOO`). Dynamic bracket notation
 * (`process.env[name]`) will NOT be replaced in the client bundle.
 */

/**
 * Validates that a `NEXT_PUBLIC_` env var is defined and returns it.
 *
 * The caller must pass `process.env.NEXT_PUBLIC_*` as a literal property
 * access — NOT via dynamic bracket notation — so that Next.js/Turbopack can
 * statically inline the value into the client bundle.
 *
 * @param name  - Variable name, used in the error message.
 * @param value - The result of `process.env.NEXT_PUBLIC_*` (literal access).
 */
function requirePublicEnv(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const Env = {
  /** Base URL of the singlab-api backend */
  apiUrl: requirePublicEnv(
    'NEXT_PUBLIC_API_URL',
    process.env.NEXT_PUBLIC_API_URL,
  ),

  firebase: {
    apiKey: requirePublicEnv(
      'NEXT_PUBLIC_FIREBASE_API_KEY',
      process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    ),
    authDomain: requirePublicEnv(
      'NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN',
      process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    ),
    projectId: requirePublicEnv(
      'NEXT_PUBLIC_FIREBASE_PROJECT_ID',
      process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    ),
    storageBucket: requirePublicEnv(
      'NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET',
      process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
    ),
    messagingSenderId: requirePublicEnv(
      'NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID',
      process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    ),
    appId: requirePublicEnv(
      'NEXT_PUBLIC_FIREBASE_APP_ID',
      process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
    ),
  },
} as const;
