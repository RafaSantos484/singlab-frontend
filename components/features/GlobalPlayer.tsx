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
// Types & Constants
// ---------------------------------------------------------------------------

type PlaybackSource = 'raw' | 'separated';
type StemKey = SeparationStemName;
type TrackId = 'raw' | StemKey;

interface Track {
  id: TrackId;
  label: string;
  src: string;
}

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
 * Format seconds into M:SS for display.
 */
function formatTime(seconds: number): string {
  if (!isFinite(seconds)) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/**
 * Extract stems that have finished processing and have a download URL,
 * preserving the canonical STEM_ORDER.
 */
function extractAvailableStems(
  separation: NormalizedSeparationInfo | null,
  stemUrls: Partial<Record<StemKey, string>>,
): StemKey[] {
  if (!separation || separation.status !== 'finished') return [];
  return STEM_ORDER.filter((stem) => Boolean(stemUrls[stem]));
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
 * Inner player component – simplified multi-track audio player.
 *
 * Design principles
 * -----------------
 * 1. **All tracks always play simultaneously.** Selecting/deselecting a stem
 *    only changes its volume (0 = muted), ensuring perfect sync without
 *    complex restart logic.
 *
 * 2. **Synchronized playback start.** `prepareAt(time, autoResume)` pauses all
 *    tracks, seeks to `time`, syncs current times, waits 50ms for readiness
 *    (mobile/cached audio), then plays all tracks in a coordinated burst.
 *    Uses play attempt tracking to cancel stale operations.
 *
 * 3. **Manual sync on source switch.** Switching between raw and separated
 *    sources explicitly syncs tracks and reapplies volume with 50ms delay
 *    for mobile readiness.
 *
 * 4. **Disabled controls during loading.** All controls are disabled during
 *    loading/buffering phase, preventing premature user interactions.
 *
 * @component
 */
function GlobalPlayerInner({
  song,
}: GlobalPlayerInnerProps): React.ReactElement {
  const dispatch = useGlobalStateDispatch();
  const { playbackStatus } = useGlobalState();

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

  const availableStems = useMemo(
    () => extractAvailableStems(separation, stemUrls),
    [separation, stemUrls],
  );

  const hasSeparatedAudio =
    separation?.status === 'finished' &&
    !areStemUrlsLoading &&
    availableStems.length > 0;

  // ── UI selection state ───────────────────────────────────────────────────

  const [playbackSource, setPlaybackSource] = useState<PlaybackSource>('raw');
  const [selectedStems, setSelectedStems] = useState<StemKey[]>([]);

  /**
   * Stems after filtering unavailable ones and falling back to
   * "instrumental" when nothing is explicitly selected.
   */
  const effectiveSelectedStems = useMemo<StemKey[]>(() => {
    const valid = selectedStems.filter((s) => availableStems.includes(s));
    if (valid.length > 0) return valid;
    if (availableStems.length > 0) {
      const withoutVocals = availableStems.filter((s) => s !== 'vocals');
      return withoutVocals.length > 0 ? withoutVocals : availableStems;
    }
    return [];
  }, [availableStems, selectedStems]);

  /**
   * Track IDs audible at any given moment.
   * Everything outside this set plays at volume 0.
   */
  const audibleTrackIds = useMemo<Set<TrackId>>(() => {
    if (playbackSource === 'raw') return new Set<TrackId>(['raw']);
    return new Set<TrackId>(effectiveSelectedStems);
  }, [effectiveSelectedStems, playbackSource]);

  // ── Unified track list ───────────────────────────────────────────────────

  /** All sources (raw + finished stems) as a flat array, raw first. */
  const tracks = useMemo<Track[]>(() => {
    const result: Track[] = [];
    if (rawUrl) result.push({ id: 'raw', label: 'Raw', src: rawUrl });
    STEM_ORDER.forEach((stem) => {
      const url = stemUrls[stem];
      if (url) result.push({ id: stem, label: STEM_LABELS[stem], src: url });
    });
    return result;
  }, [rawUrl, stemUrls]);

  /** Changes only when track identities or source URLs change. */
  const trackKey = useMemo(
    () => tracks.map((t) => `${t.id}:${t.src}`).join('|'),
    [tracks],
  );

  /** Master track drives time display and drift corrections. */
  const masterId = useMemo<TrackId | null>(() => {
    if (tracks.length === 0) return null;
    return tracks.find((t) => t.id === 'raw')?.id ?? tracks[0]?.id ?? null;
  }, [tracks]);

  // ── Audio engine state ───────────────────────────────────────────────────

  const [isPlaying, setIsPlaying] = useState(false);
  const [isBuffering, setIsBuffering] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  // ── Refs ─────────────────────────────────────────────────────────────────

  const audioMapRef = useRef<Map<TrackId, HTMLAudioElement>>(new Map());
  const playingAttemptRef = useRef(0);

  // Mirrors of state for use in stable callbacks / event handlers
  const isPlayingRef = useRef(false);
  const volumeRef = useRef(volume);
  const isMutedRef = useRef(isMuted);
  const audibleTrackIdsRef = useRef(audibleTrackIds);
  const masterIdRef = useRef(masterId);

  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);
  useEffect(() => {
    volumeRef.current = volume;
  }, [volume]);
  useEffect(() => {
    isMutedRef.current = isMuted;
  }, [isMuted]);
  useEffect(() => {
    audibleTrackIdsRef.current = audibleTrackIds;
  }, [audibleTrackIds]);
  useEffect(() => {
    masterIdRef.current = masterId;
  }, [masterId]);

  // Stable ref so audio-element event handlers always call latest prepareAt
  const prepareAtRef = useRef<
    (time: number, autoResume: boolean) => Promise<void>
  >(async () => {
    /* noop until wired */
  });

  // ── Helpers ──────────────────────────────────────────────────────────────

  /** Get the master audio element (drives time display). */
  const getMaster = useCallback((): HTMLAudioElement | null => {
    const id = masterIdRef.current;
    if (!id) return null;
    return audioMapRef.current.get(id) ?? null;
  }, []);

  /** Set volume on every track; unselected and muted tracks get 0. */
  const applyVolumes = useCallback((): void => {
    const base = isMutedRef.current ? 0 : volumeRef.current;
    audioMapRef.current.forEach((el, id) => {
      el.volume = audibleTrackIdsRef.current.has(id) ? base : 0;
    });
  }, []);

  /** Sync all non-master audio elements to master's current time. */
  const syncAudioTracks = useCallback((): void => {
    const master = getMaster();
    if (!master) return;
    const masterTime = master.currentTime;
    audioMapRef.current.forEach((a) => {
      if (a === master) return;
      if (Math.abs(a.currentTime - masterTime) > 0.05) {
        a.currentTime = masterTime;
      }
    });
  }, [getMaster]);

  /**
   * Simplified synchronisation: pause all, seek to time, then play all.
   * No complex barriers – just seek and let playback resume.
   */
  const prepareAt = useCallback(
    async (time: number, autoResume: boolean): Promise<void> => {
      const playAttempt = ++playingAttemptRef.current;

      audioMapRef.current.forEach((a) => {
        a.pause();
        try {
          const media = a as HTMLMediaElement & {
            fastSeek?: (t: number) => void;
          };
          if (typeof media.fastSeek === 'function') media.fastSeek(time);
          else a.currentTime = time;
        } catch {
          a.currentTime = time;
        }
      });

      setIsBuffering(false);

      const master = getMaster();
      if (master && isFinite(master.duration)) setDuration(master.duration);

      if (autoResume) {
        try {
          syncAudioTracks();
          // Small delay to ensure all tracks are ready, especially on mobile/cache
          await new Promise((resolve) => setTimeout(resolve, 50));

          // Check if another play attempt started while we were waiting
          if (playingAttemptRef.current !== playAttempt) return;

          const allAudios = Array.from(audioMapRef.current.values());

          // Ensure all tracks are synced before play
          syncAudioTracks();

          // Try to play all tracks
          const playResults = await Promise.allSettled(
            allAudios.map((a) =>
              a.play().catch((e) => {
                console.error('[GlobalPlayer] Play failed:', e);
                throw e;
              }),
            ),
          );

          // Check if this attempt is still valid
          if (playingAttemptRef.current !== playAttempt) return;

          const allSucceeded = playResults.every(
            (r) => r.status === 'fulfilled',
          );
          if (allSucceeded) {
            applyVolumes();
            setIsPlaying(true);
            dispatch({ type: 'PLAYER_SET_STATUS', payload: 'playing' });
          } else {
            setIsPlaying(false);
            dispatch({ type: 'PLAYER_SET_STATUS', payload: 'paused' });
          }
        } catch {
          if (playingAttemptRef.current === playAttempt) {
            setIsPlaying(false);
            dispatch({ type: 'PLAYER_SET_STATUS', payload: 'paused' });
          }
        }
      } else {
        setCurrentTime(time);
        applyVolumes();
      }
    },
    [applyVolumes, dispatch, getMaster, syncAudioTracks],
  );

  useEffect(() => {
    prepareAtRef.current = prepareAt;
  }, [prepareAt]);

  // ── Reset player when song changes ───────────────────────────────────────
  // Ensures previous song's audio doesn't interfere with new playback
  useEffect(() => {
    // Cancel any pending play attempts
    playingAttemptRef.current++;

    audioMapRef.current.forEach((a) => {
      a.pause();
      a.currentTime = 0;
      a.src = '';
    });
    audioMapRef.current.clear();
    setIsPlaying(false);
    isPlayingRef.current = false;
    setIsBuffering(false);
    setCurrentTime(0);
    setDuration(0);
    hasAutoPlayedRef.current = false;
  }, [song.id]);

  // ── Rebuild audio elements when track list changes ───────────────────────

  useEffect(() => {
    const prev = audioMapRef.current;
    prev.forEach((a) => {
      a.pause();
      a.src = '';
    });
    prev.clear();
    setIsPlaying(false);
    isPlayingRef.current = false;
    setIsBuffering(false);
    setCurrentTime(0);
    hasAutoPlayedRef.current = false;

    if (tracks.length === 0) return;

    const map = new Map<TrackId, HTMLAudioElement>();
    const masterTrackId =
      tracks.find((t) => t.id === 'raw')?.id ?? tracks[0]?.id;

    tracks.forEach((track) => {
      const el = document.createElement('audio');
      el.preload = 'auto';
      el.src = track.src;

      if (track.id === masterTrackId) {
        el.addEventListener('timeupdate', () => {
          setCurrentTime(el.currentTime);
        });
        el.addEventListener('durationchange', () => {
          if (isFinite(el.duration)) setDuration(el.duration);
        });
        el.addEventListener('loadedmetadata', () => {
          if (isFinite(el.duration)) setDuration(el.duration);
        });
        el.addEventListener('ended', () => {
          audioMapRef.current.forEach((a) => a.pause());
          setIsPlaying(false);
          isPlayingRef.current = false;
          setCurrentTime(0);
          dispatch({ type: 'PLAYER_SET_STATUS', payload: 'paused' });
        });
      }

      map.set(track.id, el);
    });

    audioMapRef.current = map;

    return () => {
      map.forEach((a) => {
        a.pause();
        a.src = '';
      });
    };
    // trackKey is a stable string – only changes when track ids/srcs change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trackKey]);

  // ── Volume side-effects ──────────────────────────────────────────────────

  useEffect(() => {
    audibleTrackIdsRef.current = audibleTrackIds;
    applyVolumes();
  }, [audibleTrackIds, applyVolumes]);

  useEffect(() => {
    isMutedRef.current = isMuted;
    applyVolumes();
  }, [isMuted, applyVolumes]);

  useEffect(() => {
    volumeRef.current = volume;
    applyVolumes();
  }, [volume, applyVolumes]);

  // ── Auto-play when raw URL first becomes available ───────────────────────

  const hasAutoPlayedRef = useRef(false);
  useEffect(() => {
    hasAutoPlayedRef.current = false;
  }, [song.id]);

  useEffect(() => {
    if (!rawUrl || hasAutoPlayedRef.current) return;
    if (audioMapRef.current.size === 0) return;
    hasAutoPlayedRef.current = true;
    void prepareAt(0, true);
  }, [rawUrl, prepareAt]);

  // ── Controls ─────────────────────────────────────────────────────────────

  const togglePlay = useCallback(async (): Promise<void> => {
    if (isBuffering) return;
    const master = getMaster();
    if (!master) return;

    if (isPlaying) {
      playingAttemptRef.current++;
      audioMapRef.current.forEach((a) => a.pause());
      setIsPlaying(false);
      dispatch({ type: 'PLAYER_SET_STATUS', payload: 'paused' });
      return;
    }

    // Use prepareAt to ensure proper sync
    await prepareAt(master.currentTime || 0, true);
  }, [dispatch, getMaster, isBuffering, isPlaying, prepareAt]);

  const handleStop = useCallback(async (): Promise<void> => {
    await prepareAt(0, false);
    dispatch({ type: 'PLAYER_STOP' });
  }, [dispatch, prepareAt]);

  const handleSeek = useCallback(
    async (_event: Event, value: number | number[]): Promise<void> => {
      const newTime = Array.isArray(value) ? value[0] : value;
      await prepareAt(newTime, isPlaying);
    },
    [isPlaying, prepareAt],
  );

  const toggleMute = useCallback((): void => {
    setIsMuted((m) => !m);
  }, []);

  const handleVolumeChange = useCallback(
    (_event: Event, value: number | number[]): void => {
      const v = Array.isArray(value) ? value[0] : value;
      setVolume(v);
      if (v > 0) setIsMuted(false);
    },
    [],
  );

  /**
   * Switch between raw and separated source.
   * Because all tracks are already playing simultaneously, this is a pure
   * volume change – sync tracks explicitly to prevent drift.
   */
  const handleSelectSource = useCallback(
    (
      _event: React.MouseEvent<HTMLElement>,
      value: PlaybackSource | null,
    ): void => {
      if (!value || value === playbackSource) return;
      setPlaybackSource(value);
      // Sync all tracks when switching sources, with a small delay for mobile
      setTimeout(() => {
        syncAudioTracks();
        applyVolumes();
      }, 50);
    },
    [applyVolumes, playbackSource, syncAudioTracks],
  );

  const toggleStem = useCallback((stem: StemKey): void => {
    setSelectedStems((prev) => {
      if (prev.includes(stem)) {
        return prev.length === 1 ? prev : prev.filter((s) => s !== stem);
      }
      return [...prev, stem];
    });
  }, []);

  const setPreset = useCallback(
    (preset: 'vocals' | 'instrumental' | 'all'): void => {
      if (preset === 'vocals') {
        setSelectedStems(
          availableStems.includes('vocals')
            ? ['vocals']
            : effectiveSelectedStems,
        );
      } else if (preset === 'instrumental') {
        const stems = availableStems.filter((s) => s !== 'vocals');
        if (stems.length > 0) setSelectedStems(stems);
      } else {
        setSelectedStems(availableStems);
      }
    },
    [availableStems, effectiveSelectedStems],
  );

  // ── Derived UI flags ─────────────────────────────────────────────────────

  const isPlayerReady = tracks.length > 0;
  const isLoading = isRawRefreshing || playbackStatus === 'loading';

  // ── Render ───────────────────────────────────────────────────────────────

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
        {rawError && (
          <Alert severity="error" sx={{ mb: 2, fontSize: '0.875rem' }}>
            {rawError}
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

            {(isLoading || isBuffering) && (
              <Tooltip
                title={
                  isBuffering
                    ? 'Buffering – waiting for all tracks…'
                    : undefined
                }
              >
                <CircularProgress size={20} sx={{ color: 'primary.main' }} />
              </Tooltip>
            )}
          </Box>

          {/* Source toggle (only when separated audio is available) */}
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
                <ToggleButton value="separated">Separated</ToggleButton>
              </ToggleButtonGroup>
            </Box>
          )}

          {/* Transport controls */}
          <Stack direction="row" alignItems="center" spacing={{ xs: 1, sm: 2 }}>
            <Tooltip
              title={isBuffering ? 'Buffering…' : isPlaying ? 'Pause' : 'Play'}
            >
              <span>
                <IconButton
                  onClick={togglePlay}
                  disabled={!isPlayerReady || isLoading || isBuffering}
                  aria-label={isPlaying ? 'Pause' : 'Play'}
                  sx={{
                    color: 'primary.main',
                    bgcolor: 'rgba(124, 58, 237, 0.1)',
                    '&:hover': { bgcolor: 'rgba(124, 58, 237, 0.2)' },
                    '&:disabled': {
                      color: 'rgba(124, 58, 237, 0.3)',
                      bgcolor: 'rgba(124, 58, 237, 0.05)',
                    },
                  }}
                >
                  {isPlaying ? <PauseIcon /> : <PlayArrowIcon />}
                </IconButton>
              </span>
            </Tooltip>

            <Tooltip title="Stop">
              <span>
                <IconButton
                  onClick={handleStop}
                  disabled={!isPlayerReady || isLoading || isBuffering}
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
              </span>
            </Tooltip>

            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Slider
                value={currentTime}
                min={0}
                max={duration || 100}
                step={0.01}
                onChange={handleSeek}
                disabled={
                  !isPlayerReady ||
                  isLoading ||
                  isBuffering ||
                  !isFinite(duration)
                }
                aria-label="Seek"
                sx={{
                  color: 'primary.main',
                  height: 4,
                  '& .MuiSlider-thumb': {
                    width: 12,
                    height: 12,
                    '&:hover, &.Mui-focusVisible': {
                      boxShadow: '0 0 0 8px rgba(124, 58, 237, 0.16)',
                    },
                  },
                  '& .MuiSlider-rail': { opacity: 0.3 },
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

            {/* Volume control – hidden on mobile */}
            <Box
              sx={{
                display: { xs: 'none', sm: 'flex' },
                alignItems: 'center',
                gap: 1,
                minWidth: '120px',
              }}
            >
              <Tooltip title={isMuted ? 'Unmute' : 'Mute'}>
                <span>
                  <IconButton
                    onClick={toggleMute}
                    disabled={isLoading}
                    size="small"
                    aria-label={isMuted ? 'Unmute' : 'Mute'}
                    sx={{
                      color: 'text.secondary',
                      '&:hover': { color: 'text.primary' },
                    }}
                  >
                    {isMuted ? (
                      <VolumeOffIcon fontSize="small" />
                    ) : (
                      <VolumeUpIcon fontSize="small" />
                    )}
                  </IconButton>
                </span>
              </Tooltip>
              <Slider
                value={isMuted ? 0 : volume}
                min={0}
                max={1}
                step={0.01}
                onChange={handleVolumeChange}
                disabled={isLoading}
                aria-label="Volume"
                sx={{
                  color: 'primary.main',
                  flex: 1,
                  '& .MuiSlider-thumb': { width: 10, height: 10 },
                }}
              />
            </Box>
          </Stack>

          {/* Stem mixer – only in separated mode */}
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
                  disabled={
                    isLoading || !availableStems.some((s) => s !== 'vocals')
                  }
                >
                  Instrumental
                </Button>
                <Button
                  size="small"
                  variant="outlined"
                  onClick={() => setPreset('vocals')}
                  disabled={isLoading || !availableStems.includes('vocals')}
                >
                  Vocals only
                </Button>
                <Button
                  size="small"
                  variant="outlined"
                  onClick={() => setPreset('all')}
                  disabled={isLoading}
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
