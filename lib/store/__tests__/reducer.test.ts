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
    expect(initialState.currentSongId).toBeNull();
    expect(initialState.playbackStatus).toBe('idle');
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

  // --- PLAYER_LOAD_SONG -----------------------------------------------------

  it('handles PLAYER_LOAD_SONG: sets currentSongId and playbackStatus to loading', () => {
    const action: GlobalStateAction = {
      type: 'PLAYER_LOAD_SONG',
      payload: 'song-123',
    };
    const next = globalStateReducer(initialState, action);

    expect(next.currentSongId).toBe('song-123');
    expect(next.playbackStatus).toBe('loading');
  });

  // --- PLAYER_SET_STATUS ----------------------------------------------------

  it('handles PLAYER_SET_STATUS: updates playbackStatus', () => {
    const stateWithSong = {
      ...initialState,
      currentSongId: 'song-123',
      playbackStatus: 'loading' as const,
    };

    const action: GlobalStateAction = {
      type: 'PLAYER_SET_STATUS',
      payload: 'playing',
    };
    const next = globalStateReducer(stateWithSong, action);

    expect(next.playbackStatus).toBe('playing');
    expect(next.currentSongId).toBe('song-123'); // unchanged
  });

  it('handles PLAYER_SET_STATUS: can pause', () => {
    const stateWithSong = {
      ...initialState,
      currentSongId: 'song-123',
      playbackStatus: 'playing' as const,
    };

    const action: GlobalStateAction = {
      type: 'PLAYER_SET_STATUS',
      payload: 'paused',
    };
    const next = globalStateReducer(stateWithSong, action);

    expect(next.playbackStatus).toBe('paused');
  });

  // --- PLAYER_STOP ----------------------------------------------------------

  it('handles PLAYER_STOP: clears currentSongId and sets playbackStatus to idle', () => {
    const stateWithSong = {
      ...initialState,
      currentSongId: 'song-123',
      playbackStatus: 'playing' as const,
    };

    const next = globalStateReducer(stateWithSong, { type: 'PLAYER_STOP' });

    expect(next.currentSongId).toBeNull();
    expect(next.playbackStatus).toBe('idle');
  });

  // --- immutability ---------------------------------------------------------

  it('does not mutate the previous state', () => {
    const frozen = Object.freeze({ ...initialState });
    expect(() =>
      globalStateReducer(frozen, { type: 'SONGS_LOADING' }),
    ).not.toThrow();
  });
});
