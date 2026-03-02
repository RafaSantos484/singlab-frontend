'use client';

import { storageUrlManager } from '@/lib/storage/StorageUrlManager';

/**
 * Returns a signed download URL for the given storage path.
 *
 * Uses a centralized cache manager that:
 * - Deduplicates concurrent requests
 * - Caches URLs with time-to-live based expiration (1 day)
 * - Automatically refreshes expired URLs
 *
 * @param path - Firebase Storage path (e.g., "songs/raw/uuid.mp3")
 * @returns A valid signed download URL
 */
export async function getStorageDownloadUrl(path: string): Promise<string> {
  return storageUrlManager.getUrl(path);
}
