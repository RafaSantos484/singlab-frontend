'use client';

import { getStorage, ref, uploadBytes, deleteObject } from 'firebase/storage';

import { getFirebaseApp } from '@/lib/firebase/app';
import {
  CANONICAL_AUDIO_EXTENSION,
  CANONICAL_AUDIO_MIME_TYPE,
} from '@/lib/audio/normalizeAudio';
import { withPendingActivity } from '@/lib/async/pendingActivity';
import { storageUrlManager } from './StorageUrlManager';

/**
 * Builds the canonical Cloud Storage path for a raw song file.
 *
 * @param userId - Firebase Auth UID of the song owner.
 * @param songId - Unique song document ID.
 * @returns Storage path: `users/{userId}/songs/{songId}/raw.m4a`
 */
export function buildRawSongStoragePath(
  userId: string,
  songId: string,
): string {
  return `users/${userId}/songs/${songId}/raw${CANONICAL_AUDIO_EXTENSION}`;
}

/**
 * Uploads a raw audio file to Firebase Storage at the canonical path
 * `users/:userId/songs/:songId/raw.m4a`.
 *
 * The caller must generate a stable `songId` before uploading so it can
 * later register the song with the API using the same identifier.
 *
 * @param userId - Firebase Auth UID of the song owner.
 * @param songId - Pre-generated unique song document ID.
 * @param file   - The audio file to upload.
 * @returns The resolved storage path.
 * @throws {Error} If the upload fails.
 */
export async function uploadRawSong(
  userId: string,
  songId: string,
  file: File,
): Promise<string> {
  return withPendingActivity(async () => {
    const storage = getStorage(getFirebaseApp());
    const storagePath = buildRawSongStoragePath(userId, songId);
    const storageRef = ref(storage, storagePath);

    await uploadBytes(storageRef, file, {
      contentType: CANONICAL_AUDIO_MIME_TYPE,
    });

    // Invalidate cache to ensure fresh URL on next access
    storageUrlManager.invalidatePath(storagePath);

    return storagePath;
  });
}

/**
 * Deletes a raw song file from Firebase Storage.
 * Used for cleanup/rollback when API registration fails after upload.
 *
 * @param userId - Firebase Auth UID of the song owner.
 * @param songId - Song document ID.
 * @throws {Error} If deletion fails (typically if file doesn't exist).
 */
export async function deleteRawSong(
  userId: string,
  songId: string,
): Promise<void> {
  const storagePath = buildRawSongStoragePath(userId, songId);
  await deleteRawSongAtPath(storagePath);
}

/**
 * Deletes a raw song file by its exact Storage path.
 *
 * Useful for deleting legacy files whose extension may differ from the current
 * canonical one.
 */
export async function deleteRawSongAtPath(storagePath: string): Promise<void> {
  await withPendingActivity(async () => {
    const storage = getStorage(getFirebaseApp());
    const storageRef = ref(storage, storagePath);

    await deleteObject(storageRef);

    // Clear cache entry for deleted file
    storageUrlManager.invalidatePath(storagePath);
  });
}
