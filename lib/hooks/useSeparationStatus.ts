'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { separationsApi } from '@/lib/api';
import type {
  NormalizedSeparationInfo,
  SeparationProviderName,
  Song,
} from '@/lib/api/types';
import {
  normalizeSeparationInfo,
  shouldPollSeparation,
} from '@/lib/separations';

const POLL_INTERVAL_MS = 1000 * 60; // 1 minute

interface UseSeparationStatusResult {
  separation: NormalizedSeparationInfo | null;
  isRequesting: boolean;
  isRefreshing: boolean;
  error: string | null;
  requestSeparation: (provider?: SeparationProviderName) => Promise<void>;
  refreshStatus: () => Promise<void>;
}

/**
 * Manages the complete lifecycle of stem separation for a song.
 *
 * Responsibilities:
 * - **Submit**: Call `requestSeparation(provider)` to initiate a new separation task
 * - **Poll**: Automatically polls every 5 seconds while task status is 'processing'
 * - **Refresh**: Manual `refreshStatus()` call to update status on demand
 * - **Normalize**: Converts provider-specific task data to unified schema via adapters
 * - **Error handling**: Captures and exposes API and network errors
 *
 * The hook subscribes to `song.separatedSongInfo` (which is updated by the
 * Firestore listener in `GlobalStateProvider`) and normalizes it to a provider-agnostic
 * shape for UI consumption. When backend updates the Firestore document with new
 * task data, the hook automatically re-normalizes and the component re-renders.
 *
 * Polling is automatic:
 * - Starts when separation task is 'processing' (via `shouldPollSeparation`)
 * - Immediately refreshes once, then polls at 5s intervals
 * - Stops when task reaches 'finished' or 'failed' status
 *
 * @param song - The song to manage separation for
 * @returns Object with separation state, loading flags, error, and lifecycle methods
 */
export function useSeparationStatus(song: Song): UseSeparationStatusResult {
  const separation = useMemo(
    () => normalizeSeparationInfo(song.separatedSongInfo),
    [song.separatedSongInfo],
  );

  const [isRequesting, setIsRequesting] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const clearPoll = useCallback((): void => {
    if (pollTimer.current) {
      clearInterval(pollTimer.current);
      pollTimer.current = null;
    }
  }, []);

  const refreshStatus = useCallback(async (): Promise<void> => {
    setIsRefreshing(true);
    setError(null);
    try {
      await separationsApi.refreshSeparationStatus(song.id);
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : 'Failed to refresh separation status';
      setError(message);
    } finally {
      setIsRefreshing(false);
    }
  }, [song.id]);

  const requestSeparation = useCallback(
    async (provider?: SeparationProviderName): Promise<void> => {
      setIsRequesting(true);
      setError(null);
      try {
        await separationsApi.requestSeparation(song.id, provider);
      } catch (err) {
        const message =
          err instanceof Error
            ? err.message
            : 'Unable to start stem separation';
        setError(message);
      } finally {
        setIsRequesting(false);
      }
    },
    [song.id],
  );

  // Poll while backend reports in-progress state
  useEffect(() => {
    clearPoll();

    if (!shouldPollSeparation(song.separatedSongInfo)) {
      return undefined;
    }

    // Immediately refresh once, then keep polling
    void refreshStatus();

    pollTimer.current = setInterval(() => {
      void refreshStatus();
    }, POLL_INTERVAL_MS);

    return clearPoll;
  }, [song.separatedSongInfo, refreshStatus, clearPoll]);

  return {
    separation,
    isRequesting,
    isRefreshing,
    error,
    requestSeparation,
    refreshStatus,
  };
}
