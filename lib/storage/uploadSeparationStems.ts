'use client';

import { getStorage, ref, uploadBytes, deleteObject } from 'firebase/storage';

import { getFirebaseApp } from '@/lib/firebase/app';
import { withPendingActivity } from '@/lib/async/pendingActivity';

/**
 * Builds the canonical Cloud Storage path for a separated stem file.
 *
 * @param userId - Firebase Auth UID of the song owner.
 * @param songId - Unique song document ID.
 * @param stemName - Stem type (vocals, bass, drums, etc).
 * @returns Storage path: `users/{userId}/songs/{songId}/stems/{stemName}.mp3`
 */
export function buildStemStoragePath(
  userId: string,
  songId: string,
  stemName: string,
): string {
  return `users/${userId}/songs/${songId}/stems/${stemName}.mp3`;
}

/**
 * Uploads a separated stem file to Firebase Storage.
 *
 * @param userId - Firebase Auth UID of the song owner.
 * @param songId - Song document ID.
 * @param stemName - Stem type identifier.
 * @param data - Audio file data (Blob or File).
 * @returns The resolved storage path.
 * @throws {Error} If the upload fails.
 */
export async function uploadSeparationStem(
  userId: string,
  songId: string,
  stemName: string,
  data: Blob,
): Promise<string> {
  return withPendingActivity(async () => {
    const storage = getStorage(getFirebaseApp());
    const storagePath = buildStemStoragePath(userId, songId, stemName);
    const storageRef = ref(storage, storagePath);

    await uploadBytes(storageRef, data, {
      customMetadata: {
        stemName,
        contentType: 'audio/mpeg',
      },
    });

    return storagePath;
  });
}

/**
 * Downloads a file from a URL and returns it as a Blob.
 *
 * @param url - The URL to download from.
 * @returns Blob containing the file data.
 * @throws {Error} If the download fails.
 */
export async function downloadFileAsBlob(url: string): Promise<Blob> {
  return withPendingActivity(async () => {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      return response.blob();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Failed to download file: ${message}`);
    }
  });
}

/**
 * Downloads multiple stems from URLs and uploads them to Firebase Storage.
 *
 * Orchestrates the full pipeline: download from provider URLs → upload to Storage.
 *
 * @param userId - Firebase Auth UID of the song owner.
 * @param songId - Song document ID.
 * @param stemUrls - Record of stem names to download URLs.
 * @returns Record of stem names to storage paths.
 * @throws {Error} If any download or upload fails.
 */
export async function processStemUrls(
  userId: string,
  songId: string,
  stemUrls: Record<string, string>,
): Promise<Record<string, string>> {
  const results = await Promise.all(
    Object.entries(stemUrls).map(async ([stemName, url]) => {
      try {
        const blob = await downloadFileAsBlob(url);
        const storagePath = await uploadSeparationStem(
          userId,
          songId,
          stemName,
          blob,
        );
        return { stemName, storagePath };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Unknown error';
        console.error(
          `Failed to process stem ${stemName} for song ${songId}: ${message}`,
        );
        return null;
      }
    }),
  );

  return results.reduce<Record<string, string>>((acc, result) => {
    if (result) {
      acc[result.stemName] = result.storagePath;
    }
    return acc;
  }, {});
}

/**
 * Deletes all stem files from Firebase Storage.
 *
 * Used as rollback mechanism when backend update fails after stem upload.
 *
 * @param userId - Firebase Auth UID of the song owner.
 * @param songId - Song document ID.
 * @param stemNames - Array of stem names to delete.
 * @throws {Error} If deletion fails for any stem.
 */
export async function deleteSeparationStems(
  userId: string,
  songId: string,
  stemNames: string[],
): Promise<void> {
  await withPendingActivity(async () => {
    const storage = getStorage(getFirebaseApp());
    const deletionPromises = stemNames.map(async (stemName) => {
      const storagePath = buildStemStoragePath(userId, songId, stemName);
      const storageRef = ref(storage, storagePath);
      try {
        await deleteObject(storageRef);
      } catch (error) {
        console.error(
          `Failed to delete stem ${stemName} at ${storagePath}:`,
          error,
        );
        throw error;
      }
    });

    await Promise.all(deletionPromises);
  });
}
