'use client';

import { useEffect, useRef, useState } from 'react';

import { songsApi } from '@/lib/api';
import type { Song } from '@/lib/api/types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * How many milliseconds before the URL's expiry we proactively refresh it.
 * Default: 5 minutes.
 */
const REFRESH_MARGIN_MS = 5 * 60 * 1_000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isNearExpiry(expiresAt: string): boolean {
  return new Date(expiresAt).getTime() - Date.now() < REFRESH_MARGIN_MS;
}

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
 *
 * Strategy:
 * 1. If `song.rawSongInfo.urlInfo.expiresAt` is still far in the future, the
 *    current URL is returned immediately.
 * 2. If the URL is expired or within {@link REFRESH_MARGIN_MS} of expiry,
 *    `GET /songs/:songId/raw/url` is called. The backend updates the signed URL
 *    in Firestore and returns the new value. The returned URL is cached locally
 *    and served immediately; the Firestore real-time listener in
 *    `GlobalStateProvider` will subsequently update the global `songs` state
 *    automatically.
 * 3. Re-runs whenever the song's URL or expiry changes (e.g. a Firestore update
 *    arrives with a freshly issued URL).
 */
export function useSongRawUrl(song: Song): UseSongRawUrlResult {
  // Local cache of a freshly-fetched URL so the player can start immediately
  // without waiting for the Firestore round-trip.
  const [refreshedUrl, setRefreshedUrl] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Prevent duplicate in-flight requests for the same song.
  const refreshingRef = useRef(false);

  const urlInfo = song.rawSongInfo?.urlInfo;

  useEffect(() => {
    if (!urlInfo) return;

    if (!isNearExpiry(urlInfo.expiresAt)) {
      // The current URL is still valid — use it directly.
      setRefreshedUrl(urlInfo.value);
      setError(null);
      return;
    }

    // Avoid launching a second parallel request for the same song.
    if (refreshingRef.current) return;

    refreshingRef.current = true;
    setIsRefreshing(true);
    setError(null);

    songsApi
      .getSongRawUrl(song.id)
      .then((result) => {
        setRefreshedUrl(result.value);
      })
      .catch(() => {
        setError('Failed to refresh audio URL. Playback may not be available.');
        // Fall back to the existing URL so the player is not left empty.
        setRefreshedUrl(urlInfo.value);
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
  // Re-run when the song URL or its expiry changes. This picks up both the
  // initial load and subsequent Firestore-pushed updates.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [song.id, urlInfo?.expiresAt, urlInfo?.value]);

  return {
    url: refreshedUrl,
    isRefreshing,
    error,
  };
}
