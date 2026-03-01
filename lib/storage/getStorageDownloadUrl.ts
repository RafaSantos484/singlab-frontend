'use client';

import { getDownloadURL, getStorage, ref } from 'firebase/storage';

import { getFirebaseApp } from '@/lib/firebase/app';

const urlCache = new Map<string, Promise<string>>();

/**
 * Returns a signed download URL for the given storage path.
 * Caches in-flight and resolved lookups to avoid duplicate requests.
 */
export async function getStorageDownloadUrl(path: string): Promise<string> {
  if (!urlCache.has(path)) {
    const storage = getStorage(getFirebaseApp());
    const urlPromise = getDownloadURL(ref(storage, path)).catch((error) => {
      urlCache.delete(path);
      throw error;
    });
    urlCache.set(path, urlPromise);
  }

  return urlCache.get(path)!;
}
