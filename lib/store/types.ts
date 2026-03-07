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
 * Status of the Firestore `/users/{uid}` profile document.
 * - `idle`    – not checking yet (no authenticated user)
 * - `loading` – checking document existence
 * - `exists`  – document exists
 * - `missing` – document does not exist yet
 */
export type UserDocStatus = 'idle' | 'loading' | 'exists' | 'missing';

/**
 * Plain-object representation of the signed-in Firebase user.
 * Intentionally kept serialisable (no methods).
 */
export interface AuthUser {
  /** Firebase UID — stable, unique identifier for the user. */
  uid: string;
  /** Primary email address (guaranteed to be a valid string by backend). */
  email: string;
  /** User-facing name from Firestore `/users/{uid}.name`. */
  name: string;
  /** URL of the user's profile photo, or `null` if not set. */
  photoURL: string | null;
  /** Whether the user's email address has been verified. */
  emailVerified: boolean;
}

// ---------------------------------------------------------------------------
// User profile
// ---------------------------------------------------------------------------

/**
 * User profile combines Firebase Auth identity and Firestore profile data.
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
// Player
// ---------------------------------------------------------------------------

/**
 * Playback status of the global audio player.
 * - `'idle'`    – no song loaded
 * - `'loading'` – song is being loaded
 * - `'playing'` – song is currently playing
 * - `'paused'`  – song is paused
 */
export type PlaybackStatus = 'idle' | 'loading' | 'playing' | 'paused';

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
  /** Existence status of `/users/{uid}`. */
  userDocStatus: UserDocStatus;

  // --- Songs ---
  /**
   * Real-time list of the user's songs from Firestore `/users/{uid}/songs`.
   * Always up-to-date while the user is authenticated.
   */
  songs: Song[];
  /** Loading status of the Firestore `/users/{uid}/songs` listener. */
  songsStatus: LoadStatus;
  /**
   * Set of song IDs currently uploading stems to Firebase Storage.
   * Used to prevent concurrent uploads and show loading state in UI.
   */
  songsStemUploading: Set<string>;

  // --- Player ---
  /**
   * ID of the currently playing/loaded song.
   * `null` when no song is loaded in the global player.
   */
  currentSongId: string | null;
  /** Current playback status of the global player. */
  playbackStatus: PlaybackStatus;
}
