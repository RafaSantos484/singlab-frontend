'use client';

import { useSongRawUrl } from '@/lib/hooks/useSongRawUrl';
import type { Song } from '@/lib/api/types';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface SongPlayerProps {
  /** The song to play. The component handles signed URL refresh automatically. */
  song: Song;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Inline audio player for a single song.
 *
 * Renders a native `<audio>` element pre-loaded with the song's signed raw
 * URL. If the URL is expired or about to expire, the `useSongRawUrl` hook
 * transparently fetches a fresh one from the API before handing it to the
 * player.
 */
export function SongPlayer({ song }: SongPlayerProps): React.ReactElement {
  const { url, isRefreshing, error } = useSongRawUrl(song);

  if (error) {
    return (
      <p className="mt-2 text-xs text-red-400">{error}</p>
    );
  }

  if (isRefreshing || !url) {
    return (
      <div className="mt-2 flex items-center gap-2 text-xs text-zinc-500">
        <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-zinc-600 border-t-zinc-400" />
        {isRefreshing ? 'Refreshing audio link…' : 'Loading…'}
      </div>
    );
  }

  return (
    // Re-key on the URL so React replaces the element when the signed URL
    // changes, preventing the browser from playing a stale source.
    <audio
      key={url}
      controls
      preload="metadata"
      className="mt-2 h-8 w-full"
      aria-label={`Play ${song.title} by ${song.author}`}
    >
      <source src={url} />
      Your browser does not support the audio element.
    </audio>
  );
}
