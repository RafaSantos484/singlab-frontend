'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { separationsApi } from '@/lib/api';
import type {
  NormalizedSeparationInfo,
  SeparationProviderName,
  SeparationStemName,
  Song,
} from '@/lib/api/types';
import {
  normalizeSeparationInfo,
  shouldPollSeparation,
} from '@/lib/separations';
import { getFirebaseAuth } from '@/lib/firebase/auth';
import { updateSeparatedSongInfo } from '@/lib/firebase/songs';
import { getStorageDownloadUrl } from '@/lib/storage/getStorageDownloadUrl';
import { useStorageDownloadUrls } from './useStorageDownloadUrls';

const POLL_INTERVAL_MS = 1000 * 60; // 1 minute

interface UseSeparationStatusResult {
  separation: NormalizedSeparationInfo | null;
  isRequesting: boolean;
  isRefreshing: boolean;
  error: string | null;
  stemUrls: Partial<Record<SeparationStemName, string>>;
  isResolvingStemUrls: boolean;
  stemUrlError: string | null;
  requestSeparation: (provider?: SeparationProviderName) => Promise<void>;
  refreshStatus: () => Promise<void>;
}

/**
 * Manages the complete lifecycle of stem separation for a song.
 *
 * Responsibilities:
 * - **Submit**: Call `requestSeparation(provider)` to initiate a new separation task.
 *   Gets the song's signed audio URL, calls the backend with audioUrl+title,
 *   and persists the provider response to Firestore.
 * - **Poll**: Automatically polls every 60 seconds while task status is 'processing'.
 * - **Refresh**: Manual `refreshStatus()` call to update status on demand.
 *   Calls the backend with the taskId, then writes the updated provider data
 *   to Firestore.
 * - **Normalize**: Converts provider-specific task data to unified schema via adapters.
 * - **Error handling**: Captures and exposes API and network errors.
 *
 * The hook subscribes to `song.separatedSongInfo` (which is updated by the
 * Firestore listener in `GlobalStateProvider`) and normalizes it to a provider-agnostic
 * shape for UI consumption.
 *
 * **Stem processing** is handled separately by `useStemAutoProcessor` in the
 * `GlobalStateProvider`. This hook only polls provider status, it does NOT
 * upload stems automatically.
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

  const {
    urls: stemUrls,
    isLoading: isResolvingStemUrls,
    error: stemUrlError,
  } = useStorageDownloadUrls(separation?.stems?.paths ?? null);

  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const clearPoll = useCallback((): void => {
    if (pollTimer.current) {
      clearInterval(pollTimer.current);
      pollTimer.current = null;
    }
  }, []);

  const refreshStatus = useCallback(async (): Promise<void> => {
    const currentUser = getFirebaseAuth().currentUser;
    if (!currentUser) return;

    // Need the taskId from the existing separation info
    const normalized = normalizeSeparationInfo(song.separatedSongInfo);
    if (!normalized?.taskId) return;

    setIsRefreshing(true);
    setError(null);
    try {
      const providerData =
        await separationsApi.refreshSeparationStatus(
          normalized.taskId,
          normalized.provider,
        );

      if (providerData) {
        // Write updated provider data to Firestore
        await updateSeparatedSongInfo(currentUser.uid, song.id, {
          provider: normalized.provider,
          providerData,
          stems: song.separatedSongInfo?.stems ?? null,
        });
      }
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : 'Failed to refresh separation status';
      setError(message);
    } finally {
      setIsRefreshing(false);
    }
  }, [song.id, song.separatedSongInfo]);

  const requestSeparation = useCallback(
    async (provider?: SeparationProviderName): Promise<void> => {
      const currentUser = getFirebaseAuth().currentUser;
      if (!currentUser) {
        setError('No authenticated user');
        return;
      }

      // Get a signed URL for the raw audio file
      if (!song.rawSongInfo?.path) {
        setError('Song has no audio file');
        return;
      }

      setIsRequesting(true);
      setError(null);
      try {
        const audioUrl = await getStorageDownloadUrl(
          song.rawSongInfo.path,
        );

        const providerData =
          await separationsApi.requestSeparation(
            audioUrl,
            song.title,
            provider,
          );

        if (providerData) {
          // Persist provider task data to Firestore
          await updateSeparatedSongInfo(currentUser.uid, song.id, {
            provider: provider ?? 'poyo',
            providerData,
            stems: null,
          });
        }
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
    [song.id, song.title, song.rawSongInfo?.path],
  );

  // Poll while task is in-progress
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
    stemUrls,
    isResolvingStemUrls,
    stemUrlError,
    requestSeparation,
    refreshStatus,
  };
}
