import type { AuthUser, GlobalState, Song } from './types';

// ---------------------------------------------------------------------------
// Action definitions
// ---------------------------------------------------------------------------

export type GlobalStateAction =
  /** Firebase Auth SDK is initialising (very first load) */
  | { type: 'AUTH_LOADING' }
  /** Firebase confirmed a signed-in user */
  | { type: 'AUTH_AUTHENTICATED'; payload: AuthUser }
  /** Firebase confirmed no signed-in user (or sign-out completed) */
  | { type: 'AUTH_UNAUTHENTICATED' }
  /** Firestore listener for /users/{uid}/songs started */
  | { type: 'SONGS_LOADING' }
  /** Firestore /users/{uid}/songs snapshot received */
  | { type: 'SONGS_READY'; payload: Song[] }
  /** Firestore /users/{uid}/songs listener encountered an error */
  | { type: 'SONGS_ERROR' }
  /** Start uploading stems for a song */
  | { type: 'SONG_STEM_UPLOAD_START'; payload: string }
  /** Finish uploading stems for a song (success or failure) */
  | { type: 'SONG_STEM_UPLOAD_END'; payload: string }
  /** Load and play a song in the global player */
  | { type: 'PLAYER_LOAD_SONG'; payload: string }
  /** Set playback status */
  | { type: 'PLAYER_SET_STATUS'; payload: 'playing' | 'paused' | 'loading' }
  /** Stop playback and clear the current song */
  | { type: 'PLAYER_STOP' };

// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------

/**
 * Starting state used both on first render and whenever the user signs out.
 * Auth is set to `'loading'` so consumers can show a loading indicator
 * until Firebase Auth emits its first event.
 */
export const initialState: GlobalState = {
  authStatus: 'loading',
  userProfile: null,
  songs: [],
  songsStatus: 'idle',
  songsStemUploading: new Set(),
  currentSongId: null,
  playbackStatus: 'idle',
};

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

/**
 * Pure reducer for the application global state.
 *
 * **Reset behaviour**: both `AUTH_LOADING` and `AUTH_UNAUTHENTICATED` reset
 * the entire state back to `initialState`. This ensures no stale profile or
 * song data leaks across user sessions.
 */
export function globalStateReducer(
  state: GlobalState,
  action: GlobalStateAction,
): GlobalState {
  switch (action.type) {
    case 'AUTH_LOADING':
      return { ...initialState, authStatus: 'loading' };

    case 'AUTH_AUTHENTICATED':
      return {
        ...state,
        authStatus: 'authenticated',
        userProfile: action.payload,
      };

    case 'AUTH_UNAUTHENTICATED':
      return {
        ...initialState,
        authStatus: 'unauthenticated',
      };

    case 'SONGS_LOADING':
      return { ...state, songsStatus: 'loading' };

    case 'SONGS_READY':
      return { ...state, songsStatus: 'ready', songs: action.payload };

    case 'SONGS_ERROR':
      return { ...state, songsStatus: 'error' };

    case 'SONG_STEM_UPLOAD_START': {
      const newSet = new Set(state.songsStemUploading);
      newSet.add(action.payload);
      return { ...state, songsStemUploading: newSet };
    }

    case 'SONG_STEM_UPLOAD_END': {
      const newSet = new Set(state.songsStemUploading);
      newSet.delete(action.payload);
      return { ...state, songsStemUploading: newSet };
    }

    case 'PLAYER_LOAD_SONG':
      return {
        ...state,
        currentSongId: action.payload,
        playbackStatus: 'loading',
      };

    case 'PLAYER_SET_STATUS':
      return { ...state, playbackStatus: action.payload };

    case 'PLAYER_STOP':
      return { ...state, currentSongId: null, playbackStatus: 'idle' };

    default:
      return state;
  }
}
