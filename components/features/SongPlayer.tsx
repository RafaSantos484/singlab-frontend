'use client';

import { Box, CircularProgress, Alert } from '@mui/material';
import { useSongRawUrl } from '@/lib/hooks/useSongRawUrl';
import { CustomAudioPlayer } from './CustomAudioPlayer';
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
 * Renders a custom audio player with the song's signed raw URL.
 * If the URL is expired or about to expire, the `useSongRawUrl` hook
 * transparently fetches a fresh one from the API before handing it to the
 * player.
 */
export function SongPlayer({ song }: SongPlayerProps): React.ReactElement {
  const { url, isRefreshing, error } = useSongRawUrl(song);

  if (error) {
    return (
      <Alert severity="error" sx={{ fontSize: '0.875rem' }}>
        {error}
      </Alert>
    );
  }

  if (isRefreshing || !url) {
    return (
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1.5,
          p: 2,
          borderRadius: 2,
          bgcolor: 'rgba(19, 10, 53, 0.5)',
          border: '1px solid rgba(124, 58, 237, 0.2)',
        }}
      >
        <CircularProgress size={16} sx={{ color: 'primary.main' }} />
        <Box
          component="span"
          sx={{
            fontSize: '0.875rem',
            color: 'text.secondary',
          }}
        >
          {isRefreshing ? 'Refreshing audio link…' : 'Loading…'}
        </Box>
      </Box>
    );
  }

  return (
    // Re-key on the URL so React replaces the element when the signed URL
    // changes, preventing the browser from playing a stale source.
    <CustomAudioPlayer
      key={url}
      src={url}
      ariaLabel={`Play ${song.title} by ${song.author}`}
    />
  );
}
