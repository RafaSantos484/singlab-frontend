'use client';

import { useEffect, useState } from 'react';

import type { SeparationStemName } from '@/lib/api/types';
import { getStorageDownloadUrl } from '@/lib/storage/getStorageDownloadUrl';

interface UseStorageDownloadUrlsResult {
  urls: Partial<Record<SeparationStemName, string>>;
  isLoading: boolean;
  error: string | null;
}

/**
 * Resolves Firebase Storage download URLs for a set of stem paths.
 */
export function useStorageDownloadUrls(
  paths: Partial<Record<SeparationStemName, string>> | null | undefined,
): UseStorageDownloadUrlsResult {
  const [urls, setUrls] = useState<Partial<Record<SeparationStemName, string>>>(
    {},
  );
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!paths || Object.keys(paths).length === 0) {
      setUrls({});
      setIsLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;
    const entries = Object.entries(paths).filter(([, path]) => Boolean(path));

    if (entries.length === 0) {
      setUrls({});
      setIsLoading(false);
      setError(null);
      return;
    }

    setIsLoading(true);
    setError(null);

    const resolve = async (): Promise<void> => {
      try {
        const resolved = await Promise.all(
          entries.map(async ([stem, path]) => {
            const url = await getStorageDownloadUrl(path as string);
            return [stem as SeparationStemName, url] as const;
          }),
        );

        if (cancelled) return;

        const next: Partial<Record<SeparationStemName, string>> = {};
        resolved.forEach(([stem, url]) => {
          next[stem] = url;
        });
        setUrls(next);
      } catch (err) {
        if (cancelled) return;
        const message =
          err instanceof Error ? err.message : 'Failed to resolve stem URLs';
        setError(message);
        setUrls({});
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    void resolve();

    return () => {
      cancelled = true;
    };
  }, [paths]);

  return { urls, isLoading, error };
}
