'use client';

import type React from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  IconButton,
  Slider,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from '@mui/material';
import GraphicEqIcon from '@mui/icons-material/GraphicEq';
import PauseIcon from '@mui/icons-material/Pause';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import StopIcon from '@mui/icons-material/Stop';
import VolumeOffIcon from '@mui/icons-material/VolumeOff';
import VolumeUpIcon from '@mui/icons-material/VolumeUp';

import { useGlobalState } from '@/lib/store';
import { useGlobalStateDispatch } from '@/lib/store/GlobalStateContext';
import { useSongRawUrl } from '@/lib/hooks/useSongRawUrl';
import type {
  NormalizedSeparationInfo,
  SeparationStemName,
  Song,
} from '@/lib/api/types';
import { normalizeSeparationInfo } from '@/lib/separations';
import { useStorageDownloadUrls } from '@/lib/hooks/useStorageDownloadUrls';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type PlaybackSource = 'raw' | 'separated';
type StemKey = SeparationStemName;

const STEM_ORDER: StemKey[] = [
  'vocals',
  'bass',
  'drums',
  'piano',
  'guitar',
  'other',
];

const STEM_LABELS: Record<StemKey, string> = {
  vocals: 'Vocals',
  bass: 'Bass',
  drums: 'Drums',
  piano: 'Piano',
  guitar: 'Guitar',
  other: 'Other',
};

/**
 * Format seconds into MM:SS format for display.
 * Handles non-finite values gracefully.
 */
