import type { Song } from '@/lib/api/types';

// ---------------------------------------------------------------------------
// Re-export so consumers can import everything from the store
// ---------------------------------------------------------------------------

export type { Song };

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

/**
 * Current authentication phase:
 * - `'loading'`        – waiting for Firebase Auth to emit its first event
 * - `'authenticated'`  – a user is signed in
 * - `'unauthenticated'`– no user is signed in
 */
export type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated';

/**
 * Plain-object representation of the signed-in Firebase user.
 * Intentionally kept serialisable (no methods).
 */
export interface AuthUser {
  /** Firebase UID — stable, unique identifier for the user. */
  uid: string;
  /** Primary email address (guaranteed to be a valid string by backend). */
  email: string;
  /** User's display name (guaranteed to be a valid string by backend). */
  displayName: string;
  /** URL of the user's profile photo, or `null` if not set. */
  photoURL: string | null;
  /** Whether the user's email address has been verified. */
  emailVerified: boolean;
}

// ---------------------------------------------------------------------------
// User profile
// ---------------------------------------------------------------------------

/**
 * User profile is simply the authenticated user's information from Firebase Auth.
 * The backend guarantees that displayName is a valid string.
 */
export type UserProfile = AuthUser;

// ---------------------------------------------------------------------------
// Async status
// ---------------------------------------------------------------------------

/**
 * Standard loading status for async data slices.
 * - `'idle'`    – not yet requested
 * - `'loading'` – request in flight / listener pending first snapshot
 * - `'ready'`   – data is available
 * - `'error'`   – last attempt failed
 */
export type LoadStatus = 'idle' | 'loading' | 'ready' | 'error';

// ---------------------------------------------------------------------------
// Global state shape
// ---------------------------------------------------------------------------

export interface GlobalState {
  // --- Auth ---
  /** Phase of the Firebase Auth initialisation. */
  authStatus: AuthStatus;

  // --- User profile ---
  /**
   * The signed-in user (from Firebase Auth).
   * `null` when not authenticated or during initial load.
   */
  userProfile: UserProfile | null;

  // --- Songs ---
  /**
   * Real-time list of the user's songs from Firestore `/users/{uid}/songs`.
   * Always up-to-date while the user is authenticated.
   */
  songs: Song[];
  /** Loading status of the Firestore `/users/{uid}/songs` listener. */
  songsStatus: LoadStatus;
}
