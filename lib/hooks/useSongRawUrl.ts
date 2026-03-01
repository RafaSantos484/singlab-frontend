'use client';

import { useEffect, useRef, useState } from 'react';

import type { Song } from '@/lib/api/types';
import { getStorageDownloadUrl } from '@/lib/storage/getStorageDownloadUrl';

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

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Returns a valid signed URL for the song's raw audio file.
 */
export function useSongRawUrl(song: Song): UseSongRawUrlResult {
  const [resolvedUrl, setResolvedUrl] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Prevent duplicate in-flight requests for the same song.
  const refreshingRef = useRef(false);

  useEffect(() => {
    if (!song.rawSongInfo?.path) return;

    // Avoid launching a second parallel request for the same song.
    if (refreshingRef.current) return;

    refreshingRef.current = true;
    setIsRefreshing(true);
    setError(null);

    getStorageDownloadUrl(song.rawSongInfo.path)
      .then((value) => {
        setResolvedUrl(value);
      })
      .catch(() => {
        setError('Failed to resolve audio URL. Playback may not be available.');
      })
      .finally(() => {
        refreshingRef.current = false;
        setIsRefreshing(false);
      });

    // Clean up: if the effect re-runs before the request settles, reset the
    // guard so the next run can issue a fresh request if needed.
    return () => {
      refreshingRef.current = false;
    };
    // Re-run when the song or its storage path changes.
  }, [song.id, song.rawSongInfo?.path]);

  return {
    url: resolvedUrl,
    isRefreshing,
    error,
  };
}
