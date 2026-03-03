import { getDownloadURL, getStorage, ref } from 'firebase/storage';

import { getFirebaseApp } from '@/lib/firebase/app';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CachedUrl {
  url: string;
  timestamp: number; // When the URL was cached (ms since epoch)
}

// ---------------------------------------------------------------------------
// StorageUrlManager
// ---------------------------------------------------------------------------

/**
 * Centralized manager for Firebase Storage download URLs.
 *
 * Features:
 * - In-memory cache with TTL-based expiration
 * - Deduplicates in-flight requests
 * - Automatic refresh when URLs expire
 * - Thread-safe handling of concurrent requests
 *
 * URL caching strategy (in-memory only):
 * ────────────────────────────────────
 * Firebase Storage URLs are signed and valid for ~1 week. However, per spec,
 * we implement TTL of 1 day for freshness. The cache is stored in memory only
 * because:
 * - Memory access is fast (critical for real-time playback switching)
 * - Page reload will lose cache, but that's acceptable since URLs are cached
 *   server-side anyway and can be re-fetched quickly
 * - Most karaoke sessions are continuous; cross-session persistence is low-value
 * - Browser storage (localStorage/sessionStorage) adds serialization overhead
 *
 * If cross-session URL caching becomes important, localStorage can be added
 * with JSON serialization and TTL checks during deserialization.
 */
class StorageUrlManager {
  /** Cache storage: path → (URL + timestamp) */
  private urlCache = new Map<string, CachedUrl>();

  /** In-flight requests: path → Promise */
  private inFlightRequests = new Map<string, Promise<string>>();

  /** Time-to-live for cached URLs in milliseconds. Default: 1 day. */
  private readonly TTL_MS = 24 * 60 * 60 * 1000; // 1 day

  /**
   * Get a signed download URL for the given storage path.
   *
   * - Returns cached URL if available and not expired
   * - Deduplicates concurrent requests for the same path
   * - Automatically refreshes expired URLs
   *
   * @param path - Firebase Storage path (e.g., "songs/raw/uuid.mp3")
   * @returns A valid signed download URL
   * @throws If the Firebase operation fails
   */
  public async getUrl(path: string): Promise<string> {
    // Check if we have a valid cached URL
    const cached = this.urlCache.get(path);
    if (cached && !this.isExpired(cached)) {
      return cached.url;
    }

    // Check if a request for this path is already in-flight
    const inFlight = this.inFlightRequests.get(path);
    if (inFlight) {
      return inFlight;
    }

    // Launch a new request and cache the promise
    const request = this.fetchUrl(path);
    this.inFlightRequests.set(path, request);

    try {
      const url = await request;
      this.urlCache.set(path, { url, timestamp: Date.now() });
      return url;
    } catch (error) {
      // Remove from cache on error so next call retries
      this.urlCache.delete(path);
      throw error;
    } finally {
      this.inFlightRequests.delete(path);
    }
  }

  /**
   * Clear all cached URLs. Useful for logout or testing.
   */
  public clearCache(): void {
    this.urlCache.clear();
    this.inFlightRequests.clear();
  }

  /**
   * Get cache statistics for debugging.
   */
  public getStats(): { cachedPaths: number; inFlightRequests: number } {
    return {
      cachedPaths: this.urlCache.size,
      inFlightRequests: this.inFlightRequests.size,
    };
  }

  /**
   * Check if a cached URL has expired based on TTL.
   */
  private isExpired(cached: CachedUrl): boolean {
    return Date.now() - cached.timestamp > this.TTL_MS;
  }

  /**
   * Fetch a new URL from Firebase Storage.
   */
  private async fetchUrl(path: string): Promise<string> {
    const storage = getStorage(getFirebaseApp());
    return getDownloadURL(ref(storage, path));
  }
}

// Singleton instance
const manager = new StorageUrlManager();

export { StorageUrlManager };
export const storageUrlManager = manager;
