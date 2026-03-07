'use client';

import { useEffect, useReducer, useRef } from 'react';

import type { Song } from '@/lib/api/types';
import { getFirebaseAuth } from '@/lib/firebase/auth';
import { getStorageDownloadUrl } from '@/lib/storage/getStorageDownloadUrl';
import { buildRawSongStoragePath } from '@/lib/storage/uploadRawSong';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UseSongRawUrlResult {
  /** The best available signed URL, or `null` while the first fetch is in flight. */
  url: string | null;
  /** `true` while a refresh request is in-flight. */
  isRefreshing: boolean;
  /** Last refresh error message, if any. */
  error: string | null;
}

interface State {
  url: string | null;
  isRefreshing: boolean;
  error: string | null;
}

type Action =
  | { type: 'START_FETCH' }
  | { type: 'SUCCESS'; payload: string }
  | { type: 'ERROR' };

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'START_FETCH':
      return { ...state, isRefreshing: true, error: null };
    case 'SUCCESS':
      return { url: action.payload, isRefreshing: false, error: null };
    case 'ERROR':
      return {
        ...state,
        isRefreshing: false,
        error: 'Failed to resolve audio URL. Playback may not be available.',
      };
    default:
      return state;
  }
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Returns a valid signed URL for the song's raw audio file.
 */
export function useSongRawUrl(song: Song): UseSongRawUrlResult {
  const [state, dispatch] = useReducer(reducer, {
    url: null,
    isRefreshing: false,
    error: null,
  });

  // Prevent duplicate in-flight requests for the same song.
  const refreshingRef = useRef(false);

  useEffect(() => {
    if (!song.rawSongInfo?.uploadedAt) return;
    const currentUser = getFirebaseAuth().currentUser;
    if (!currentUser?.uid) return;

    const storagePath = buildRawSongStoragePath(currentUser.uid, song.id);

    // Avoid launching a second parallel request for the same song.
    if (refreshingRef.current) return;

    refreshingRef.current = true;
    dispatch({ type: 'START_FETCH' });

    getStorageDownloadUrl(storagePath)
      .then((value) => {
        dispatch({ type: 'SUCCESS', payload: value });
      })
      .catch(() => {
        dispatch({ type: 'ERROR' });
      })
      .finally(() => {
        refreshingRef.current = false;
      });

    // Clean up: if the effect re-runs before the request settles, reset the
    // guard so the next run can issue a fresh request if needed.
    return () => {
      refreshingRef.current = false;
    };
    // Re-run when the song/user identity changes.
  }, [song.id, song.rawSongInfo?.uploadedAt]);

  return state;
}
