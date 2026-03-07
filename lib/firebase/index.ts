/**
 * @module lib/firebase
 *
 * Firebase client SDK helpers.
 *
 * - `getFirebaseApp`           — singleton `FirebaseApp` initialised from `Env.firebase`
 * - `getFirebaseAuth`          — singleton `Auth` instance
 * - `getCurrentUserIdToken`    — resolves the current user's ID token (with optional force-refresh)
 * - `createUserAccount`        — creates a new Firebase Auth account + sends verification email
 * - `signIn`                   — signs in with email + password (requires verified email)
 * - `signInWithGoogle`         — signs in with Google OAuth (requires verified email)
 * - `sendPasswordReset`        — sends a password reset email
 * - `sendVerificationEmail`    — sends a Firebase email verification to the given user
 * - `EmailNotVerifiedError`    — error thrown when login is attempted with unverified email
 * - `signOut`                  — signs out the current user
 * - `getFirebaseFirestore`     — singleton `Firestore` instance
 *
 * Firestore document operations:
 * - Song CRUD: `generateSongId`, `createSongDoc`, `updateSongDoc`, `deleteSongDoc`
 * - Separation info: `updateSeparatedSongInfo`, `updateSeparationStems`
 * - User profile: `createUserDoc`
 */
export { getFirebaseApp } from './app';
export {
  getFirebaseAuth,
  getCurrentUserIdToken,
  createUserAccount,
  signIn,
  signInWithGoogle,
  sendPasswordReset,
  sendVerificationEmail,
  initiateEmailVerification,
  signOut,
  EmailNotVerifiedError,
} from './auth';
export { getFirebaseFirestore } from './firestore';
export {
  generateSongId,
  createSongDoc,
  updateSongDoc,
  deleteSongDoc,
  updateSeparatedSongInfo,
  updateSeparationStems,
} from './songs';
export { createUserDoc } from './users';
