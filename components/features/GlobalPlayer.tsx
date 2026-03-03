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
  Snackbar,
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

import { useTranslations } from 'next-intl';

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
import { SeparationDialog } from './SeparationDialog';

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
 * Inner player component – multi-track audio player with deterministic sync.
 *
 * ARCHITECTURE: Raw vs Separated Modes
 * ====================================
 *
 * This player supports two completely independent playback sources:
 *
 * 1. RAW MODE (single-track playback)
 *    - Plays the original audio file as-is
 *    - Simple, single audio element
 *    - No synchronisation complexity
 *    - Transport controls (play/pause/seek/volume) direct to this element
 *
 * 2. SEPARATED MODE (multi-track playback with stems)
 *    - Plays isolated stems: vocals, bass, drums, piano, guitar, other
 *    - One audible stem serves as the master (source of truth for playback position)
 *    - If no stem is audible, vocals is the fallback master
 *    - All other stems stay in lock-step with the master
 *    - Volume is shared across all stems; disabling a stem mutes it but keeps it playing
 *    - Transport controls affect all stems equally
 *
 * Key design principles:
 * ─────────────────────
 * 1. **Independence**: Raw and separated modes never load each other's data.
 *    Switching between them is a complete rebuild (restart from 0).
 *
 * 2. **Event-driven sync**: Synchronisation only happens on user interaction
 *    (play, pause, seek, stem toggle). Never polling or interval-based checks.
 *
 * 3. **Master-slave model (separated mode)**:
 *    - An audible stem is the master (position, duration state)
 *    - Fallback: vocals is the master if no stem is audible
 *    - All other stems are slaves (follow master position + timing)
 *    - Before any play operation, all stems sync to master's position
 *
 * 4. **Buffering handling**: When the master stalls due to network/disk lag,
 *    slaves pause to prevent drift. On master-resume, slaves re-sync and
 *    restart together.
 *    (The master is the first audible stem, or vocals if none are audible.)
 *
 * 5. **Seek operation split**:
 *    - Slider drag (handleSeekChange): Update displayed time, pause audio silently
 *    - Slider release (handleSeekCommit): Sync all tracks, then resume if needed
 *
 * 6. **URL caching**: Download URLs are cached centrally with TTL-based expiration.
 *    Switching modes reuses cached URLs (no redundant requests).
 *
 * @component
 */
