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
 * Design principles
 * -----------------
 * 1. **All tracks always play simultaneously.** Selecting/deselecting a stem
 *    only changes its volume (0 = muted), so every track stays in lock-step
 *    without needing complex restart logic.
 *
 * 2. **Event-driven sync via `prepareAt`.** Every play operation (initial
 *    play, resume after pause, seek) goes through `prepareAt(time, resume)`:
 *    - Pauses all tracks.
 *    - Seeks every track to `time`.
 *    - Waits for all tracks to report `readyState >= HAVE_FUTURE_DATA` via
 *      `waitForAllTracksReady` (5 s timeout safety net).
 *    - Plays all tracks simultaneously in a single coordinated burst.
 *    - Uses a play-attempt counter to cancel stale in-flight operations.
 *
 * 3. **`isSyncing` disables the UI.** While `prepareAt` is executing,
 *    `isSyncing === true` and every transport control (play, stop, seek
 *    slider, source toggle, stem presets) is disabled, preventing races.
 *
 * 4. **Seek-scrub split.** The seek slider fires two callbacks:
 *    `handleSeekChange` (drag) – updates the displayed time and silently
 *    pauses audio; `handleSeekCommit` (release) – runs `prepareAt` so all
 *    tracks are re-synced to the committed position before resuming.
 *
 * 5. **Buffering stall recovery.** `waiting` / `stalled` events on the
 *    master track pause all non-master tracks (preventing drift). When the
 *    master fires `playing` after a stall, non-master tracks are re-synced
 *    and restarted automatically.
 *
 * 6. **Source switching (raw ↔ separated).** The `tracks` memo is
 *    source-dependent: raw mode builds only the raw element; separated mode
 *    builds only stem elements. Switching source changes `playbackSource`
 *    state, which changes `tracks` → `trackKey`, which triggers the rebuild
 *    `useEffect`. The rebuild disposes old elements, creates fresh ones for
 *    the new source, and auto-plays from 0 – equivalent to a song restart.
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

  /**
   * Active tracks for the current playback source only.
   * - raw mode  → only the raw file.
   * - separated → only finished stems (raw element is NOT created).
   * Changing source disposes all existing elements and builds fresh ones,
   * which acts as an automatic restart from 0.
   */
  const tracks = useMemo<Track[]>(() => {
    if (playbackSource === 'raw') {
      return rawUrl ? [{ id: 'raw', label: 'Raw', src: rawUrl }] : [];
    }
    // separated: only stems that have a resolved URL
    return STEM_ORDER.flatMap((stem) => {
      const url = stemUrls[stem];
      return url ? [{ id: stem as TrackId, label: STEM_LABELS[stem], src: url }] : [];
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
  const applyVolumesRef = useRef<() => void>(() => { });
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
   * Get the master audio element.
   * The map only contains elements for the current source, so:
   * - raw mode  → the raw element.
   * - separated → the first stem element (by STEM_ORDER).
   */
  const getMaster = useCallback((): HTMLAudioElement | null => {
    const map = audioMapRef.current;
    if (playbackSourceRef.current === 'raw') {
      return map.get('raw') ?? null;
    }
    for (const stem of STEM_ORDER) {
      const el = map.get(stem);
      if (el) return el;
    }
    return null;
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

  /** Sync non-master elements within the active source to master's current time. */
  const syncAudioTracks = useCallback((): void => {
    const master = getMaster();
    if (!master) return;
    const masterTime = master.currentTime;
    getActiveElements().forEach((a) => {
      if (a === master) return;
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
        const timeoutId = setTimeout(
          () => settle(() => resolve()),
          TIMEOUT_MS,
        );

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
   * 1. Increments the play-attempt counter (cancels any in-flight sync).
   * 2. Sets `isSyncing = true` to disable all transport controls.
   * 3. Pauses and seeks all tracks to `time`.
   * 4. If `autoResume`: waits for all tracks to be buffered at the new
   *    position, then plays all simultaneously.
   * 5. Clears `isSyncing` in a `finally` block.
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
    [applyVolumes, dispatch, getActiveElements, getMaster, syncAudioTracks, waitForAllTracksReady],
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
      // When the active mode's master stalls, pause other elements in the
      // same mode. When master resumes ('playing'), re-sync and restart them.

      const pauseNonMaster = (): void => {
        if (getMasterRef.current() !== el) return;
        if (!isPlayingRef.current) return;
        setIsBuffering(true);
        isBufferingRef.current = true;
        const activeEls = getActiveElementsRef.current();
        activeEls.forEach((a) => { if (a !== el) a.pause(); });
      };

      el.addEventListener('waiting', pauseNonMaster);
      el.addEventListener('stalled', pauseNonMaster);

      el.addEventListener('playing', () => {
        if (getMasterRef.current() !== el) return;
        // Only act if recovering from a buffering stall
        if (!isBufferingRef.current) return;
        isBufferingRef.current = false;
        setIsBuffering(false);

        // Sync and restart non-master elements of the same active source
        const activeEls = getActiveElementsRef.current();
        const nonMasterEls = activeEls.filter((a) => a !== el);
        nonMasterEls.forEach((a) => { a.currentTime = el.currentTime; });
        void Promise.all(
          nonMasterEls.map((a) => a.play().catch(() => { })),
        ).then(() => { applyVolumesRef.current(); });
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
  }, [dispatch, getActiveElements, getMaster, isBuffering, isSyncing, isPlaying, prepareAt]);

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
   * Switch between raw and separated source.
   *
   * Switching disposes all current audio elements (via the trackKey-driven
   * rebuild effect) and restarts the song from 0 on the new source.
   * The rebuild effect handles auto-play so no manual coordination is needed
   * here.
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
                <ToggleButton value="separated">{t('separatedLabel')}</ToggleButton>
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
                  disabled={!isPlayerReady || isLoading || isBuffering || isSyncing}
                  aria-label={isPlaying ? t('pauseAriaLabel') : t('playAriaLabel')}
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
                  disabled={!isPlayerReady || isLoading || isBuffering || isSyncing}
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
                    aria-label={isMuted ? t('unmuteAriaLabel') : t('muteAriaLabel')}
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
                  disabled={isLoading || isSyncing || !availableStems.includes('vocals')}
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
        </Stack>
      </CardContent>
    </Card>
  );
}
