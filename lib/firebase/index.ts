/**
 * @module lib/firebase
 *
 * Firebase client SDK helpers.
 *
 * - `getFirebaseApp`        — singleton `FirebaseApp` initialised from `Env.firebase`
 * - `getFirebaseAuth`       — singleton `Auth` instance
 * - `getCurrentUserIdToken` — resolves the current user's ID token (with optional force-refresh)
 * - `getFirebaseFirestore`  — singleton `Firestore` instance
 */
export { getFirebaseApp } from './app';
export {
  getFirebaseAuth,
  getCurrentUserIdToken,
  signIn,
  signUp,
  signOut,
} from './auth';
export { getFirebaseFirestore } from './firestore';
