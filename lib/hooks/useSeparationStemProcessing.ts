'use client';

import { useCallback } from 'react';
import { getFirebaseAuth } from '@/lib/firebase/auth';
import {
  processStemUrls,
  deleteSeparationStems,
} from '@/lib/storage/uploadSeparationStems';
import { separationsApi } from '@/lib/api';
import { PoyoSeparationAdapter } from '@/lib/separations/poyoAdapter';
import type {
  SeparatedSongInfo,
  PoyoSeparationTaskDetails,
} from '@/lib/api/types';

/**
 * Hook that provides utilities to process and upload separation stems.
 *
 * When a separation task finishes (detected via status polling), the client
 * extracts stem URLs from provider data, downloads each stem, uploads to
 * Firebase Storage, and then notifies the backend of the stem storage paths.
 *
 * If backend update fails, automatically rolls back by deleting uploaded stems.
 */
export function useSeparationStemProcessing(): {
  processSeparationStems: (
    songId: string,
    separatedSongInfo: SeparatedSongInfo<PoyoSeparationTaskDetails>,
  ) => Promise<void>;
} {
  const processSeparationStems = useCallback(
    async (
      songId: string,
      separatedSongInfo: SeparatedSongInfo<PoyoSeparationTaskDetails>,
    ): Promise<void> => {
      const currentUser = getFirebaseAuth().currentUser;
      if (!currentUser) {
        throw new Error('No authenticated user');
      }

      const adapter = new PoyoSeparationAdapter();
      const { providerData, stems } = separatedSongInfo;

      // Check if stems should be processed
      if (!adapter.shouldProcessStems(providerData, stems)) {
        return;
      }

      // Extract stem URLs from provider data
      const stemUrls = adapter.getStemUrls(providerData);
      if (Object.keys(stemUrls).length === 0) {
        console.warn(
          `No stem URLs found for song ${songId}, skipping processing`,
        );
        return;
      }

      // Download and upload stems to Firebase Storage
      const stemPaths = await processStemUrls(
        currentUser.uid,
        songId,
        stemUrls,
      );

      try {
        // Notify backend of the uploaded stems
        await separationsApi.updateSeparationStems(
          songId,
          stemPaths,
          separatedSongInfo.provider,
        );
      } catch (error) {
        // Rollback: delete uploaded stems if backend update fails
        console.error(
          `Backend update failed for song ${songId}, rolling back stems`,
        );
        try {
          await deleteSeparationStems(
            currentUser.uid,
            songId,
            Object.keys(stemPaths),
          );
        } catch (rollbackError) {
          console.error(`Rollback failed for song ${songId}:`, rollbackError);
        }
        throw error;
      }
    },
    [],
  );

  return { processSeparationStems };
}