function formatTime(seconds: number): string {
  if (!isFinite(seconds)) {
    return '0:00';
  }
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Extract the list of available stems from normalized separation info,
 * ordered by STEM_ORDER. Returns empty array if separation is not finished.
 */
function extractAvailableStems(
  separation: NormalizedSeparationInfo | null,
  stemUrls: Partial<Record<StemKey, string>>,
): StemKey[] {
  if (!separation || separation.status !== 'finished') return [];
  return STEM_ORDER.filter((stem) => Boolean(stemUrls[stem]));
}

/**
 * Build a default stem selection fallback when no stems are explicitly selected.
 *
 * Strategy:
 * 1. If instrumental stems are available (all except vocals), show those
 *    (sensible default for practice/karaoke)
 * 2. Otherwise, show all available stems
 *
 * This ensures the player always has something to play when separation finishes.
 */
function buildDefaultStemSelection(stems: StemKey[]): StemKey[] {
  const withoutVocals = stems.filter((stem) => stem !== 'vocals');
  if (withoutVocals.length > 0) return withoutVocals;
  return stems;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function GlobalPlayer(): React.ReactElement {
  const { currentSongId, songs } = useGlobalState();

  const currentSong = currentSongId
    ? songs.find((s) => s.id === currentSongId)
    : null;

  if (!currentSongId || !currentSong) {
    return <></>;
  }

  return <GlobalPlayerInner key={currentSong.id} song={currentSong} />;
}

interface GlobalPlayerInnerProps {
  song: Song;
}

/**
 * Inner player component that renders the actual audio player for a loaded song.
 *
 * Supports dual-mode playback:
 * - **Raw mode**: Single <audio> element for the original uploaded file
 * - **Separated mode**: Multiple <audio> elements (one per stem) with:
 *   - Manual playhead synchronization (capped to 150ms drift tolerance)
 *   - Stem selection via toggleable chips (build custom mixes)
 *   - Preset shortcuts (instruments, vocals-only, all-stems)
 *   - Per-stem volume control (selected stems play at master volume, others muted)
 *
 * State management is split between:
 * - Global state: currentSongId, playbackStatus (PLAY/PAUSE/STOP)
 * - Local state: selectedStems, playbackSource, currentTime, volume
 * - Effect hooks: wire up audio listeners, sync stems, apply volumes, auto-play
 *
 * The component handles edge cases like:
 * - Browser autoplay policy (gracefully degrades to paused)
 * - URL expiry (via useSongRawUrl hook)
 * - Stem sync drift (resyncs every timeupdate and on seek)
 * - Hydration mismatch (no initial preload attempt)
 *
 * @component
 */
function GlobalPlayerInner({
  song,
}: GlobalPlayerInnerProps): React.ReactElement {
  const { playbackStatus } = useGlobalState();
  const dispatch = useGlobalStateDispatch();

  const {
    url: rawUrl,
    isRefreshing: isRawRefreshing,
    error: rawError,
  } = useSongRawUrl(song);
  const separation = useMemo(
    () => normalizeSeparationInfo(song.separatedSongInfo),
    [song.separatedSongInfo],
  );
  const { urls: stemUrls, isLoading: areStemUrlsLoading } =
    useStorageDownloadUrls(separation?.stems?.paths ?? null);

  const [playbackSource, setPlaybackSource] = useState<PlaybackSource>('raw');
  const [selectedStems, setSelectedStems] = useState<StemKey[]>([]);
  const availableStems = useMemo(
    () => extractAvailableStems(separation, stemUrls),
    [separation, stemUrls],
  );

  const audioRef = useRef<HTMLAudioElement>(null);
  const stemAudioRefs = useRef<Partial<Record<StemKey, HTMLAudioElement>>>({});

  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const shouldAutoPlayRef = useRef<boolean>(true);

  const hasSeparatedAudio =
    separation?.status === 'finished' &&
    !areStemUrlsLoading &&
    availableStems.length > 0;

  const effectiveSelectedStems = useMemo(() => {
    const filtered = selectedStems.filter((stem) =>
      availableStems.includes(stem),
    );
    if (filtered.length > 0) return filtered;
    if (availableStems.length > 0)
      return buildDefaultStemSelection(availableStems);
    return [];
  }, [availableStems, selectedStems]);

  // Create audio elements for stems when separation data is ready
  // Each stem gets its own <audio> element; we sync their playheads manually
  useEffect(() => {
    // Cleanup previous stem audios
    const previousStems = stemAudioRefs.current;
    Object.values(previousStems).forEach((audio) => {
      if (audio) {
        audio.pause();
        audio.src = '';
        audio.load();
      }
    });

    if (!separation || separation.status !== 'finished') {
      stemAudioRefs.current = {};
      return;
    }

    const map: Partial<Record<StemKey, HTMLAudioElement>> = {};
    STEM_ORDER.forEach((stem) => {
      const src = stemUrls[stem];
      if (!src) return;
      const audio = new Audio(src);
      audio.preload = 'auto';
      map[stem] = audio;
    });
    stemAudioRefs.current = map;

    return () => {
      // Cleanup on unmount: use captured `map` instead of ref to ensure
      // cleanup accesses the correct audio elements even if ref changes
      Object.values(map).forEach((audio) => {
        if (audio) {
          audio.pause();
          audio.src = '';
          audio.load();
        }
      });
    };
  }, [separation, stemUrls]);

  const masterStemKey = effectiveSelectedStems[0] ?? availableStems[0];

  const hasActiveAudio = useMemo(() => {
    if (playbackSource === 'raw') {
      return Boolean(rawUrl);
    }
    if (playbackSource === 'separated') {
      if (!hasSeparatedAudio || !masterStemKey) return false;
      return (
        effectiveSelectedStems.length > 0 && Boolean(stemUrls[masterStemKey])
      );
    }
    return false;
  }, [
    effectiveSelectedStems,
    hasSeparatedAudio,
    masterStemKey,
    playbackSource,
    rawUrl,
    stemUrls,
  ]);

  const getActiveAudio = useCallback((): HTMLAudioElement | null => {
    if (playbackSource === 'raw') {
      return audioRef.current;
    }
    if (!masterStemKey) return null;
    return stemAudioRefs.current[masterStemKey] ?? null;
  }, [masterStemKey, playbackSource]);

  const syncAllAudio = useCallback(
    (time: number): void => {
      // Sync raw audio
      const rawAudio = audioRef.current;
      if (rawAudio && Math.abs(rawAudio.currentTime - time) > 0.15) {
        rawAudio.currentTime = time;
      }

      // Sync all stems
      STEM_ORDER.forEach((stem) => {
        const audio = stemAudioRefs.current[stem];
        if (audio && Math.abs(audio.currentTime - time) > 0.15) {
          audio.currentTime = time;
        }
      });
    },
    [],
  );

  const pauseAllAudio = useCallback((): void => {
    // Pause raw audio
    if (audioRef.current) {
      audioRef.current.pause();
    }
    // Pause all stems
    STEM_ORDER.forEach((stem) => {
      const audio = stemAudioRefs.current[stem];
      if (audio) {
        audio.pause();
      }
    });
  }, []);

  const playAllAudio = useCallback(async (): Promise<void> => {
    const allAudios: HTMLAudioElement[] = [];
    const targetTime = getActiveAudio()?.currentTime ?? 0;

    // Add raw audio if available
    if (audioRef.current && rawUrl) {
      if (Math.abs(audioRef.current.currentTime - targetTime) > 0.05) {
        audioRef.current.currentTime = targetTime;
      }
      allAudios.push(audioRef.current);
    }

    // Add all stem audios
    STEM_ORDER.forEach((stem) => {
      const audio = stemAudioRefs.current[stem];
      if (audio) {
        if (Math.abs(audio.currentTime - targetTime) > 0.05) {
          audio.currentTime = targetTime;
        }
        allAudios.push(audio);
      }
    });

    if (allAudios.length === 0) {
      throw new Error('No audio sources available');
    }

    // Filter audios based on current source - only wait for relevant ones
    const relevantAudios =
      playbackSource === 'raw'
        ? allAudios.filter((audio) => audio === audioRef.current)
        : allAudios.filter((audio) => audio !== audioRef.current);

    // If no relevant audios for separated mode, throw error
    if (relevantAudios.length === 0 && playbackSource === 'separated') {
      throw new Error('Stems not ready yet');
    }

    // Wait for relevant audios to be ready before playing
    // HAVE_FUTURE_DATA (3) = enough data to play
    await Promise.all(
      relevantAudios.map(
        (audio) =>
          new Promise<void>((resolve, reject) => {
            if (audio.readyState >= 3) {
              resolve();
              return;
            }

            // Timeout to prevent waiting indefinitely
            const timeout = setTimeout(() => {
              audio.removeEventListener('canplay', handleCanPlay);
              audio.removeEventListener('error', handleError);
              // If timeout, try to play anyway (may work or fail)
              if (audio.readyState >= 1) {
                resolve();
              } else {
                reject(new Error('Audio loading timeout'));
              }
            }, 3000);

            const handleCanPlay = (): void => {
              clearTimeout(timeout);
              audio.removeEventListener('canplay', handleCanPlay);
              audio.removeEventListener('error', handleError);
              resolve();
            };

            const handleError = (): void => {
              clearTimeout(timeout);
              audio.removeEventListener('canplay', handleCanPlay);
              audio.removeEventListener('error', handleError);
              reject(new Error('Audio loading error'));
            };

            audio.addEventListener('canplay', handleCanPlay);
            audio.addEventListener('error', handleError);

            // Trigger load if needed
            if (audio.readyState === 0) {
              audio.load();
            }
          }),
      ),
    );

    // Sync all audios one final time before playing
    allAudios.forEach((audio) => {
      if (Math.abs(audio.currentTime - targetTime) > 0.05) {
        audio.currentTime = targetTime;
      }
    });

    // Play all audio sources simultaneously
    await Promise.all(
      allAudios.map((audio) =>
        audio.play().catch(() => {
          return undefined;
        }),
      ),
    );
  }, [getActiveAudio, playbackSource, rawUrl]);

  const applyAllVolumes = useCallback(
    (nextVolume: number): void => {
      // Control raw audio volume
      if (audioRef.current) {
        const rawVolume =
          playbackSource === 'raw' && !isMuted ? nextVolume : 0;
        audioRef.current.volume = rawVolume;
      }

      // Control stem volumes
      STEM_ORDER.forEach((stem) => {
        const audio = stemAudioRefs.current[stem];
        if (!audio) return;

        let desiredVolume = 0;
        if (playbackSource === 'separated' && !isMuted) {
          desiredVolume = effectiveSelectedStems.includes(stem)
            ? nextVolume
            : 0;
        }
        audio.volume = desiredVolume;
      });
    },
    [effectiveSelectedStems, isMuted, playbackSource],
  );

  const disableAutoPlay = useCallback((): void => {
    shouldAutoPlayRef.current = false;
  }, []);

  useEffect(() => {
    // Reset auto-play allowance whenever a new song is loaded into the player.
    shouldAutoPlayRef.current = true;
  }, [song.id]);

  // Cleanup all audio when component unmounts (song change)
  // Capture refs at effect time so cleanup accesses the correct values
  // even if refs change between effect creation and cleanup execution
  useEffect(() => {
    const rawAudio = audioRef.current;
    const allStemAudios = stemAudioRefs.current;

    return () => {
      // Stop and cleanup raw audio using captured ref value
      if (rawAudio) {
        rawAudio.pause();
        rawAudio.currentTime = 0;
      }

      // Stop and cleanup all stem audios
      Object.values(allStemAudios).forEach((audio) => {
        if (audio) {
          audio.pause();
          audio.currentTime = 0;
        }
      });
    };
  }, []);

  // Toggle play/pause
  const togglePlay = useCallback(async (): Promise<void> => {
    disableAutoPlay();

    if (!hasActiveAudio) return;

    if (playbackStatus === 'playing') {
      pauseAllAudio();
      dispatch({ type: 'PLAYER_SET_STATUS', payload: 'paused' });
      return;
    }

    try {
      await playAllAudio();
      applyAllVolumes(volume);
      dispatch({ type: 'PLAYER_SET_STATUS', payload: 'playing' });
    } catch (err) {
      console.error('Failed to play audio:', err);
      dispatch({ type: 'PLAYER_SET_STATUS', payload: 'paused' });
    }
  }, [
    applyAllVolumes,
    dispatch,
    hasActiveAudio,
    pauseAllAudio,
    playAllAudio,
    playbackStatus,
    volume,
    disableAutoPlay,
  ]);

  const handleStop = useCallback((): void => {
    pauseAllAudio();

    // Reset raw audio position
    if (audioRef.current) {
      audioRef.current.currentTime = 0;
    }

    // Reset all stem positions
    STEM_ORDER.forEach((stem) => {
      const audio = stemAudioRefs.current[stem];
      if (audio) {
        audio.currentTime = 0;
      }
    });

    dispatch({ type: 'PLAYER_STOP' });
    setCurrentTime(0);
    disableAutoPlay();
  }, [disableAutoPlay, dispatch, pauseAllAudio]);

  const handleSeek = useCallback(
    (_event: Event, value: number | number[]): void => {
      const newTime = Array.isArray(value) ? value[0] : value;

      const targetAudio = getActiveAudio();

      if (targetAudio) {
        targetAudio.currentTime = newTime;
      }

      syncAllAudio(newTime);
      setCurrentTime(newTime);
    },
    [getActiveAudio, syncAllAudio],
  );

  const toggleMute = useCallback((): void => {
    if (isMuted) {
      applyAllVolumes(volume);
      setIsMuted(false);
    } else {
      applyAllVolumes(0);
      setIsMuted(true);
    }
  }, [applyAllVolumes, isMuted, volume]);

  const handleVolumeChange = useCallback(
    (_event: Event, value: number | number[]): void => {
      const newVolume = Array.isArray(value) ? value[0] : value;
      applyAllVolumes(newVolume);
      setVolume(newVolume);
      if (newVolume > 0 && isMuted) {
        setIsMuted(false);
      }
    },
    [applyAllVolumes, isMuted],
  );

  const handleSelectSource = useCallback(
    (
      _event: React.MouseEvent<HTMLElement>,
      value: PlaybackSource | null,
    ): void => {
      if (!value || value === playbackSource) return;

      const wasPlaying = playbackStatus === 'playing';

      // Switch source and adjust volumes accordingly
      setPlaybackSource(value);

      // If was playing, restart playback with new source
      if (wasPlaying) {
        // Pause everything first
        pauseAllAudio();

        // Small delay to allow source switch and state updates
        setTimeout(() => {
          void playAllAudio()
            .then(() => {
              applyAllVolumes(volume);
              dispatch({ type: 'PLAYER_SET_STATUS', payload: 'playing' });
            })
            .catch((err) => {
              console.error('Failed to resume playback after source switch:', err);
              applyAllVolumes(volume);
              dispatch({ type: 'PLAYER_SET_STATUS', payload: 'paused' });
            });
        }, 150);
      } else {
        applyAllVolumes(volume);
      }

      disableAutoPlay();
    },
    [applyAllVolumes, disableAutoPlay, dispatch, pauseAllAudio, playAllAudio, playbackSource, playbackStatus, volume],
  );

  const toggleStem = useCallback((stem: StemKey): void => {
    setSelectedStems((prev) => {
      if (prev.includes(stem)) {
        if (prev.length === 1) return prev;
        return prev.filter((s) => s !== stem);
      }
      return [...prev, stem];
    });
  }, []);

  const setPreset = useCallback(
    (preset: 'vocals' | 'instrumental' | 'all'): void => {
      if (preset === 'vocals') {
        setSelectedStems((prev) => {
          const vocals = availableStems.includes('vocals') ? ['vocals'] : prev;
          return vocals as StemKey[];
        });
        return;
      }
      if (preset === 'instrumental') {
        const stems = availableStems.filter((stem) => stem !== 'vocals');
        if (stems.length > 0) {
          setSelectedStems(stems);
        }
        return;
      }
      setSelectedStems(availableStems);
    },
    [availableStems],
  );

  // Wire audio events for active source
  useEffect(() => {
    const audio = getActiveAudio();
    if (!audio) return;

    const handlePlay = (): void => {
      dispatch({ type: 'PLAYER_SET_STATUS', payload: 'playing' });
    };

    const handlePause = (): void => {
      dispatch({ type: 'PLAYER_SET_STATUS', payload: 'paused' });
    };

    const handleTimeUpdate = (): void => {
      setCurrentTime(audio.currentTime);
      syncAllAudio(audio.currentTime);
    };

    const handleLoadedMetadata = (): void => {
      setDuration(audio.duration);
    };

    const handleEnded = (): void => {
      dispatch({ type: 'PLAYER_SET_STATUS', payload: 'paused' });
      audio.currentTime = 0;
      syncAllAudio(0);
      setCurrentTime(0);
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
  }, [dispatch, getActiveAudio, syncAllAudio]);

  // Auto-play when raw URL becomes ready for loading state
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !rawUrl || !shouldAutoPlayRef.current) return;

    audio.currentTime = 0;
    audio.src = rawUrl;

    const handleCanPlay = (): void => {
      void playAllAudio()
        .then(() => {
          applyAllVolumes(volume);
          dispatch({ type: 'PLAYER_SET_STATUS', payload: 'playing' });
        })
        .catch((err: unknown) => {
          if ((err as Error).name === 'AbortError') {
            dispatch({ type: 'PLAYER_SET_STATUS', payload: 'paused' });
            return;
          }
          console.error('Failed to auto-play:', err);
          dispatch({ type: 'PLAYER_SET_STATUS', payload: 'paused' });
        })
        .finally(() => {
          disableAutoPlay();
        });
    };

    audio.addEventListener('canplay', handleCanPlay, { once: true });

    return () => {
      audio.removeEventListener('canplay', handleCanPlay);
    };
  }, [applyAllVolumes, disableAutoPlay, dispatch, playAllAudio, rawUrl, song.id, volume]);

  // Apply volumes when selection or playback source changes
  useEffect(() => {
    applyAllVolumes(volume);
  }, [applyAllVolumes, effectiveSelectedStems, playbackSource, volume]);

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
        <audio ref={audioRef} preload="metadata">
          <track kind="captions" />
        </audio>

        {rawError && (
          <Alert severity="error" sx={{ mb: 2, fontSize: '0.875rem' }}>
            {rawError}
          </Alert>
        )}

        <Stack spacing={2}>
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

            {(isRawRefreshing || playbackStatus === 'loading') && (
              <CircularProgress size={20} sx={{ color: 'primary.main' }} />
            )}
          </Box>

          {hasSeparatedAudio && (
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 2,
              }}
            >
              <Stack direction="row" spacing={1} alignItems="center">
                <GraphicEqIcon
                  fontSize="small"
                  sx={{ color: 'primary.main' }}
                />
                <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                  Audio source
                </Typography>
              </Stack>
              <ToggleButtonGroup
                size="small"
                value={playbackSource}
                exclusive
                onChange={handleSelectSource}
              >
                <ToggleButton value="raw">Raw</ToggleButton>
                <ToggleButton value="separated" disabled={!hasSeparatedAudio}>
                  Separated
                </ToggleButton>
              </ToggleButtonGroup>
            </Box>
          )}

          <Stack direction="row" alignItems="center" spacing={{ xs: 1, sm: 2 }}>
            <Tooltip title={playbackStatus === 'playing' ? 'Pause' : 'Play'}>
              <span>
                <IconButton
                  onClick={togglePlay}
                  disabled={
                    (playbackSource === 'raw' && !rawUrl) ||
                    (playbackSource === 'separated' &&
                      effectiveSelectedStems.length === 0)
                  }
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

            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Slider
                value={currentTime}
                max={duration || 100}
                onChange={handleSeek}
                disabled={!hasActiveAudio}
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

          {playbackSource === 'separated' && availableStems.length > 0 && (
            <Stack spacing={1}>
              <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                Toggle stems to create your mix.
              </Typography>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                {availableStems.map((stem) => {
                  const selected = effectiveSelectedStems.includes(stem);
                  return (
                    <Chip
                      key={stem}
                      label={STEM_LABELS[stem]}
                      color={selected ? 'primary' : 'default'}
                      variant={selected ? 'filled' : 'outlined'}
                      onClick={() => toggleStem(stem)}
                      sx={{ textTransform: 'capitalize' }}
                    />
                  );
                })}
              </Box>
              <Stack direction="row" spacing={1}>
                <Button
                  size="small"
                  variant="outlined"
                  onClick={() => setPreset('instrumental')}
                  disabled={!availableStems.some((stem) => stem !== 'vocals')}
                >
                  Instrumental
                </Button>
                <Button
                  size="small"
                  variant="outlined"
                  onClick={() => setPreset('vocals')}
                  disabled={!availableStems.includes('vocals')}
                >
                  Vocals only
                </Button>
                <Button
                  size="small"
                  variant="outlined"
                  onClick={() => setPreset('all')}
                >
                  All stems
                </Button>
              </Stack>
            </Stack>
          )}
        </Stack>
      </CardContent>
    </Card>
  );
}
