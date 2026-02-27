/**
 * @module lib/firebase
 *
 * Firebase client SDK helpers.
 *
 * - `getFirebaseApp`           — singleton `FirebaseApp` initialised from `Env.firebase`
 * - `getFirebaseAuth`          — singleton `Auth` instance
 * - `getCurrentUserIdToken`    — resolves the current user's ID token (with optional force-refresh)
 * - `signIn`                   — signs in with email + password (requires verified email)
 * - `sendVerificationEmail`    — sends a Firebase email verification to the given user
 * - `EmailNotVerifiedError`    — error thrown when login is attempted with unverified email
 * - `signOut`                  — signs out the current user
 * - `getFirebaseFirestore`     — singleton `Firestore` instance
 */
export { getFirebaseApp } from './app';
export {
  getFirebaseAuth,
  getCurrentUserIdToken,
  signIn,
  sendVerificationEmail,
  initiateEmailVerification,
  signOut,
  EmailNotVerifiedError,
} from './auth';
export { getFirebaseFirestore } from './firestore';
