'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Box,
  Card,
  CardContent,
  Typography,
  IconButton,
  Slider,
  Stack,
  CircularProgress,
  Alert,
  Tooltip,
} from '@mui/material';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import PauseIcon from '@mui/icons-material/Pause';
import StopIcon from '@mui/icons-material/Stop';
import VolumeUpIcon from '@mui/icons-material/VolumeUp';
import VolumeOffIcon from '@mui/icons-material/VolumeOff';

import { useGlobalState } from '@/lib/store';
import { useGlobalStateDispatch } from '@/lib/store/GlobalStateContext';
import { useSongRawUrl } from '@/lib/hooks/useSongRawUrl';
import type { Song } from '@/lib/api/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Format seconds into MM:SS format.
 */
function formatTime(seconds: number): string {
  if (!isFinite(seconds)) {
    return '0:00';
  }
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Global audio player component.
 *
 * Renders a single player that displays the currently playing song from global state.
 * Features:
 * - Single audio element for all playback
 * - Play/Pause/Stop controls
 * - Progress bar with seek functionality
 * - Volume control
 * - Displays currently playing song info
 * - Integrated with global state
 */
export function GlobalPlayer(): React.ReactElement {
  const { currentSongId, songs } = useGlobalState();

  // Find the current song
  const currentSong = currentSongId
    ? songs.find((s) => s.id === currentSongId)
    : null;

  // Don't render if no song is loaded
  if (!currentSongId || !currentSong) {
    return <></>;
  }

  return <GlobalPlayerInner song={currentSong} />;
}

// ---------------------------------------------------------------------------
// Inner component (receives a guaranteed Song)
// ---------------------------------------------------------------------------

interface GlobalPlayerInnerProps {
  song: Song;
}

function GlobalPlayerInner({
  song,
}: GlobalPlayerInnerProps): React.ReactElement {
  const { playbackStatus } = useGlobalState();
  const dispatch = useGlobalStateDispatch();

  // Get the signed URL for the current song
  const { url, isRefreshing, error } = useSongRawUrl(song);

  // Audio element ref
  const audioRef = useRef<HTMLAudioElement>(null);

  // Local state for playback controls
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);

  // Toggle play/pause
  const togglePlay = useCallback(async (): Promise<void> => {
    const audio = audioRef.current;
    if (!audio || !url) return;

    if (playbackStatus === 'playing') {
      audio.pause();
    } else {
      try {
        await audio.play();
        dispatch({ type: 'PLAYER_SET_STATUS', payload: 'playing' });
      } catch (error) {
        console.error('Failed to play audio:', error);
      }
    }
  }, [dispatch, playbackStatus, url]);

  // Stop playback and clear current song
  const handleStop = useCallback((): void => {
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.currentTime = 0;
    }
    dispatch({ type: 'PLAYER_STOP' });
  }, [dispatch]);

  // Handle seek
  const handleSeek = useCallback(
    (_event: Event, value: number | number[]): void => {
      const audio = audioRef.current;
      if (!audio) return;

      const newTime = Array.isArray(value) ? value[0] : value;
      audio.currentTime = newTime;
    },
    [],
  );

  // Toggle mute
  const toggleMute = useCallback((): void => {
    const audio = audioRef.current;
    if (!audio) return;

    if (isMuted) {
      audio.volume = volume;
      setIsMuted(false);
    } else {
      audio.volume = 0;
      setIsMuted(true);
    }
  }, [isMuted, volume]);

  // Handle volume change
  const handleVolumeChange = useCallback(
    (_event: Event, value: number | number[]): void => {
      const audio = audioRef.current;
      if (!audio) return;

      const newVolume = Array.isArray(value) ? value[0] : value;
      audio.volume = newVolume;
      setVolume(newVolume);
      if (newVolume > 0 && isMuted) {
        setIsMuted(false);
      }
    },
    [isMuted],
  );

  // Sync audio events with global state
  // This effect sets up event listeners on the audio element to keep the global
  // state synchronized with the actual playback state. This ensures the UI
  // accurately reflects what the audio element is doing, including responses to
  // browser-level controls (media keys, picture-in-picture, etc.).
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const handlePlay = (): void => {
      dispatch({ type: 'PLAYER_SET_STATUS', payload: 'playing' });
    };

    const handlePause = (): void => {
      dispatch({ type: 'PLAYER_SET_STATUS', payload: 'paused' });
    };

    const handleTimeUpdate = (): void => {
      setCurrentTime(audio.currentTime);
    };

    const handleLoadedMetadata = (): void => {
      setDuration(audio.duration);

      // Only mark paused if the element is actually paused. When autoplaying,
      // loadedmetadata can fire after play(), so avoid clobbering the
      // 'playing' state.
      if (audio.paused) {
        dispatch({ type: 'PLAYER_SET_STATUS', payload: 'paused' });
      }
    };

    const handleEnded = (): void => {
      dispatch({ type: 'PLAYER_SET_STATUS', payload: 'paused' });
      audio.currentTime = 0;
    };

    audio.addEventListener('play', handlePlay);
    audio.addEventListener('pause', handlePause);
    audio.addEventListener('timeupdate', handleTimeUpdate);
    audio.addEventListener('loadedmetadata', handleLoadedMetadata);
    audio.addEventListener('ended', handleEnded);

    return () => {
      audio.removeEventListener('play', handlePlay);
      audio.removeEventListener('pause', handlePause);
      audio.removeEventListener('timeupdate', handleTimeUpdate);
      audio.removeEventListener('loadedmetadata', handleLoadedMetadata);
      audio.removeEventListener('ended', handleEnded);
    };
  }, [dispatch]);

  // Auto-play when song changes and URL is ready
  // This effect runs when a new song is loaded (playbackStatus === 'loading')
  // and a signed URL becomes available. It sets the audio source and attempts
  // to begin playback automatically. The effect only triggers for status 'loading'
  // to avoid interfering with user-initiated play/pause actions.
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !url || playbackStatus !== 'loading') return;

    // Changing the src stops prior playback automatically; avoid calling
    // pause() here to prevent AbortError from an in-flight play() promise.
    audio.currentTime = 0;
    audio.src = url;

    // Attempt to play; modern browsers may reject autoplay without user gesture.
    const playPromise = audio.play();
    if (playPromise !== undefined) {
      playPromise
        .then(() => {
          dispatch({ type: 'PLAYER_SET_STATUS', payload: 'playing' });
        })
        .catch((error: unknown) => {
          // AbortError happens if the browser cancels play; treat as paused.
          if ((error as Error).name === 'AbortError') {
            dispatch({ type: 'PLAYER_SET_STATUS', payload: 'paused' });
            return;
          }

          console.error('Failed to auto-play:', error);
          dispatch({ type: 'PLAYER_SET_STATUS', payload: 'paused' });
        });
    }
  }, [url, song.id, playbackStatus, dispatch]);

  return (
    <Card
      sx={{
        position: 'sticky',
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: 1000,
        borderRadius: 0,
        borderTop: '1px solid rgba(124, 58, 237, 0.3)',
        bgcolor: 'rgba(10, 5, 32, 0.95)',
        backdropFilter: 'blur(8px)',
      }}
    >
      <CardContent sx={{ p: { xs: 2, sm: 3 }, '&:last-child': { pb: 2 } }}>
        {/* Hidden audio element */}
        <audio ref={audioRef} preload="metadata">
          <track kind="captions" />
        </audio>

        {/* Error state */}
        {error && (
          <Alert severity="error" sx={{ mb: 2, fontSize: '0.875rem' }}>
            {error}
          </Alert>
        )}

        <Stack spacing={2}>
          {/* Song info */}
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 2,
            }}
          >
            <Box sx={{ minWidth: 0, flex: 1 }}>
              <Typography
                variant="body1"
                sx={{
                  fontWeight: 600,
                  color: 'text.primary',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {song.title}
              </Typography>
              <Typography
                variant="body2"
                sx={{
                  color: 'text.secondary',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {song.author}
              </Typography>
            </Box>

            {/* Loading indicator */}
            {(isRefreshing || playbackStatus === 'loading') && (
              <CircularProgress size={20} sx={{ color: 'primary.main' }} />
            )}
          </Box>

          {/* Controls */}
          <Stack direction="row" alignItems="center" spacing={{ xs: 1, sm: 2 }}>
            {/* Play/Pause button */}
            <Tooltip title={playbackStatus === 'playing' ? 'Pause' : 'Play'}>
              <span>
                <IconButton
                  onClick={togglePlay}
                  disabled={!url || isRefreshing}
                  aria-label={playbackStatus === 'playing' ? 'Pause' : 'Play'}
                  sx={{
                    color: 'primary.main',
                    bgcolor: 'rgba(124, 58, 237, 0.1)',
                    '&:hover': {
                      bgcolor: 'rgba(124, 58, 237, 0.2)',
                    },
                    '&:disabled': {
                      color: 'rgba(124, 58, 237, 0.3)',
                      bgcolor: 'rgba(124, 58, 237, 0.05)',
                    },
                  }}
                >
                  {playbackStatus === 'playing' ? (
                    <PauseIcon />
                  ) : (
                    <PlayArrowIcon />
                  )}
                </IconButton>
              </span>
            </Tooltip>

            {/* Stop button */}
            <Tooltip title="Stop">
              <IconButton
                onClick={handleStop}
                aria-label="Stop"
                size="small"
                sx={{
                  color: 'text.secondary',
                  '&:hover': {
                    color: 'text.primary',
                    bgcolor: 'rgba(124, 58, 237, 0.1)',
                  },
                }}
              >
                <StopIcon fontSize="small" />
              </IconButton>
            </Tooltip>

            {/* Progress slider */}
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Slider
                value={currentTime}
                max={duration || 100}
                onChange={handleSeek}
                disabled={!url}
                aria-label="Seek"
                sx={{
                  color: 'primary.main',
                  height: 4,
                  '& .MuiSlider-thumb': {
                    width: 12,
                    height: 12,
                    transition: 'all 0.2s ease',
                    '&:hover, &.Mui-focusVisible': {
                      boxShadow: '0 0 0 8px rgba(124, 58, 237, 0.16)',
                    },
                  },
                  '& .MuiSlider-rail': {
                    opacity: 0.3,
                  },
                }}
              />
            </Box>

            {/* Time display */}
            <Typography
              variant="caption"
              sx={{
                color: 'text.secondary',
                minWidth: { xs: '70px', sm: '90px' },
                textAlign: 'right',
                fontSize: { xs: '0.7rem', sm: '0.75rem' },
              }}
            >
              {formatTime(currentTime)} / {formatTime(duration)}
            </Typography>

            {/* Volume controls */}
            <Box
              sx={{
                display: { xs: 'none', sm: 'flex' },
                alignItems: 'center',
                gap: 1,
                minWidth: '120px',
              }}
            >
              <Tooltip title={isMuted ? 'Unmute' : 'Mute'}>
                <IconButton
                  onClick={toggleMute}
                  size="small"
                  aria-label={isMuted ? 'Unmute' : 'Mute'}
                  sx={{
                    color: 'text.secondary',
                    '&:hover': {
                      color: 'text.primary',
                    },
                  }}
                >
                  {isMuted ? (
                    <VolumeOffIcon fontSize="small" />
                  ) : (
                    <VolumeUpIcon fontSize="small" />
                  )}
                </IconButton>
              </Tooltip>
              <Slider
                value={isMuted ? 0 : volume}
                min={0}
                max={1}
                step={0.01}
                onChange={handleVolumeChange}
                aria-label="Volume"
                sx={{
                  color: 'primary.main',
                  flex: 1,
                  '& .MuiSlider-thumb': {
                    width: 10,
                    height: 10,
                  },
                }}
              />
            </Box>
          </Stack>
        </Stack>
      </CardContent>
    </Card>
  );
}
