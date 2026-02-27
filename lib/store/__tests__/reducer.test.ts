import {
  globalStateReducer,
  initialState,
  type GlobalStateAction,
} from '../reducer';
import type { AuthUser, Song } from '../types';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const mockUser: AuthUser = {
  uid: 'user-123',
  email: 'test@example.com',
  displayName: 'Test User',
  photoURL: null,
  emailVerified: true,
};

const mockSongs: Song[] = [
  {
    id: 'song-1',
    title: 'Song One',
    author: 'Artist A',
    rawSongInfo: {
      urlInfo: {
        value: 'https://storage.example.com/song1',
        expiresAt: '2099-01-01T00:00:00.000Z',
      },
      uploadedAt: '2024-01-01T00:00:00.000Z',
    },
  },
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('globalStateReducer', () => {
  // --- initial state --------------------------------------------------------

  it('returns initialState values', () => {
    expect(initialState.authStatus).toBe('loading');
    expect(initialState.userProfile).toBeNull();
    expect(initialState.songs).toEqual([]);
    expect(initialState.songsStatus).toBe('idle');
  });

  // --- AUTH_LOADING ---------------------------------------------------------

  it('handles AUTH_LOADING: resets to initialState with authStatus loading', () => {
    const stateWithData = {
      ...initialState,
      authStatus: 'authenticated' as const,
      userProfile: mockUser,
      songs: mockSongs,
      songsStatus: 'ready' as const,
    };

    const next = globalStateReducer(stateWithData, { type: 'AUTH_LOADING' });

    expect(next).toEqual({ ...initialState, authStatus: 'loading' });
  });

  // --- AUTH_AUTHENTICATED ---------------------------------------------------

  it('handles AUTH_AUTHENTICATED: sets authStatus and userProfile', () => {
    const action: GlobalStateAction = {
      type: 'AUTH_AUTHENTICATED',
      payload: mockUser,
    };
    const next = globalStateReducer(initialState, action);

    expect(next.authStatus).toBe('authenticated');
    expect(next.userProfile).toEqual(mockUser);
  });

  // --- AUTH_UNAUTHENTICATED -------------------------------------------------

  it('handles AUTH_UNAUTHENTICATED: resets state and sets authStatus unauthenticated', () => {
    const stateWithData = {
      ...initialState,
      authStatus: 'authenticated' as const,
      userProfile: mockUser,
      songs: mockSongs,
    };

    const next = globalStateReducer(stateWithData, {
      type: 'AUTH_UNAUTHENTICATED',
    });

    expect(next).toEqual({ ...initialState, authStatus: 'unauthenticated' });
  });

  // --- SONGS_LOADING --------------------------------------------------------

  it('handles SONGS_LOADING: sets songsStatus to loading', () => {
    const next = globalStateReducer(initialState, { type: 'SONGS_LOADING' });
    expect(next.songsStatus).toBe('loading');
  });

  // --- SONGS_READY ----------------------------------------------------------

  it('handles SONGS_READY: sets songs array and songsStatus ready', () => {
    const action: GlobalStateAction = {
      type: 'SONGS_READY',
      payload: mockSongs,
    };
    const next = globalStateReducer(initialState, action);

    expect(next.songsStatus).toBe('ready');
    expect(next.songs).toEqual(mockSongs);
  });

  // --- SONGS_ERROR ----------------------------------------------------------

  it('handles SONGS_ERROR: sets songsStatus to error', () => {
    const next = globalStateReducer(initialState, { type: 'SONGS_ERROR' });
    expect(next.songsStatus).toBe('error');
  });

  // --- immutability ---------------------------------------------------------

  it('does not mutate the previous state', () => {
    const frozen = Object.freeze({ ...initialState });
    expect(() =>
      globalStateReducer(frozen, { type: 'SONGS_LOADING' }),
    ).not.toThrow();
  });
});
