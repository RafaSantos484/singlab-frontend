'use client';

import { useState, useRef, useCallback, useId } from 'react';
import {
  Box,
  IconButton,
  Slider,
  Stack,
  Typography,
  Tooltip,
} from '@mui/material';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import PauseIcon from '@mui/icons-material/Pause';
import VolumeUpIcon from '@mui/icons-material/VolumeUp';
import VolumeOffIcon from '@mui/icons-material/VolumeOff';
import { useAudioState } from '@/lib/hooks/useAudioState';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface CustomAudioPlayerProps {
  /** Audio source URL */
  src: string;
  /** Accessible label for the player */
  ariaLabel?: string;
}

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
 * Custom audio player component with MUI styling.
 *
 * Features:
 * - Play/Pause control (responds to button clicks and external controls)
 * - Progress bar with seek functionality
 * - Current/total time display
 * - Volume/mute control
 * - Responsive design
 * - Theme-consistent styling
 * - Full accessibility support (aria-pressed, aria-label, keyboard)
 *
 * State Synchronization:
 * Uses useAudioState hook to synchronize the Play/Pause icon with the actual
 * audio element state. This ensures the UI reflects true playback state, even
 * when playback is controlled externally (e.g., media keys, system buttons).
 */
export function CustomAudioPlayer({
  src,
  ariaLabel = 'Audio player',
}: CustomAudioPlayerProps): React.ReactElement {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [audioElement, setAudioElement] = useState<HTMLAudioElement | null>(
    null,
  );

  // Generate unique player ID using React's useId hook
  const playerId = `player-${useId()}`;

  // Callback ref to detect when audio element mounts.
  // Instead of just assigning audioRef.current, we also set state so the hook
  // can detect the element and attach event listeners. This ensures useAudioState
  // receives the audio element after first render.
  const setAudioRef = useCallback((element: HTMLAudioElement | null): void => {
    audioRef.current = element;
    // Update state to trigger hook with actual element
    // Only update if element actually changed to avoid unnecessary re-renders
    setAudioElement(element);
  }, []);

  // Use the audio state hook that syncs with HTMLAudioElement events
  const { isPlaying, currentTime, duration, isLoading } = useAudioState({
    playerId,
    audioElement,
  });

  // Local state for volume (not managed by useAudioState)
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);

  // Toggle play/pause by calling audio.play() or audio.pause().
  // Important: This handler doesn't update isPlaying directly.
  // The actual state update happens via audio events (play/playing/pause).
  // This ensures state updates even when external controls are used (media keys, etc).
  const togglePlay = useCallback(async (): Promise<void> => {
    const audio = audioRef.current;
    if (!audio) return;

    if (audio.paused) {
      try {
        await audio.play();
        // State will update via 'play' and 'playing' events
      } catch (error) {
        console.error('Failed to play audio:', error);
      }
    } else {
      audio.pause();
      // State will update via 'pause' event
    }
  }, []);

  // Handle progress bar seek
  const handleSeek = useCallback(
    (_event: Event, value: number | number[]): void => {
      const audio = audioRef.current;
      if (!audio) return;

      const newTime = Array.isArray(value) ? value[0] : value;
      audio.currentTime = newTime;
      // The timeupdate event will sync the state automatically
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

  return (
    <Box
      sx={{
        width: '100%',
        px: { xs: 1, sm: 2 },
        py: { xs: 1.5, sm: 2 },
        bgcolor: 'rgba(19, 10, 53, 0.5)',
        borderRadius: 2,
        border: '1px solid rgba(124, 58, 237, 0.2)',
        transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
        '&:hover': {
          bgcolor: 'rgba(19, 10, 53, 0.7)',
          borderColor: 'rgba(124, 58, 237, 0.3)',
        },
      }}
      role="region"
      aria-label={ariaLabel}
    >
      {/* Hidden audio element */}
      <audio ref={setAudioRef} src={src} preload="metadata">
        <track kind="captions" />
      </audio>

      <Stack spacing={{ xs: 1.5, sm: 2 }}>
        {/* Controls row */}
        <Stack direction="row" alignItems="center" spacing={{ xs: 1, sm: 1.5 }}>
          {/* Play/Pause button
              State is synchronized with audio events (play, playing, pause, ended).
              External controls (media keys, system buttons) are reflected in real-time. */}
          <Tooltip title={isPlaying ? 'Pause' : 'Play'} arrow>
            <span>
              <IconButton
                onClick={togglePlay}
                disabled={isLoading}
                aria-label={isPlaying ? 'Pause' : 'Play'}
                aria-pressed={isPlaying}
                sx={{
                  color: 'primary.main',
                  bgcolor: 'rgba(124, 58, 237, 0.1)',
                  width: { xs: 36, sm: 40 },
                  height: { xs: 36, sm: 40 },
                  transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
                  '&:hover': {
                    bgcolor: 'rgba(124, 58, 237, 0.2)',
                    transform: 'scale(1.05)',
                  },
                  '&:active': {
                    transform: 'scale(0.95)',
                  },
                  '&.Mui-disabled': {
                    color: 'text.disabled',
                    bgcolor: 'rgba(124, 58, 237, 0.05)',
                  },
                }}
              >
                {isPlaying ? (
                  <PauseIcon
                    sx={{ fontSize: { xs: '1.25rem', sm: '1.5rem' } }}
                  />
                ) : (
                  <PlayArrowIcon
                    sx={{ fontSize: { xs: '1.25rem', sm: '1.5rem' } }}
                  />
                )}
              </IconButton>
            </span>
          </Tooltip>

          {/* Progress section */}
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Stack spacing={0.5}>
              {/* Progress bar */}
              <Slider
                value={currentTime}
                max={duration || 100}
                onChange={handleSeek}
                disabled={isLoading}
                aria-label="Audio progress"
                sx={{
                  py: 0.5,
                  color: 'primary.main',
                  height: 4,
                  '& .MuiSlider-thumb': {
                    width: 12,
                    height: 12,
                    transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
                    '&:hover, &.Mui-focusVisible': {
                      boxShadow: '0 0 0 8px rgba(124, 58, 237, 0.16)',
                    },
                    '&.Mui-active': {
                      width: 16,
                      height: 16,
                    },
                  },
                  '& .MuiSlider-track': {
                    border: 'none',
                    background:
                      'linear-gradient(90deg, #7c3aed 0%, #a855f7 100%)',
                  },
                  '& .MuiSlider-rail': {
                    opacity: 0.3,
                    bgcolor: 'rgba(237, 237, 237, 0.2)',
                  },
                }}
              />
              {/* Time display */}
              <Stack
                direction="row"
                justifyContent="space-between"
                sx={{ px: 0.5 }}
              >
                <Typography
                  variant="body2"
                  sx={{
                    fontSize: { xs: '0.6875rem', sm: '0.75rem' },
                    color: 'text.secondary',
                    fontVariantNumeric: 'tabular-nums',
                    minWidth: { xs: '32px', sm: '36px' },
                  }}
                >
                  {formatTime(currentTime)}
                </Typography>
                <Typography
                  variant="body2"
                  sx={{
                    fontSize: { xs: '0.6875rem', sm: '0.75rem' },
                    color: 'text.disabled',
                    fontVariantNumeric: 'tabular-nums',
                    minWidth: { xs: '32px', sm: '36px' },
                    textAlign: 'right',
                  }}
                >
                  {formatTime(duration)}
                </Typography>
              </Stack>
            </Stack>
          </Box>

          {/* Volume control */}
          <Box
            sx={{
              display: { xs: 'none', sm: 'flex' },
              alignItems: 'center',
              gap: 1,
              minWidth: 120,
            }}
          >
            <Tooltip title={isMuted ? 'Unmute' : 'Mute'} arrow>
              <IconButton
                onClick={toggleMute}
                size="small"
                aria-label={isMuted ? 'Unmute' : 'Mute'}
                sx={{
                  color: isMuted ? 'text.disabled' : 'text.secondary',
                  transition: 'color 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
                  '&:hover': {
                    color: 'primary.main',
                  },
                }}
              >
                {isMuted ? (
                  <VolumeOffIcon sx={{ fontSize: '1.125rem' }} />
                ) : (
                  <VolumeUpIcon sx={{ fontSize: '1.125rem' }} />
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
                flex: 1,
                color: 'text.secondary',
                height: 3,
                '& .MuiSlider-thumb': {
                  width: 10,
                  height: 10,
                  transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
                  '&:hover, &.Mui-focusVisible': {
                    boxShadow: '0 0 0 6px rgba(237, 237, 237, 0.12)',
                  },
                },
                '& .MuiSlider-track': {
                  border: 'none',
                },
                '& .MuiSlider-rail': {
                  opacity: 0.2,
                },
              }}
            />
          </Box>
        </Stack>
      </Stack>
    </Box>
  );
}