function GlobalPlayerInner({
  song,
}: GlobalPlayerInnerProps): React.ReactElement {
  const t = useTranslations('Player');
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

  /**
   * Vocals MUST be present for separated mode to be usable.
   * This is a hard requirement by the specification.
   */
  const hasVocals = availableStems.includes('vocals');

  const hasSeparatedAudio =
    separation?.status === 'finished' &&
    !areStemUrlsLoading &&
    hasVocals && // Only enable separated mode if vocals is available
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

  /**
   * Active tracks for the current playback source only.
   *
   * This design ensures complete independence between raw and separated modes:
   * - raw mode    → only loads and plays the raw file, NEVER loads stems
   * - separated   → only loads and plays stems, NEVER loads the raw file
   *
   * When the user switches between modes, the audio map is completely cleared
   * and rebuilt with only the relevant source. This prevents memory waste and
   * ensures clean playback semantics.
   *
   * Note: Changing the source causes immediate rebuild (via trackKey change),
   * which disposes all old elements and creates fresh ones – equivalent to
   * a song restart from 0.
   */
  const tracks = useMemo<Track[]>(() => {
    if (playbackSource === 'raw') {
      return rawUrl ? [{ id: 'raw', label: 'Raw', src: rawUrl }] : [];
    }
    // separated: only stems that have a resolved URL
    return STEM_ORDER.flatMap((stem) => {
      const url = stemUrls[stem];
      return url
        ? [{ id: stem as TrackId, label: STEM_LABELS[stem], src: url }]
        : [];
    });
  }, [playbackSource, rawUrl, stemUrls]);

  /** Changes only when track identities or source URLs change. */
  const trackKey = useMemo(
    () => tracks.map((t) => `${t.id}:${t.src}`).join('|'),
    [tracks],
  );

  // ── Audio engine state ───────────────────────────────────────────────────

  const [isPlaying, setIsPlaying] = useState(false);
  const [isBuffering, setIsBuffering] = useState(false);
  /**
   * True while a multi-track synchronisation operation is in progress
   * (initial play, play after pause, seek). All transport controls are
   * disabled during this time to prevent conflicting user interactions.
   */
  const [isSyncing, setIsSyncing] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  /** Non-null while the seek slider is being dragged; drives the displayed time. */
  const [seekingTime, setSeekingTime] = useState<number | null>(null);

  // ── Separation dialog state ──────────────────────────────────────────────

  const [isSeparationDialogOpen, setIsSeparationDialogOpen] = useState(false);
  const [separationSuccessMessage, setSeparationSuccessMessage] = useState<
    string | null
  >(null);
  const [showSeparationSuccessSnackbar, setShowSeparationSuccessSnackbar] =
    useState(false);

  // ── Refs ─────────────────────────────────────────────────────────────────

  const audioMapRef = useRef<Map<TrackId, HTMLAudioElement>>(new Map());
  const playingAttemptRef = useRef(0);

  // Mirrors of state for use in stable callbacks / event handlers
  const isPlayingRef = useRef(false);
  const isSyncingRef = useRef(false);
  const isBufferingRef = useRef(false);
  const volumeRef = useRef(volume);
  const isMutedRef = useRef(isMuted);
  const audibleTrackIdsRef = useRef(audibleTrackIds);
  const playbackSourceRef = useRef<PlaybackSource>(playbackSource);
  /** Stable ref so event handlers always call the latest applyVolumes. */
  const applyVolumesRef = useRef<() => void>(() => {});
  /** Stable ref so audio-element event handlers always call latest getMaster. */
  const getMasterRef = useRef<() => HTMLAudioElement | null>(() => null);
  /** Stable ref so audio-element event handlers always call latest getActiveElements. */
  const getActiveElementsRef = useRef<() => HTMLAudioElement[]>(() => []);

  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);
  useEffect(() => {
    isSyncingRef.current = isSyncing;
  }, [isSyncing]);
  useEffect(() => {
    isBufferingRef.current = isBuffering;
  }, [isBuffering]);
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
    playbackSourceRef.current = playbackSource;
  }, [playbackSource]);

  // Stable ref so audio-element event handlers always call latest prepareAt
  const prepareAtRef = useRef<
    (time: number, autoResume: boolean) => Promise<void>
  >(async () => {
    /* noop until wired */
  });

  // ── Helpers ──────────────────────────────────────────────────────────────

  /**
   * Get the master audio element for synchronization.
   *
   * In raw mode: Returns the raw element (only one exists).
   * In separated mode: 
   *   - If any stem is audible (in audibleTrackIds), return the first audible one
   *   - Otherwise, fallback to vocals (mandatory)
   *
   * This ensures we sync with an element that's actually playing audibly,
   * preventing issues where the browser pauses a muted element when the tab
   * becomes hidden.
   */
  const getMaster = useCallback((): HTMLAudioElement | null => {
    const map = audioMapRef.current;
    if (playbackSourceRef.current === 'raw') {
      return map.get('raw') ?? null;
    }
    
    // In separated mode, prefer an audible stem for sync
    const audible = audibleTrackIdsRef.current;
    for (const stem of STEM_ORDER) {
      if (audible.has(stem) && map.has(stem)) {
        return map.get(stem) ?? null;
      }
    }
    
    // Fallback to vocals if no stem is audible
    return map.get('vocals') ?? null;
  }, []);

  /**
   * Return all audio elements in playback order.
   * The map exclusively holds elements for the current source.
   * - raw mode  → [rawElement]
   * - separated → stem elements in STEM_ORDER
   */
  const getActiveElements = useCallback((): HTMLAudioElement[] => {
    const map = audioMapRef.current;
    if (playbackSourceRef.current === 'raw') {
      const el = map.get('raw');
      return el ? [el] : [];
    }
    return STEM_ORDER.flatMap((stem) => {
      const el = map.get(stem);
      return el ? [el] : [];
    });
  }, []);

  /**
   * Set volume on all elements in the map.
   * The map only holds elements for the current source, so no
   * inactive-source filtering is required.
   * Stems not in `audibleTrackIds` are muted (volume 0) but keep playing
   * so they stay in sync with the master.
   */
  const applyVolumes = useCallback((): void => {
    const base = isMutedRef.current ? 0 : volumeRef.current;
    audioMapRef.current.forEach((el, id) => {
      el.volume = audibleTrackIdsRef.current.has(id) ? base : 0;
    });
  }, []);

  useEffect(() => {
    applyVolumesRef.current = applyVolumes;
  }, [applyVolumes]);
  useEffect(() => {
    getMasterRef.current = getMaster;
  }, [getMaster]);
  useEffect(() => {
    getActiveElementsRef.current = getActiveElements;
  }, [getActiveElements]);

  /**
   * Sync non-master elements within the active source to master's current time.
   *
   * In raw mode: This is a no-op since there's only the master element.
   * In separated mode: Syncs all non-master tracks to the master's position.
   * The master is chosen as the first audible stem (or vocals if none are audible).
   *
   * This is called right before play to ensure all tracks start from the same
   * exact position, preventing audible drifts or timing misaligns.
   */
  const syncAudioTracks = useCallback((): void => {
    const master = getMaster();
    if (!master) return;
    const masterTime = master.currentTime;
    getActiveElements().forEach((a) => {
      if (a === master) return;
      // Only sync if there's a meaningful drift (> 50ms)
      if (Math.abs(a.currentTime - masterTime) > 0.05) {
        a.currentTime = masterTime;
      }
    });
  }, [getActiveElements, getMaster]);

  /**
   * Waits until every audio element in `elements` has buffered enough data
   * at the current seek position (`readyState >= HAVE_FUTURE_DATA`). Resolves
   * immediately if all elements are already ready. Resolves anyway after
   * `TIMEOUT_MS` to avoid hanging indefinitely. Rejects (cancels) when a
   * newer play attempt supersedes this one.
   */
  const waitForAllTracksReady = useCallback(
    (elements: HTMLAudioElement[], playAttempt: number): Promise<void> => {
      return new Promise<void>((resolve, reject) => {
        const TIMEOUT_MS = 5_000;
        // readyState 3 = HAVE_FUTURE_DATA – enough to play at current position
        const notReady = elements.filter((el) => el.readyState < 3);

        if (notReady.length === 0) {
          resolve();
          return;
        }

        let settled = false;
        const cleanups: (() => void)[] = [];

        const settle = (fn: () => void): void => {
          if (settled) return;
          settled = true;
          clearTimeout(timeoutId);
          cleanups.forEach((c) => c());
          fn();
        };

        // After the timeout, resolve anyway and let the caller try to play
        const timeoutId = setTimeout(() => settle(() => resolve()), TIMEOUT_MS);

        let pending = notReady.length;

        notReady.forEach((el) => {
          const onCanPlay = (): void => {
            // Abort if a newer play attempt has been issued
            if (playingAttemptRef.current !== playAttempt) {
              settle(() => reject(new Error('Stale play attempt')));
              return;
            }
            pending--;
            if (pending === 0) settle(() => resolve());
          };
          el.addEventListener('canplay', onCanPlay, { once: true });
          cleanups.push(() => el.removeEventListener('canplay', onCanPlay));
        });
      });
    },
    [],
  );

  /**
   * Core synchronisation entry point.
   *
   * Ensures all active-source audio elements are in lock-step before playback:
   * 1. Increments play-attempt counter to cancel stale sync operations
   * 2. Pauses all active-source elements
   * 3. Seeks all to the same time
   * 4. If autoResume=true:
   *    - Waits for all elements to buffer at the new position
   *    - Starts all simultaneously
   *
   * Synchronization modes:
   * - raw     → Simple: only one element exists, so no sync complexity
   * - separated → Complex: all stems stay locked to vocals position
   *
   * The `isSyncing` flag blocks all UI interactions during this process to
   * prevent race conditions or conflicting user actions.
   */
  const prepareAt = useCallback(
    async (time: number, autoResume: boolean): Promise<void> => {
      const playAttempt = ++playingAttemptRef.current;

      // Disable all transport controls while synchronising
      setIsSyncing(true);

      // 1. Pause active-source tracks to prevent the audio graph from advancing.
      //    Inactive-source elements remain paused (enforced by applyVolumes).
      const activeAudios = getActiveElements();
      activeAudios.forEach((a) => a.pause());

      // 2. Seek active-source tracks to exactly `time`.
      //    We intentionally avoid fastSeek() here: it snaps each track to its
      //    nearest keyframe, which differs per track and would leave them at
      //    different actual positions.  Direct currentTime assignment is
      //    synchronous and deterministic.
      activeAudios.forEach((a) => {
        try {
          a.currentTime = time;
        } catch {
          // Safari may throw on out-of-range seeks – ignore, currentTime
          // will clamp to a valid value automatically.
        }
      });

      const master = getMaster();
      if (master && isFinite(master.duration)) setDuration(master.duration);

      if (!autoResume) {
        setCurrentTime(time);
        applyVolumes();
        setIsSyncing(false);
        return;
      }

      try {
        const allAudios = activeAudios;

        // 3. Hard-sync non-master active tracks to master's settled currentTime BEFORE
        //    waiting for buffering. This corrects any sub-frame discrepancy that
        //    can occur when browsers clamp a seek to the nearest decodable frame.
        //
        //    In raw mode: This is a no-op (only master exists).
        //    In separated: This syncs all non-master stems to the master's position.
        //    (Master is the first audible stem, or vocals if none are audible.)
        syncAudioTracks();

        // 4. Wait until every track has buffered enough data at the seek position.
        //    This must come AFTER syncAudioTracks so all tracks are at the same
        //    position when we start listening for canplay events.
        await waitForAllTracksReady(allAudios, playAttempt);

        // Cancel if a newer operation superseded this one while we were waiting
        if (playingAttemptRef.current !== playAttempt) return;

        // 5. Start all tracks simultaneously
        const playResults = await Promise.allSettled(
          allAudios.map((a) =>
            a.play().catch((e: unknown) => {
              console.error('[GlobalPlayer] Play failed:', e);
              throw e;
            }),
          ),
        );

        if (playingAttemptRef.current !== playAttempt) return;

        const allSucceeded = playResults.every((r) => r.status === 'fulfilled');
        if (allSucceeded) {
          applyVolumes();
          setIsPlaying(true);
          setIsBuffering(false);
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
      } finally {
        // Always re-enable controls once this attempt settles
        if (playingAttemptRef.current === playAttempt) {
          setIsSyncing(false);
        }
      }
    },
    [
      applyVolumes,
      dispatch,
      getActiveElements,
      getMaster,
      syncAudioTracks,
      waitForAllTracksReady,
    ],
  );

  useEffect(() => {
    prepareAtRef.current = prepareAt;
  }, [prepareAt]);

  // ── Reset player when song changes ───────────────────────────────────────
  // Ensures previous song's audio doesn't interfere with new playback.
  // The trackKey-driven rebuild effect will rebuild and auto-play once
  // the new song's URL(s) resolve.
  useEffect(() => {
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
    isBufferingRef.current = false;
    setIsSyncing(false);
    setSeekingTime(null);
    setCurrentTime(0);
    setDuration(0);
    // Reset to raw source on song change so the player always starts clean
    setPlaybackSource('raw');
    playbackSourceRef.current = 'raw';
  }, [song.id]);

  // ── Rebuild audio elements when track list changes ───────────────────────

  useEffect(() => {
    // Dispose all previous elements regardless of source
    const prev = audioMapRef.current;
    prev.forEach((a) => {
      a.pause();
      a.src = '';
    });
    prev.clear();
    setIsPlaying(false);
    isPlayingRef.current = false;
    setIsBuffering(false);
    isBufferingRef.current = false;
    setIsSyncing(false);
    setSeekingTime(null);
    setCurrentTime(0);
    setDuration(0);

    if (tracks.length === 0) return;

    const map = new Map<TrackId, HTMLAudioElement>();

    tracks.forEach((track) => {
      const el = document.createElement('audio');
      el.preload = 'auto';
      el.src = track.src;

      // Time + duration: only update state when this element is the current mode's master.
      el.addEventListener('timeupdate', () => {
        if (getMasterRef.current() === el) setCurrentTime(el.currentTime);
      });
      el.addEventListener('durationchange', () => {
        if (getMasterRef.current() === el && isFinite(el.duration))
          setDuration(el.duration);
      });
      el.addEventListener('loadedmetadata', () => {
        if (getMasterRef.current() === el && isFinite(el.duration))
          setDuration(el.duration);
      });

      // Ended: trigger end-of-song only when this is the current mode's master.
      // Raw and separated sources are independent; only the active source's
      // master governs when playback stops.
      //
      // When a song ends:
      // - All tracks are paused
      // - All tracks are reset to position 0 (beginning)
      // - UI state is updated (stopped, not playing)
      // - User can click play again to restart from the beginning
      el.addEventListener('ended', () => {
        if (getMasterRef.current() !== el) return;
        audioMapRef.current.forEach((a) => {
          a.pause();
          a.currentTime = 0;
        });
        setIsPlaying(false);
        isPlayingRef.current = false;
        setCurrentTime(0);
        dispatch({ type: 'PLAYER_SET_STATUS', payload: 'paused' });
      });

      // ── Buffering / stall sync ──────────────────────────────────────────
      // Prevent drift when playback stalls (network lag, slow disk, etc.)
      //
      // When the master track waits for data:
      //  1. Pause non-master tracks to prevent them from getting ahead
      //  2. When master resumes, re-sync position and restart all
      //
      // In raw mode: This is a no-op (only master exists).
      // In separated: This keeps non-master stems in lock-step with the master
      // (which is an audible stem, or vocals if none are audible).

      const pauseNonMaster = (): void => {
        if (getMasterRef.current() !== el) return;
        if (!isPlayingRef.current) return;
        setIsBuffering(true);
        isBufferingRef.current = true;
        const activeEls = getActiveElementsRef.current();
        activeEls.forEach((a) => {
          if (a !== el) a.pause();
        });
      };

      el.addEventListener('waiting', pauseNonMaster);
      el.addEventListener('stalled', pauseNonMaster);

      el.addEventListener('playing', () => {
        if (getMasterRef.current() !== el) return;
        // Only act if recovering from a buffering stall
        if (!isBufferingRef.current) return;
        isBufferingRef.current = false;
        setIsBuffering(false);

        // Sync and restart non-master elements of the same active source.
        // In raw mode: This is a no-op (only master exists).
        // In separated: This re-syncs all stems to master position and restarts.
        const activeEls = getActiveElementsRef.current();
        const nonMasterEls = activeEls.filter((a) => a !== el);
        nonMasterEls.forEach((a) => {
          a.currentTime = el.currentTime;
        });
        void Promise.all(
          nonMasterEls.map((a) => a.play().catch(() => {})),
        ).then(() => {
          applyVolumesRef.current();
        });
      });

      map.set(track.id, el);
    });

    audioMapRef.current = map;

    // Auto-play from 0 whenever the active track set is (re)built.
    // This covers: initial song load, raw URL becoming available,
    // and source switches (raw ↔ separated).
    void prepareAtRef.current(0, true);

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

  // Reset player when playback status becomes 'loading'
  // This handles replaying the same song (same song.id but clicked again)
  useEffect(() => {
    if (playbackStatus === 'loading') {
      // Cancel any pending play attempts
      playingAttemptRef.current++;

      // Stop and reset all audio elements
      audioMapRef.current.forEach((a) => {
        a.pause();
        a.currentTime = 0;
      });

      // Reset state
      setIsPlaying(false);
      isPlayingRef.current = false;
      setIsBuffering(false);
      isBufferingRef.current = false;
      setIsSyncing(false);
      setSeekingTime(null);
      setCurrentTime(0);

      // If audio elements already exist, start playback immediately.
      // (trackKey won't change if the URL is the same, so the rebuild
      //  effect won't fire again — we trigger prepareAt directly here.)
      if (audioMapRef.current.size > 0) {
        void prepareAt(0, true);
      }
    }
  }, [playbackStatus, prepareAt]);

  // Sync UI time when tab becomes visible again
  // Browsers throttle timeupdate events while the tab is hidden, so the UI
  // can fall out of sync. This effect re-syncs currentTime when the user
  // comes back to the tab, and also re-syncs all audio elements to ensure
  // they stay in lock-step (especially important in separated mode).
  //
  // Note: When a stem (especially vocals) is muted (volume=0), browsers may
  // pause or freeze playback when the tab becomes hidden. When the tab returns,
  // we must explicitly resume playback to prevent time from becoming stale.
  useEffect(() => {
    const handleVisibilityChange = (): void => {
      if (document.hidden) return; // Tab is hidden, do nothing
      
      // Tab is now visible – sync currentTime and all audio elements
      const master = getMasterRef.current();
      if (!master || !isFinite(master.currentTime)) return;

      // Update state with current master position
      setCurrentTime(master.currentTime);

      // In separated mode, hard-sync all non-master elements to master position
      // This prevents drift that can accumulate while the tab is hidden
      const activeElements = getActiveElementsRef.current();
      activeElements.forEach((el) => {
        if (el === master) return;
        if (Math.abs(el.currentTime - master.currentTime) > 0.05) {
          el.currentTime = master.currentTime;
        }
      });

      // If music should be playing, ensure master (and all other elements) are
      // actively playing. Browsers may pause muted elements when the tab is hidden,
      // so we must resume playback explicitly even if the element thinks it's playing.
      if (isPlayingRef.current) {
        void Promise.all(
          activeElements.map((el) =>
            el.play().catch((e: unknown) => {
              console.warn('[GlobalPlayer] Resume failed after tab visibility:', e);
            }),
          ),
        ).then(() => {
          applyVolumesRef.current();
        });
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []); // No dependencies – register once, always use latest refs

  // ── Controls ─────────────────────────────────────────────────────────────

  const togglePlay = useCallback(async (): Promise<void> => {
    // Block interaction while a sync operation is already in progress
    if (isBuffering || isSyncing) return;
    const master = getMaster();
    if (!master) return;

    if (isPlaying) {
      // Pause: cancel any in-flight sync and stop active-source tracks
      playingAttemptRef.current++;
      getActiveElements().forEach((a) => a.pause());
      setIsPlaying(false);
      setIsSyncing(false);
      dispatch({ type: 'PLAYER_SET_STATUS', payload: 'paused' });
      return;
    }

    // Resume from pause: re-sync all tracks then play simultaneously
    await prepareAt(master.currentTime || 0, true);
  }, [
    dispatch,
    getActiveElements,
    getMaster,
    isBuffering,
    isSyncing,
    isPlaying,
    prepareAt,
  ]);

  const handleStop = useCallback(async (): Promise<void> => {
    await prepareAt(0, false);
    dispatch({ type: 'PLAYER_STOP' });
  }, [dispatch, prepareAt]);

  /**
   * While the slider is being dragged: update the displayed time only.
   * Audio tracks are silently paused to avoid seek-noise; no actual seek
   * happens until the user releases the slider (see `handleSeekCommit`).
   */
  const handleSeekChange = useCallback(
    (_event: Event, value: number | number[]): void => {
      const newTime = Array.isArray(value) ? value[0] : value;
      setSeekingTime(newTime);
      // Silently pause active-source tracks while scrubbing; isPlaying state
      // stays true so we know to resume on commit.
      if (isPlayingRef.current) {
        getActiveElements().forEach((a) => a.pause());
      }
    },
    [getActiveElements],
  );

  /**
   * When the slider is released: seek all tracks to the committed time,
   * wait for them to be ready, then resume if the player was playing.
   */
  const handleSeekCommit = useCallback(
    async (
      _event: React.SyntheticEvent | Event,
      value: number | number[],
    ): Promise<void> => {
      const newTime = Array.isArray(value) ? value[0] : value;
      setSeekingTime(null);
      // isPlayingRef.current reflects the logical playing state even while
      // audio was silently paused during the scrub.
      await prepareAt(newTime, isPlayingRef.current);
    },
    [prepareAt],
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
   * Handle successful separation submission.
   * Shows a provider-specific success message.
   */
  const handleSeparationSuccess = useCallback(
    (provider: 'poyo' | 'local'): void => {
      const message =
        provider === 'poyo'
          ? t('SeparationDialog.success.poyo')
          : t('SeparationDialog.success.local');
      setSeparationSuccessMessage(message);
      setShowSeparationSuccessSnackbar(true);
    },
    [t],
  );

  /**
   * Switch between raw and separated source.
   *
   * Raw and separated modes are completely independent:
   * - The source is never pre-loaded (no memory waste)
   * - Switching rebuilds the audio map entirely (old elements disposed)
   * - The rebuild effect auto-plays from 0 on the new source
   *
   * User experience: Clicking the toggle plays the song from the beginning
   * in the new mode, with no extra loading time (URLs are cached).
   *
   * Implementation flow:
   * 1. Cancel any in-flight sync operations
   * 2. Pause current audio elements
   * 3. Update playbackSource state
   * 4. trackKey changes → rebuild effect fires
   * 5. Rebuild disposes old elements, creates new ones
   * 6. Auto-play from 0
   */
  const handleSelectSource = useCallback(
    (
      _event: React.MouseEvent<HTMLElement>,
      value: PlaybackSource | null,
    ): void => {
      if (!value || value === playbackSource) return;

      // Cancel any in-flight sync before the map is rebuilt
      playingAttemptRef.current++;

      // Pause everything in the current source and update the source ref
      // immediately so helpers reflect the new source before React re-renders.
      getActiveElements().forEach((a) => a.pause());
      playbackSourceRef.current = value;

      setPlaybackSource(value);
      // `tracks` (and therefore `trackKey`) will change on the next render,
      // triggering the rebuild useEffect which clears old elements, builds
      // new ones, and auto-plays from 0.
    },
    [getActiveElements, playbackSource],
  );

  const toggleStem = useCallback(async (stem: StemKey): Promise<void> => {
    // Ignore if currently syncing (UI should be disabled anyway)
    if (isSyncingRef.current) return;

    setSelectedStems((prev) => {
      if (prev.includes(stem)) {
        return prev.length === 1 ? prev : prev.filter((s) => s !== stem);
      }
      return [...prev, stem];
    });

    // After toggling a stem, if music is playing, re-sync all tracks.
    // This prevents drift since a stem's latency may differ when muted vs unmuted.
    if (isPlayingRef.current && playbackSourceRef.current === 'separated') {
      const master = getMasterRef.current();
      if (master && isFinite(master.currentTime)) {
        // Re-sync all tracks to master's current position, then resume
        await prepareAtRef.current(master.currentTime, true);
      }
    }
  }, []);

  const setPreset = useCallback(
    async (preset: 'vocals' | 'instrumental' | 'all'): Promise<void> => {
      // Ignore if currently syncing (UI should be disabled anyway)
      if (isSyncingRef.current) return;

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

      // After changing the preset, if music is playing, re-sync all tracks.
      // This prevents drift when the stem mix changes.
      if (isPlayingRef.current && playbackSourceRef.current === 'separated') {
        const master = getMasterRef.current();
        if (master && isFinite(master.currentTime)) {
          // Re-sync all tracks to master's current position, then resume
          await prepareAtRef.current(master.currentTime, true);
        }
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

            {(isLoading || isBuffering || isSyncing) && (
              <Tooltip
                title={
                  isSyncing
                    ? t('syncingTooltip')
                    : isBuffering
                      ? t('bufferingTooltip')
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
                  {t('audioSource')}
                </Typography>
              </Stack>
              <ToggleButtonGroup
                size="small"
                value={playbackSource}
                exclusive
                onChange={handleSelectSource}
                disabled={isSyncing}
              >
                <ToggleButton value="raw">{t('rawLabel')}</ToggleButton>
                <ToggleButton value="separated">
                  {t('separatedLabel')}
                </ToggleButton>
              </ToggleButtonGroup>
            </Box>
          )}

          {/* Transport controls */}
          <Stack direction="row" alignItems="center" spacing={{ xs: 1, sm: 2 }}>
            <Tooltip
              title={
                isSyncing
                  ? t('playTooltipSyncing')
                  : isBuffering
                    ? t('playTooltipBuffering')
                    : isPlaying
                      ? t('playTooltipPause')
                      : t('playTooltipPlay')
              }
            >
              <span>
                <IconButton
                  onClick={togglePlay}
                  disabled={
                    !isPlayerReady || isLoading || isBuffering || isSyncing
                  }
                  aria-label={
                    isPlaying ? t('pauseAriaLabel') : t('playAriaLabel')
                  }
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

            <Tooltip title={t('stopTooltip')}>
              <span>
                <IconButton
                  onClick={handleStop}
                  disabled={
                    !isPlayerReady || isLoading || isBuffering || isSyncing
                  }
                  aria-label={t('stopAriaLabel')}
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
                value={seekingTime ?? currentTime}
                min={0}
                max={duration || 100}
                step={0.01}
                onChange={handleSeekChange}
                onChangeCommitted={handleSeekCommit}
                disabled={
                  !isPlayerReady ||
                  isLoading ||
                  isBuffering ||
                  isSyncing ||
                  !isFinite(duration)
                }
                aria-label={t('seekAriaLabel')}
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
              {formatTime(seekingTime ?? currentTime)} / {formatTime(duration)}
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
              <Tooltip title={isMuted ? t('unmuteTooltip') : t('muteTooltip')}>
                <span>
                  <IconButton
                    onClick={toggleMute}
                    disabled={isLoading}
                    size="small"
                    aria-label={
                      isMuted ? t('unmuteAriaLabel') : t('muteAriaLabel')
                    }
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
                aria-label={t('volumeAriaLabel')}
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
                {t('toggleStemsLabel')}
              </Typography>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                {availableStems.map((stem) => {
                  const selected = effectiveSelectedStems.includes(stem);
                  return (
                    <Chip
                      key={stem}
                      label={t(('stems.' + stem) as Parameters<typeof t>[0])}
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
                    isLoading ||
                    isSyncing ||
                    !availableStems.some((s) => s !== 'vocals')
                  }
                >
                  {t('presets.instrumental')}
                </Button>
                <Button
                  size="small"
                  variant="outlined"
                  onClick={() => setPreset('vocals')}
                  disabled={
                    isLoading || isSyncing || !availableStems.includes('vocals')
                  }
                >
                  {t('presets.vocalsOnly')}
                </Button>
                <Button
                  size="small"
                  variant="outlined"
                  onClick={() => setPreset('all')}
                  disabled={isLoading || isSyncing}
                >
                  {t('presets.allStems')}
                </Button>
              </Stack>
            </Stack>
          )}

          {/* Separation section */}
          <Box
            sx={{
              pt: 2,
              borderTop: '1px solid rgba(168, 85, 247, 0.2)',
            }}
          >
            {!hasSeparatedAudio && (
              <Button
                variant="outlined"
                onClick={() => setIsSeparationDialogOpen(true)}
                fullWidth
                disabled={!isPlayerReady || isLoading}
              >
                {t('Separation.startButton')}
              </Button>
            )}
            {hasSeparatedAudio && separation && (
              <Stack spacing={1}>
                <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                  {(() => {
                    if (separation.status === 'finished') {
                      return t('Separation.stemsReady');
                    }
                    if (separation.status === 'processing') {
                      return `${t('Separation.processing')} (${separation.provider})`;
                    }
                    return `${t('Separation.failed', { errorMessage: separation.errorMessage || 'Unknown error' })}`;
                  })()}
                </Typography>
                {separation.status !== 'finished' && (
                  <Box
                    sx={{
                      display: 'flex',
                      gap: 1,
                    }}
                  >
                    <CircularProgress size={16} />
                    <Typography
                      variant="caption"
                      sx={{ color: 'text.secondary' }}
                    >
                      {t('Separation.provider')} {separation.provider}
                    </Typography>
                  </Box>
                )}
              </Stack>
            )}
          </Box>
        </Stack>
      </CardContent>

      {/* Separation Dialog */}
      <SeparationDialog
        open={isSeparationDialogOpen}
        onClose={() => setIsSeparationDialogOpen(false)}
        onSuccess={handleSeparationSuccess}
        song={song}
      />

      {/* Separation Success Snackbar */}
      <Snackbar
        open={showSeparationSuccessSnackbar}
        autoHideDuration={6000}
        onClose={() => setShowSeparationSuccessSnackbar(false)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
      >
        <Alert
          severity="success"
          onClose={() => setShowSeparationSuccessSnackbar(false)}
        >
          {separationSuccessMessage}
        </Alert>
      </Snackbar>
    </Card>
  );
}
