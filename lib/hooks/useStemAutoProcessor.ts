'use client';

import type { Dispatch } from 'react';
import { useEffect, useRef } from 'react';
import { useSeparationStemProcessing } from './useSeparationStemProcessing';
import { normalizeSeparationInfo } from '@/lib/separations';
import type {
  SeparatedSongInfo,
  PoyoSeparationTaskDetails,
} from '@/lib/api/types';
import type { GlobalStateAction } from '@/lib/store/reducer';
import type { Song } from '@/lib/store/types';

/**
 * Monitors globalState songs for finished separations without uploaded stems.
 *
 * Automatically triggers stem upload + backend update when detecting:
 * - `separation.status === 'finished'`
 * - `separation.stems === null`
 * - Not currently uploading stems for this song
 *
 * This hook replaces the previous polling-based auto-processing logic.
 * Now the flow is:
 * 1. Backend polls provider and updates Firestore `providerData`
 * 2. Firestore listener propagates change to globalState
 * 3. This hook detects the change and triggers stem processing
 *
 * Each song is processed at most once to prevent infinite loops.
 */
interface UseStemAutoProcessorParams {
  songs: Song[];
  songsStemUploading: Set<string>;
  dispatch: Dispatch<GlobalStateAction>;
}

export function useStemAutoProcessor({
  songs,
  songsStemUploading,
  dispatch,
}: UseStemAutoProcessorParams): void {
  const { processSeparationStems } = useSeparationStemProcessing();

  // Track songs already processed to prevent re-processing on re-renders
  const processedSongsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    songs.forEach((song) => {
      const { id, separatedSongInfo } = song;

      // Skip if no separation info
      if (!separatedSongInfo) return;

      // Normalize to access status field
      const normalized = normalizeSeparationInfo(separatedSongInfo);
      if (!normalized) return;

      // Skip if not finished
      if (normalized.status !== 'finished') return;

      // Skip if stems already uploaded
      if (normalized.stems) return;

      // Skip if currently uploading
      if (songsStemUploading.has(id)) return;

      // Skip if already processed in this session
      if (processedSongsRef.current.has(id)) return;

      // Mark as processed to prevent re-triggering
      processedSongsRef.current.add(id);

      // Start upload process
      dispatch({ type: 'SONG_STEM_UPLOAD_START', payload: id });

      void (async () => {
        try {
          // Type assertion safe as we only support PoYo currently
          await processSeparationStems(
            id,
            separatedSongInfo as SeparatedSongInfo<PoyoSeparationTaskDetails>,
          );
        } catch (error) {
          const message =
            error instanceof Error
              ? error.message
              : 'Failed to process separation stems';
          console.error(`Stem processing failed for song ${id}:`, message);
          // Remove from processed set to allow retry on next state change
          processedSongsRef.current.delete(id);
        } finally {
          dispatch({ type: 'SONG_STEM_UPLOAD_END', payload: id });
        }
      })();
    });
  }, [songs, songsStemUploading, dispatch, processSeparationStems]);

  // Clear processed set when songs array changes substantially (e.g., new user, refresh)
  useEffect(() => {
    const currentIds = new Set(songs.map((s) => s.id));
    const processedIds = Array.from(processedSongsRef.current);

    // Remove processed IDs for songs that no longer exist
    processedIds.forEach((id) => {
      if (!currentIds.has(id)) {
        processedSongsRef.current.delete(id);
      }
    });
  }, [songs]);
}
