'use client';

/**
 * GlobalPlayer — Unified audio player with dual-engine architecture for raw and
 * separated stem playback.
 *
 * ARCHITECTURE OVERVIEW:
 * ────────────────────────────────────────────────────────────────────────────
 *
 * This component uses a modular headless-engine design with a unified state
 * contract to support both single-track (raw) and multi-track (separated) audio
 * playback without duplicating logic.
 *
 * ┌─────────────────────────────────────────────────────┐
 * │  GlobalPlayerInner (UI Layer)                       │
 * │  ─ Renders transport controls, sliders, stem chips  │
 * │  ─ Manages mode selection, stem presets, errors     │
 * │  ─ Mounts both engines (only active one runs)       │
 * └────────────┬──────────────────┬────────────────────┘
 *              │                  │
 *              ▼                  ▼
 *   ┌────────────────────┐  ┌────────────────────┐
 *   │ RawPlayerEngine    │  │SeparatedPlayerEngine
 *   │                    │  │                    │
 *   │ • Single audio     │  │ • Multi-stem       │
 *   │   element          │  │ • Leader election  │
 *   │ • Simple events    │  │ • Drift correction │
 *   │ • Returns null     │  │ • Volume balancing │
 *   │   (headless)       │  │ • Returns null     │
 *   │                    │  │   (headless)       │
 *   └────────────────────┘  └────────────────────┘
 *              │                  │
 *              └──────┬───────────┘
 *                     │
 *                     ▼
 *              PlayerState (unified)
 *              ─────────────────────
 *              Intent (what user wants):
 *              • isPlaying
 *              • currentTime
 *              • isSeeking
 *              • volume, isMuted
 *
 *              Reality (what browser is doing):
 *              • isLoaded
 *              • isBuffering
 *              • duration
 *              • hasSource, error
 *              • sourceRefreshing
 *
 * ENGINES:
 * ────────────────────────────────────────────────────────────────────────────
 *
 * RawPlayerEngine:
 * • Mounts once, creates a single HTMLAudioElement
 * • Responds to URL changes by updating element.src
 * • Event listeners sync playback state back to PlayerState
 * • Simple transport: play/pause/seek via intent changes
 * • No multi-track synchronization logic
 *
 * SeparatedPlayerEngine:
 * • Builds/rebuilds audio elements when stem pool changes
 * • Elects a "leader" stem as the source of truth for time
 * • requestAnimationFrame loop monitors drift and applies corrections:
 *   - Soft: playback-rate micro-adjustments (±0.05x) for sub-0.03s drift
 *   - Hard: direct seeking when drift exceeds 0.25s
 * • Volume normalization: uses sqrt(audibleCount) to balance mixing
 * • Per-stem event handlers write back observed state
 *
 * STATE MANAGEMENT:
 * ────────────────────────────────────────────────────────────────────────────
 *
 * • player: PlayerState — unified contract (always synchronized between both engines)
 * • mode: 'raw' | 'separated' — controls which engine is "active"
 * • stemsEnabled: Record<StemKey, bool> — per-stem mute/unmute state
 * • isSeparationDialogOpen — modal state
 *
 * Both engines are always mounted. Switching mode:
 * 1. The inactive engine's audio elements pause (don't destroy)
 * 2. Only the active engine's event listeners fire
 * 3. Switching mode again resumes from preserved playhead position
 *
 * SYNCHRONIZATION (Separated Mode):
 * ────────────────────────────────────────────────────────────────────────────
 *
 * • Leader election: chooseLeaderKey(availableStems, stemsEnabled)
 *   - First pick: preferred order (vocals → bass → drums → piano → guitar → other)
 *   - Fallback: first available enabled stem
 *   - Only re-elected when stem pool changes or enabled set changes
 *
 * • Drift correction loop (requestAnimationFrame):
 *   - Every 180ms: measure leader.currentTime vs. each stem.currentTime
 *   - Soft threshold (0.03s): adjust playbackRate = 1 ± (drift * 2, clamped)
 *   - Hard threshold (0.25s): seek stem to leader.currentTime
 *   - Below threshold: reset playbackRate to 1.0
 *
 * • Visibility recovery: on document.visibilitychange to 'visible'
 *   - Re-align all stems if inter-stem drift > 0.03s
 *   - Resume playback if intendedPlay is true
 *
 * ERROR HANDLING:
 * ────────────────────────────────────────────────────────────────────────────
 *
 * • Raw load failure → player.error = "Failed to load or decode the audio."
 * • Stem load failure → player.error = "Failed to load stem "{stem}"."
 * • Stems unavailable → player.error = "Stems unavailable. Check the separation."
 * • User-facing errors are translated via useTranslations('Player')
 *
 * URL MANAGEMENT:
 * ────────────────────────────────────────────────────────────────────────────
 *
 * • useSongRawUrl() — fetches and caches raw audio signed URL
 * • useSongStemsUrl() — fetches and caches all available stem URLs
 * • useStorageDownloadUrls(paths) — centralized via StorageUrlManager (1-day TTL)
 * • URL changes trigger state updates but not element destruction
 *
 * TRANSPORT CONTROLS:
 * ────────────────────────────────────────────────────────────────────────────
 *
 * • Play/Pause: toggles player.isPlaying; engines respond via event listeners
 * • Stop: sets isPlaying=false, currentTime=0, dispatches PLAYER_STOP
 * • Seek:
 *   - onChange: sets currentTime + isSeeking=true (UI-only update, no audio change)
 *   - onChangeCommitted: sets isSeeking=false (triggers engine seek)
 * • Volume: updates player.volume; engines apply to elements
 * • Mute: toggles player.isMuted; engines zero out volumes
 * • Mode switch: toggles mode state; inactive engine pauses, active engine resumes
 * • Stem toggle: updates stemsEnabled map; engines re-elect leader and recalc volumes
 * • Presets: setPreset('instrumental'|'vocals'|'all') updates stemsEnabled
 *
 * DISABLED STATES:
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Controls are disabled (controlsDisabled = true) when:
 * • No audio source (player.hasSource === false)
 * • Source is refreshing (player.sourceRefreshing === true)
 *
 * Additional UI state for spinners:
 * • isBusy = sourceRefreshing || !isLoaded || isBuffering (shows spinner)
 *
 * TESTING NOTES:
 * ────────────────────────────────────────────────────────────────────────────
 *
 * • Engines are headless; test them via PlayerState changes
 * • Events from HTMLAudioElement are simulated in unit tests
 * • Mock useSongRawUrl() and useSongStemsUrl() to control URL availability
 * • Mock useGlobalState() to set currentSongId and playbackStatus
 * • Verify UI updates by checking PlayerState changes, not DOM attributes
 */

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

import type {
  NormalizedSeparationInfo,
  SeparationStemName,
  Song,
} from '@/lib/api/types';
import { useSongRawUrl } from '@/lib/hooks/useSongRawUrl';
import { useStorageDownloadUrls } from '@/lib/hooks/useStorageDownloadUrls';
import {
  emitGlobalPlayerSnapshot,
  requestPracticeDialogOpen,
} from '@/lib/player/practiceSync';
import { normalizeSeparationInfo } from '@/lib/separations';
import { useGlobalState, useGlobalStateDispatch } from '@/lib/store';
import { SeparationDialog } from './SeparationDialog';

// ---------------------------------------------------------------------------
// Constants & primitives
// ---------------------------------------------------------------------------

type StemKey = SeparationStemName;

const STEM_ORDER: StemKey[] = [
  'vocals',
  'bass',
  'drums',
  'piano',
  'guitar',
  'other',
];

const DRIFT_CHECK_INTERVAL_MS = 180;
const DRIFT_HARD_THRESHOLD = 0.25;
const DRIFT_SOFT_THRESHOLD = 0.03;
const DRIFT_MAX_CORRECTION = 0.05;

function formatTime(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60)
    .toString()
    .padStart(2, '0');
  return `${m}:${s}`;
}

function clampToRange(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

// ---------------------------------------------------------------------------
// Shared state contract
// ---------------------------------------------------------------------------

/**
 * Unified player state shared between the UI and the engine components.
 * Engines read intent (`isPlaying`, `currentTime`, `isSeeking`) and write
 * back observed reality (`isLoaded`, `isBuffering`, `duration`).
 */
export interface PlayerState {
  /** Whether the engine should be playing. */
  isPlaying: boolean;
  /** Whether the master source has loaded enough to play. */
  isLoaded: boolean;
  /** Whether the engine is waiting for network data. */
  isBuffering: boolean;
  /** Duration of the active track in seconds. */
  duration: number;
  /**
   * Current playhead position in seconds.
   * Also used as seek target when `isSeeking` transitions to `false`.
   */
  currentTime: number;
  /** Master volume [0..1]. */
  volume: number;
  /** Whether the output is muted. */
  isMuted: boolean;
  /** `true` while a signed URL is being refreshed. */
  sourceRefreshing: boolean;
  /** `true` if a playable source URL is available. */
  hasSource: boolean;
  /** Non-fatal error message to display, or `null`. */
  error: string | null;
  /** `true` while the user is dragging the seek slider. */
  isSeeking: boolean;
}

const DEFAULT_PLAYER_STATE: PlayerState = {
  isPlaying: false,
  isLoaded: false,
  isBuffering: false,
  duration: 0,
  currentTime: 0,
  volume: 1,
  isMuted: false,
  sourceRefreshing: false,
  hasSource: false,
  error: null,
  isSeeking: false,
};

// ---------------------------------------------------------------------------
// Audio handler types (avoids attaching arbitrary props to DOM elements)
// ---------------------------------------------------------------------------

interface AudioEventHandlers {
  onLoadedMetadata: () => void;
  onCanPlayThrough: () => void;
  onTimeUpdate: () => void;
  onPlay: () => void;
  onPause: () => void;
  onWaiting: () => void;
  onPlaying: () => void;
  onEnded: () => void;
  onError: () => void;
}

function attachHandlers(
  audio: HTMLAudioElement,
  handlers: AudioEventHandlers,
): void {
  audio.addEventListener('loadedmetadata', handlers.onLoadedMetadata);
  audio.addEventListener('canplaythrough', handlers.onCanPlayThrough);
  audio.addEventListener('timeupdate', handlers.onTimeUpdate);
  audio.addEventListener('play', handlers.onPlay);
  audio.addEventListener('pause', handlers.onPause);
  audio.addEventListener('waiting', handlers.onWaiting);
  audio.addEventListener('playing', handlers.onPlaying);
  audio.addEventListener('ended', handlers.onEnded);
  audio.addEventListener('error', handlers.onError);
}

function detachHandlers(
  audio: HTMLAudioElement,
  handlers: AudioEventHandlers,
): void {
  audio.removeEventListener('loadedmetadata', handlers.onLoadedMetadata);
  audio.removeEventListener('canplaythrough', handlers.onCanPlayThrough);
  audio.removeEventListener('timeupdate', handlers.onTimeUpdate);
  audio.removeEventListener('play', handlers.onPlay);
  audio.removeEventListener('pause', handlers.onPause);
  audio.removeEventListener('waiting', handlers.onWaiting);
  audio.removeEventListener('playing', handlers.onPlaying);
  audio.removeEventListener('ended', handlers.onEnded);
  audio.removeEventListener('error', handlers.onError);
}

// ---------------------------------------------------------------------------
// Engine props
// ---------------------------------------------------------------------------

interface EngineProps {
  song: Song;
  player: PlayerState;
  setPlayer: React.Dispatch<React.SetStateAction<PlayerState>>;
  active: boolean;
}

interface SeparatedEngineProps extends EngineProps {
  /** Per-stem enable map: `undefined` or `true` means audible, `false` means muted. */
  stemsEnabled: Partial<Record<StemKey, boolean>>;
}

// ---------------------------------------------------------------------------
// useSongStemsUrl – resolves download URLs for all available stems
// ---------------------------------------------------------------------------

interface SongStemsUrlResult {
  urls: Partial<Record<StemKey, string>>;
  availableStems: StemKey[];
  isRefreshing: boolean;
  error: string | null;
}

/**
 * Resolves signed download URLs for every stem in a finished separation.
 * Returns an empty map while the separation is not finished or is still loading.
 */
function useSongStemsUrl(song: Song): SongStemsUrlResult {
  const separation = useMemo<NormalizedSeparationInfo | null>(
    () => normalizeSeparationInfo(song.separatedSongInfo ?? null),
    [song.separatedSongInfo],
  );

  const isFinished = separation?.status === 'finished';
  const stemPaths: Partial<Record<StemKey, string>> | null = isFinished
    ? (separation?.stems?.paths ?? null)
    : null;

  const { urls, isLoading } = useStorageDownloadUrls(stemPaths);

  const safeUrls = urls ?? {};
  const availableStems = useMemo<StemKey[]>(
    () => STEM_ORDER.filter((stem) => Boolean(safeUrls[stem])),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [JSON.stringify(safeUrls)],
  );

  const error =
    isFinished && !isLoading && availableStems.length === 0
      ? ('stemsUnavailableError' as const)
      : null;

  return {
    urls: safeUrls,
    availableStems,
    isRefreshing: !!isLoading,
    error,
  };
}

// ---------------------------------------------------------------------------
// RawPlayerEngine
// ---------------------------------------------------------------------------

/**
 * Headless engine for the "raw" (single-track original audio) playback mode.
 * Mounts once, keeps a single `HTMLAudioElement`, and responds to `player`
 * intent changes. Writes observed audio state back via `setPlayer`.
 * Returns `null` — renders no DOM.
 */
function RawPlayerEngine({
  song,
  player,
  setPlayer,
  active,
}: EngineProps): null {
  const t = useTranslations('Player');

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const handlersRef = useRef<AudioEventHandlers | null>(null);

  // Stable refs to avoid stale closures inside event listeners
  const activeRef = useRef(active);
  const isSeekingRef = useRef(player.isSeeking);
  const intendedPlayRef = useRef(player.isPlaying);

  useEffect(() => {
    activeRef.current = active;
  }, [active]);
  useEffect(() => {
    isSeekingRef.current = player.isSeeking;
  }, [player.isSeeking]);
  useEffect(() => {
    intendedPlayRef.current = player.isPlaying;
  }, [player.isPlaying]);

  const {
    url: rawUrl,
    isRefreshing: isRawRefreshing,
    error: rawError,
  } = useSongRawUrl(song);

  // Mount once: create the audio element and attach all event listeners.
  useEffect(() => {
    const audio = new Audio();
    audio.preload = 'auto';
    audio.setAttribute('playsinline', 'true');
    audioRef.current = audio;

    const handlers: AudioEventHandlers = {
      onLoadedMetadata: () => {
        if (!activeRef.current) return;
        setPlayer((p) => ({
          ...p,
          isLoaded: true,
          duration: isFinite(audio.duration) ? audio.duration : 0,
          error: null,
        }));
      },
      onCanPlayThrough: () => {
        if (!activeRef.current || !intendedPlayRef.current) return;
        void audio.play().catch(() => undefined);
      },
      onTimeUpdate: () => {
        if (!activeRef.current || isSeekingRef.current) return;
        setPlayer((p) => ({ ...p, currentTime: audio.currentTime || 0 }));
      },
      onPlay: () => {
        if (!activeRef.current) return;
        setPlayer((p) => ({ ...p, isPlaying: true }));
      },
      onPause: () => {
        if (!activeRef.current) return;
        setPlayer((p) => ({ ...p, isPlaying: false }));
      },
      onWaiting: () => {
        if (!activeRef.current) return;
        setPlayer((p) => ({ ...p, isBuffering: true }));
      },
      onPlaying: () => {
        if (!activeRef.current) return;
        setPlayer((p) => ({ ...p, isBuffering: false }));
      },
      onEnded: () => {
        if (!activeRef.current) return;
        setPlayer((p) => ({ ...p, isPlaying: false, currentTime: 0 }));
      },
      onError: () => {
        if (!activeRef.current) return;
        setPlayer((p) => ({
          ...p,
          isLoaded: false,
          isPlaying: false,
          error: t('audioLoadError'),
        }));
      },
    };

    handlersRef.current = handlers;
    attachHandlers(audio, handlers);

    return () => {
      const h = handlersRef.current;
      if (h) detachHandlers(audio, h);
      audio.pause();
      audio.removeAttribute('src');
      try {
        audio.load();
      } catch {
        /* no-op */
      }
      audioRef.current = null;
      handlersRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // React to URL changes: swap src and reset readiness state.
  useEffect(() => {
    const audio = audioRef.current;

    if (activeRef.current) {
      setPlayer((p) => ({
        ...p,
        sourceRefreshing: !!isRawRefreshing,
        hasSource: !!rawUrl,
        error: rawError ? String(rawError) : (p.error ?? null),
      }));
    }

    if (!audio) return;

    if (rawUrl) {
      audio.src = rawUrl;
      try {
        audio.load();
      } catch {
        /* no-op */
      }
    } else {
      audio.removeAttribute('src');
      try {
        audio.load();
      } catch {
        /* no-op */
      }
    }

    if (activeRef.current) {
      setPlayer((p) => ({
        ...p,
        isLoaded: false,
        isBuffering: false,
        // Preserve isPlaying intent: onCanPlayThrough will resume playback once
        // the new src is ready. Resetting to false here would swallow the
        // autoplay intent set at mount when the user clicks play.
        currentTime: 0,
        duration: 0,
      }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rawUrl, isRawRefreshing, rawError]);

  // Pause when deactivated; restore volume / mute when re-activated.
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (!active) {
      audio.pause();
      return;
    }
    audio.volume = player.volume;
    audio.muted = player.isMuted;
  }, [active, player.volume, player.isMuted]);

  // Keep volume / mute in sync with player state (only while active).
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !active) return;
    audio.volume = player.volume;
    audio.muted = player.isMuted;
  }, [player.volume, player.isMuted, active]);

  // Respond to play / pause intent from the UI.
  // Guard with `player.isLoaded`: before the source is ready, `onCanPlayThrough`
  // handles autoplay. Acting before load races with `audio.load()` and causes
  // AbortError. The effect re-runs once `isLoaded` becomes true.
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !active) {
      // Always pause the inactive engine regardless of load state.
      if (audio && !active) audio.pause();
      return;
    }

    if (!player.isLoaded) return;

    if (player.isPlaying) {
      void audio.play().catch((err: unknown) => {
        // AbortError is benign (load() or pause() interrupted a pending play).
        if (err instanceof DOMException && err.name === 'AbortError') return;
        console.error('[RawPlayerEngine] play() rejected:', err);
        setPlayer((p) => ({ ...p, isPlaying: false }));
      });
    } else {
      audio.pause();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [player.isPlaying, player.isLoaded, active]);

  // Apply seek commits (when `isSeeking` returns to `false`).
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !active || player.isSeeking || !player.isLoaded) return;

    const target = clampToRange(
      player.currentTime ?? 0,
      0,
      player.duration || 0,
    );
    if (Math.abs(audio.currentTime - target) > 0.2) {
      try {
        audio.currentTime = target;
      } catch {
        /* no-op */
      }
    }
  }, [
    player.currentTime,
    player.isSeeking,
    player.isLoaded,
    player.duration,
    active,
  ]);

  return null;
}

// ---------------------------------------------------------------------------
// SeparatedPlayerEngine
// ---------------------------------------------------------------------------

/**
 * Headless engine for separated (multi-stem) playback.
 * Keeps all stems synchronised to a designated "leader" track using a
 * `requestAnimationFrame` loop with playback-rate micro-corrections.
 * Supports per-stem muting via `stemsEnabled`. Returns `null` — renders no DOM.
 */
function SeparatedPlayerEngine({
  song,
  player,
  setPlayer,
  active,
  stemsEnabled,
}: SeparatedEngineProps): null {
  const t = useTranslations('Player');

  // Per-stem audio elements
  const audiosRef = useRef<Partial<Record<StemKey, HTMLAudioElement>>>({});
  // Per-element event handlers stored separately (avoids attaching to DOM node)
  const handlersMapRef = useRef<Partial<Record<StemKey, AudioEventHandlers>>>(
    {},
  );

  const leaderKeyRef = useRef<StemKey | null>(null);
  const leaderAudioRef = useRef<HTMLAudioElement | null>(null);

  // Stable refs to avoid stale closures
  const activeRef = useRef(active);
  const isSeekingRef = useRef(player.isSeeking);
  const intendedPlayRef = useRef(player.isPlaying);
  const playerRef = useRef(player);
  const stemsEnabledRef = useRef(stemsEnabled);

  useEffect(() => {
    activeRef.current = active;
  }, [active]);
  useEffect(() => {
    isSeekingRef.current = player.isSeeking;
  }, [player.isSeeking]);
  useEffect(() => {
    intendedPlayRef.current = player.isPlaying;
  }, [player.isPlaying]);
  useEffect(() => {
    playerRef.current = player;
  }, [player]);
  useEffect(() => {
    stemsEnabledRef.current = stemsEnabled;
  }, [stemsEnabled]);

  const durationsRef = useRef<Partial<Record<StemKey, number>>>({});
  const waitingSetRef = useRef<Set<StemKey>>(new Set());

  const {
    urls: stemsUrls,
    availableStems,
    isRefreshing: isStemsRefreshing,
    error: stemsError,
  } = useSongStemsUrl(song);

  // ---------------------------------------------------------------------------
  // Stable helpers (read from refs only — no render-cycle dependencies)
  // ---------------------------------------------------------------------------

  const chooseLeaderKey = useCallback(
    (
      keys: StemKey[],
      enabledMap: Partial<Record<StemKey, boolean>>,
    ): StemKey | null => {
      if (!keys.length) return null;
      const enabledKeys = keys.filter((k) => enabledMap[k] !== false);
      const pool = enabledKeys.length ? enabledKeys : keys;
      for (const preferred of STEM_ORDER) {
        if (pool.includes(preferred)) return preferred;
      }
      return [...pool].sort()[0] ?? null;
    },
    [],
  );

  const computeUiDuration = useCallback((): number => {
    const values = Object.values(durationsRef.current).filter(
      (d): d is number => typeof d === 'number' && isFinite(d) && d > 0,
    );
    return values.length ? Math.min(...values) : 0;
  }, []);

  const applyVolumes = useCallback((): void => {
    const audios = audiosRef.current;
    const p = playerRef.current;
    const enabled = stemsEnabledRef.current;
    const keys = Object.keys(audios) as StemKey[];
    const audibleCount = keys.filter((k) => enabled[k] !== false).length || 1;
    const masterVolume = p.isMuted ? 0 : p.volume;
    const perStemVolume = masterVolume / Math.sqrt(audibleCount);

    keys.forEach((k) => {
      const a = audios[k];
      if (!a) return;
      a.volume = perStemVolume;
      a.muted = p.isMuted || enabled[k] === false;
    });
  }, []);

  const pauseAll = useCallback((): void => {
    (Object.values(audiosRef.current) as HTMLAudioElement[]).forEach((a) => {
      try {
        a.pause();
      } catch {
        /* no-op */
      }
    });
  }, []);

  const alignAllToTime = useCallback((target: number, eps = 0.02): void => {
    const t = Math.max(0, target);
    (Object.values(audiosRef.current) as HTMLAudioElement[]).forEach((a) => {
      if (!a || !isFinite(a.currentTime)) return;
      if (Math.abs(a.currentTime - t) > eps) {
        try {
          a.currentTime = t;
        } catch {
          /* no-op */
        }
      }
    });
  }, []);

  const playAll = useCallback(async (): Promise<void> => {
    const audios = audiosRef.current;
    const leader = leaderAudioRef.current;
    const rest = (Object.values(audios) as HTMLAudioElement[]).filter(
      (a) => a !== leader,
    );
    try {
      if (leader) await leader.play();
      await Promise.allSettled(rest.map((a) => a.play()));
    } catch (err) {
      console.error('[SeparatedPlayerEngine] play() rejected:', err);
      setPlayer((p) => ({ ...p, isPlaying: false }));
    }
  }, [setPlayer]);

  // ---------------------------------------------------------------------------
  // Stable key for stems URL map (avoids object-reference churn)
  // ---------------------------------------------------------------------------

  const stemsUrlsKey = useMemo(
    () =>
      Object.entries(stemsUrls)
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([k, u]) => `${k}=${u ?? ''}`)
        .join('|'),
    [stemsUrls],
  );

  const stemsEnabledKey = useMemo(
    () =>
      (Object.entries(stemsEnabled) as Array<[StemKey, boolean | undefined]>)
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([k, v]) => `${k}=${v !== false ? '1' : '0'}`)
        .join('|'),
    [stemsEnabled],
  );

  // ---------------------------------------------------------------------------
  // Build / update audio elements whenever stem URLs change
  // ---------------------------------------------------------------------------

  useEffect(() => {
    const currentKeys = Object.keys(audiosRef.current) as StemKey[];
    const nextKeys = (Object.keys(stemsUrls) as StemKey[]).filter((k) =>
      Boolean(stemsUrls[k]),
    );

    // Remove stems that are no longer present
    for (const k of currentKeys) {
      if (!nextKeys.includes(k)) {
        const a = audiosRef.current[k];
        if (a) {
          try {
            a.pause();
          } catch {
            /* no-op */
          }
          const h = handlersMapRef.current[k];
          if (h) detachHandlers(a, h);
          a.removeAttribute('src');
          try {
            a.load();
          } catch {
            /* no-op */
          }
        }
        delete audiosRef.current[k];
        delete handlersMapRef.current[k];
        delete durationsRef.current[k];
        waitingSetRef.current.delete(k);
      }
    }

    // Add or update existing stems
    for (const k of nextKeys) {
      const url = stemsUrls[k];
      if (!url) continue;

      let a = audiosRef.current[k];
      const isNew = !a;

      if (!a) {
        a = new Audio();
        a.preload = 'auto';
        a.setAttribute('playsinline', 'true');
        audiosRef.current[k] = a;

        const stemAudio = a; // stable reference captured by closures

        const handlers: AudioEventHandlers = {
          onLoadedMetadata: () => {
            durationsRef.current[k] = isFinite(stemAudio.duration)
              ? stemAudio.duration
              : 0;
            if (!activeRef.current) return;
            setPlayer((p) => ({
              ...p,
              isLoaded: true,
              duration: computeUiDuration(),
              error: null,
            }));
          },
          onCanPlayThrough: () => {
            if (!activeRef.current || !intendedPlayRef.current) return;
            void stemAudio.play().catch(() => undefined);
          },
          onTimeUpdate: () => {
            if (!activeRef.current || leaderKeyRef.current !== k) return;
            if (!isSeekingRef.current) {
              setPlayer((p) => ({
                ...p,
                currentTime: stemAudio.currentTime || 0,
              }));
            }
          },
          onPlay: () => {
            if (!activeRef.current || leaderKeyRef.current !== k) return;
            setPlayer((p) => ({ ...p, isPlaying: true }));
          },
          onPause: () => {
            if (!activeRef.current || leaderKeyRef.current !== k) return;
            // Skip if the tab is hidden and the user intends to keep playing
            if (
              intendedPlayRef.current &&
              typeof document !== 'undefined' &&
              document.visibilityState === 'hidden'
            ) {
              return;
            }
            setPlayer((p) => ({ ...p, isPlaying: false }));
          },
          onWaiting: () => {
            if (!activeRef.current) return;
            waitingSetRef.current.add(k);
            setPlayer((p) => ({ ...p, isBuffering: true }));
          },
          onPlaying: () => {
            if (!activeRef.current) return;
            waitingSetRef.current.delete(k);
            setPlayer((p) => ({
              ...p,
              isBuffering: waitingSetRef.current.size > 0,
            }));
          },
          onEnded: () => {
            if (!activeRef.current || leaderKeyRef.current !== k) return;
            setPlayer((p) => ({ ...p, isPlaying: false, currentTime: 0 }));
          },
          onError: () => {
            if (!activeRef.current) return;
            setPlayer((p) => ({
              ...p,
              isLoaded: false,
              isPlaying: false,
              error: t('stemLoadError', { stem: k }),
            }));
          },
        };

        handlersMapRef.current[k] = handlers;
        attachHandlers(stemAudio, handlers);
      }

      // Keep src in sync with the (possibly refreshed) URL
      if (a.src !== url) {
        a.src = url;
        try {
          a.load();
        } catch {
          /* no-op */
        }
      }

      if (isNew && activeRef.current) {
        a.muted =
          playerRef.current.isMuted || stemsEnabledRef.current[k] === false;
      }
    }

    // Re-elect the leader track
    const allKeys = Object.keys(audiosRef.current) as StemKey[];
    const newLeader = chooseLeaderKey(allKeys, stemsEnabledRef.current);
    leaderKeyRef.current = newLeader;
    leaderAudioRef.current = newLeader
      ? (audiosRef.current[newLeader] ?? null)
      : null;

    if (activeRef.current) {
      setPlayer((p) => ({
        ...p,
        isLoaded: false,
        isBuffering: false,
        duration: 0,
      }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stemsUrlsKey]);

  // Re-elect leader when the enabled set changes (without rebuilding elements)
  useEffect(() => {
    const allKeys = Object.keys(audiosRef.current) as StemKey[];
    const newLeader = chooseLeaderKey(allKeys, stemsEnabled);
    leaderKeyRef.current = newLeader;
    leaderAudioRef.current = newLeader
      ? (audiosRef.current[newLeader] ?? null)
      : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stemsEnabledKey, stemsUrlsKey]);

  // Propagate source status without resetting player
  useEffect(() => {
    if (!activeRef.current) return;
    const hasSource = availableStems.length > 0;
    setPlayer((p) => ({
      ...p,
      hasSource,
      sourceRefreshing: !!isStemsRefreshing,
      error:
        stemsError && !hasSource
          ? t(stemsError as Parameters<typeof t>[0])
          : (p.error ?? null),
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stemsUrlsKey, isStemsRefreshing, stemsError]);

  // Full cleanup on unmount
  useEffect(() => {
    // Capture ref values so the closure sees the same object identity
    const waitingSet = waitingSetRef.current;
    return () => {
      const keys = Object.keys(audiosRef.current) as StemKey[];
      for (const k of keys) {
        const a = audiosRef.current[k];
        const h = handlersMapRef.current[k];
        if (a) {
          try {
            a.pause();
          } catch {
            /* no-op */
          }
          if (h) detachHandlers(a, h);
          a.removeAttribute('src');
          try {
            a.load();
          } catch {
            /* no-op */
          }
        }
      }
      audiosRef.current = {};
      handlersMapRef.current = {};
      leaderAudioRef.current = null;
      leaderKeyRef.current = null;
      durationsRef.current = {};
      waitingSet.clear();
    };
  }, []);

  // Activate / deactivate: pause when inactive, apply volumes when active
  useEffect(() => {
    if (!active) {
      pauseAll();
      return;
    }
    applyVolumes();
  }, [active, applyVolumes, pauseAll]);

  // Sync volume / mute / stemsEnabled changes to all audio elements
  useEffect(() => {
    if (!active) return;
    applyVolumes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [player.volume, player.isMuted, stemsEnabledKey, active]);

  // Respond to play / pause intent from the UI
  // Same isLoaded guard as RawPlayerEngine: onCanPlayThrough handles initial
  // autoplay; acting before the stems are ready races with load() calls.
  useEffect(() => {
    if (!active) {
      pauseAll();
      return;
    }

    if (!player.isLoaded) return;

    const leader = leaderAudioRef.current;
    if (!leader) return;

    if (player.isPlaying) {
      const target =
        player.currentTime >= 0 ? player.currentTime : leader.currentTime || 0;
      alignAllToTime(target, 0.02);
      void playAll();
    } else {
      pauseAll();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [player.isPlaying, player.isLoaded, active]);

  // Apply seek commits
  useEffect(() => {
    if (!active || player.isSeeking || !player.isLoaded) return;
    const target = clampToRange(
      player.currentTime ?? 0,
      0,
      player.duration || 0,
    );
    const leader = leaderAudioRef.current;
    const current = leader?.currentTime ?? 0;
    if (Math.abs(current - target) > 0.2) {
      alignAllToTime(target, 0.01);
    }
  }, [
    player.currentTime,
    player.isSeeking,
    player.isLoaded,
    player.duration,
    active,
    alignAllToTime,
  ]);

  // Continuous drift-correction loop via requestAnimationFrame
  useEffect(() => {
    if (!active) return;

    let rafId: number | null = null;
    let lastCheck = performance.now();

    const tick = (): void => {
      const now = performance.now();
      if (now - lastCheck >= DRIFT_CHECK_INTERVAL_MS) {
        lastCheck = now;
        const leader = leaderAudioRef.current;
        const p = playerRef.current;
        if (leader && p.isPlaying && !p.isSeeking) {
          const lt = leader.currentTime || 0;
          (
            Object.entries(audiosRef.current) as Array<
              [StemKey, HTMLAudioElement]
            >
          ).forEach(([k, a]) => {
            if (!a || k === leaderKeyRef.current) return;
            const diff = lt - (a.currentTime || 0);
            const abs = Math.abs(diff);
            if (abs > DRIFT_HARD_THRESHOLD) {
              try {
                a.currentTime = lt;
              } catch {
                /* no-op */
              }
              a.playbackRate = 1;
            } else if (abs > DRIFT_SOFT_THRESHOLD) {
              a.playbackRate =
                1 +
                clampToRange(
                  diff * 2,
                  -DRIFT_MAX_CORRECTION,
                  DRIFT_MAX_CORRECTION,
                );
            } else if (a.playbackRate !== 1) {
              a.playbackRate = 1;
            }
          });
        }
      }
      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      (Object.values(audiosRef.current) as HTMLAudioElement[]).forEach((a) => {
        if (a && a.playbackRate !== 1) a.playbackRate = 1;
      });
    };
  }, [active, player.isPlaying, player.isSeeking]);

  // Resume after the browser tab becomes visible again
  useEffect(() => {
    const onVisibilityChange = (): void => {
      if (
        typeof document === 'undefined' ||
        document.visibilityState !== 'visible' ||
        !activeRef.current ||
        !intendedPlayRef.current
      ) {
        return;
      }

      requestAnimationFrame(() => {
        const times = (
          Object.values(audiosRef.current) as HTMLAudioElement[]
        ).map((a) => (isFinite(a.currentTime) ? a.currentTime : 0));

        if (!times.length) return;

        const max = Math.max(...times);
        const min = Math.min(...times);
        if (max - min > 0.03) alignAllToTime(max, 0.01);
        void playAll();
        setPlayer((p) => ({ ...p, isPlaying: true }));
      });
    };

    document.addEventListener('visibilitychange', onVisibilityChange);
    return () =>
      document.removeEventListener('visibilitychange', onVisibilityChange);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}

// ---------------------------------------------------------------------------
// GlobalPlayer (public API)
// ---------------------------------------------------------------------------

/**
 * Public entry point. Reads the current song from the global store and
 * delegates to the inner player UI. Returns an empty fragment when no song
 * is selected.
 */
export function GlobalPlayer(): React.ReactElement {
  const { currentSongId, songs } = useGlobalState();
  const currentSong = currentSongId
    ? songs.find((song) => song.id === currentSongId)
    : null;

  if (!currentSongId || !currentSong) return <></>;

  return <GlobalPlayerInner key={currentSong.id} song={currentSong} />;
}

interface GlobalPlayerInnerProps {
  song: Song;
}

/**
 * Player UI. Keeps both engines (`RawPlayerEngine` and `SeparatedPlayerEngine`)
 * mounted at all times and toggles between them via the `active` prop so that
 * the inactive engine's audio element is merely paused rather than destroyed,
 * preserving the playhead position across mode switches.
 */
function GlobalPlayerInner({
  song,
}: GlobalPlayerInnerProps): React.ReactElement {
  const t = useTranslations('Player');
  const tPractice = useTranslations('Practice');
  const dispatch = useGlobalStateDispatch();
  const { playbackStatus } = useGlobalState();

  const [mode, setMode] = useState<'raw' | 'separated'>('raw');
  // Start playing immediately when the song was loaded via a play-click
  // (playbackStatus === 'loading' means the user selected this song to play).
  const [player, setPlayer] = useState<PlayerState>({
    ...DEFAULT_PLAYER_STATE,
    isPlaying: playbackStatus === 'loading',
  });
  const [stemsEnabled, setStemsEnabled] = useState<
    Partial<Record<StemKey, boolean>>
  >({});
  const [isSeparationDialogOpen, setIsSeparationDialogOpen] = useState(false);
  const [separationSuccessMessage, setSeparationSuccessMessage] = useState<
    string | null
  >(null);
  const [showSeparationSuccessSnackbar, setShowSeparationSuccessSnackbar] =
    useState(false);

  // Broadcast minimal playback state for practice-related listeners.
  useEffect(() => {
    emitGlobalPlayerSnapshot({
      songId: song.id,
      mode,
      isPlaying: player.isPlaying,
      isLoaded: player.isLoaded,
      currentTime: player.currentTime,
      duration: player.duration,
    });
  }, [
    song.id,
    mode,
    player.currentTime,
    player.duration,
    player.isLoaded,
    player.isPlaying,
  ]);

  // Separation info needed for the bottom status section
  const separation = useMemo<NormalizedSeparationInfo | null>(
    () => normalizeSeparationInfo(song.separatedSongInfo ?? null),
    [song.separatedSongInfo],
  );
  const isSeparationFinished = separation?.status === 'finished';

  // Stem availability (for the UI selector and presets)
  const { availableStems, urls: stemUrls } = useSongStemsUrl(song);

  const availableOrdered = useMemo<StemKey[]>(
    () => STEM_ORDER.filter((s) => availableStems.includes(s)),
    [availableStems],
  );

  const hasSeparatedAudio =
    isSeparationFinished &&
    availableStems.includes('vocals') &&
    availableStems.length >= 2;
  const vocalsStemUrl = stemUrls.vocals ?? null;
  const isPracticeAvailable = hasSeparatedAudio && Boolean(vocalsStemUrl);

  // ---------------------------------------------------------------------------
  // Stem enable / disable helpers
  // ---------------------------------------------------------------------------

  const countEnabled = useCallback(
    (map: Partial<Record<StemKey, boolean>>): number =>
      availableOrdered.reduce((acc, s) => acc + (map[s] !== false ? 1 : 0), 0),
    [availableOrdered],
  );

  /** Sync stemsEnabled whenever the available stem list changes. */
  useEffect(() => {
    if (availableOrdered.length === 0) {
      setStemsEnabled({});
      return;
    }
    setStemsEnabled((prev) => {
      const next: Partial<Record<StemKey, boolean>> = {};
      availableOrdered.forEach((s) => {
        next[s] = prev[s] !== false; // preserve existing choice, default to enabled
      });
      // Guard: never leave every stem disabled
      if (countEnabled(next) === 0 && availableOrdered[0]) {
        next[availableOrdered[0]] = true;
      }
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [availableOrdered.join(',')]);

  const setPreset = useCallback(
    (preset: 'instrumental' | 'vocals' | 'all'): void => {
      setStemsEnabled((prev) => {
        const next: Partial<Record<StemKey, boolean>> = {};
        availableOrdered.forEach((s) => {
          if (preset === 'instrumental') next[s] = s !== 'vocals';
          else if (preset === 'vocals') next[s] = s === 'vocals';
          else next[s] = true;
        });
        return countEnabled(next) === 0 ? prev : next;
      });
    },
    [availableOrdered, countEnabled],
  );

  const handleToggleStem = useCallback(
    (stem: StemKey): void => {
      setStemsEnabled((prev) => {
        const isEnabled = prev[stem] !== false;
        if (isEnabled && countEnabled(prev) <= 1) return prev; // block removing last active
        return { ...prev, [stem]: !isEnabled };
      });
    },
    [countEnabled],
  );

  // ---------------------------------------------------------------------------
  // Mode switch
  // ---------------------------------------------------------------------------

  const handleModeChange = useCallback(
    (
      _event: React.MouseEvent<HTMLElement>,
      value: 'raw' | 'separated' | null,
    ): void => {
      if (!value || value === mode) return;
      setMode(value);
      if (value === 'separated') setPreset('instrumental');
      setPlayer((p) => ({
        ...p,
        isPlaying: true,
        currentTime: 0,
        isSeeking: false,
      }));
    },
    [mode, setPreset],
  );

  // ---------------------------------------------------------------------------
  // Transport handlers
  // ---------------------------------------------------------------------------

  const handleTogglePlay = useCallback((): void => {
    setPlayer((p) => ({ ...p, isPlaying: !p.isPlaying }));
  }, []);

  const handleStop = useCallback((): void => {
    setPlayer((p) => ({ ...p, isPlaying: false, currentTime: 0 }));
    dispatch({ type: 'PLAYER_STOP' });
  }, [dispatch]);

  const handleSeekChange = useCallback(
    (_event: Event, value: number | number[]): void => {
      const nextTime = Array.isArray(value) ? value[0] : value;
      setPlayer((p) => ({ ...p, currentTime: nextTime, isSeeking: true }));
    },
    [],
  );

  const handleSeekCommit = useCallback(
    (_event: React.SyntheticEvent | Event, value: number | number[]): void => {
      const nextTime = Array.isArray(value) ? value[0] : value;
      setPlayer((p) => ({ ...p, currentTime: nextTime, isSeeking: false }));
    },
    [],
  );

  const handleSeekDragging = useCallback((): void => {
    setPlayer((p) => ({ ...p, isSeeking: true }));
  }, []);

  const handleToggleMute = useCallback((): void => {
    setPlayer((p) => ({ ...p, isMuted: !p.isMuted }));
  }, []);

  const handleVolumeChange = useCallback(
    (_event: Event, value: number | number[]): void => {
      const v = Array.isArray(value) ? value[0] : value;
      setPlayer((p) => ({
        ...p,
        volume: v,
        isMuted: v > 0 ? false : p.isMuted,
      }));
    },
    [],
  );

  // ---------------------------------------------------------------------------
  // Separation dialog
  // ---------------------------------------------------------------------------

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

  const handleOpenPractice = useCallback((): void => {
    dispatch({ type: 'PLAYER_STOP' });
    requestPracticeDialogOpen(song.id);
  }, [dispatch, song.id]);

  // ---------------------------------------------------------------------------
  // Derived UI state
  // ---------------------------------------------------------------------------

  const isBusy =
    player.sourceRefreshing || !player.isLoaded || player.isBuffering;
  const controlsDisabled = !player.hasSource || isBusy;

  const playTooltip = isBusy
    ? player.isBuffering
      ? t('bufferingTooltip')
      : t('syncingTooltip')
    : player.isPlaying
      ? t('playTooltipPause')
      : t('playTooltipPlay');

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

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
      {/* Both engines are always mounted; only the active one drives audio. */}
      <RawPlayerEngine
        song={song}
        player={player}
        setPlayer={setPlayer}
        active={mode === 'raw'}
      />
      <SeparatedPlayerEngine
        song={song}
        player={player}
        setPlayer={setPlayer}
        active={mode === 'separated'}
        stemsEnabled={stemsEnabled}
      />

      <CardContent sx={{ p: { xs: 2, sm: 3 }, '&:last-child': { pb: 2 } }}>
        {player.error && (
          <Alert severity="error" sx={{ mb: 2, fontSize: '0.875rem' }}>
            {player.error}
          </Alert>
        )}

        <Stack spacing={2}>
          {/* Song title / author + loading indicator */}
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

            <Tooltip
              title={
                player.isBuffering
                  ? t('bufferingTooltip')
                  : player.sourceRefreshing
                    ? t('syncingTooltip')
                    : undefined
              }
            >
              <CircularProgress
                size={20}
                sx={{
                  color: 'primary.main',
                  visibility: isBusy ? 'visible' : 'hidden',
                }}
              />
            </Tooltip>
          </Box>

          {/* Audio source selector */}
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 2,
            }}
          >
            <Stack direction="row" spacing={1} alignItems="center">
              <GraphicEqIcon fontSize="small" sx={{ color: 'primary.main' }} />
              <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                {t('audioSource')}
              </Typography>
            </Stack>
            <ToggleButtonGroup
              size="small"
              value={mode}
              exclusive
              onChange={handleModeChange}
            >
              <ToggleButton value="raw">{t('rawLabel')}</ToggleButton>
              <Tooltip
                title={
                  !hasSeparatedAudio ? t('separationNotAvailableTooltip') : ''
                }
              >
                <span>
                  <ToggleButton value="separated" disabled={!hasSeparatedAudio}>
                    {t('separatedLabel')}
                  </ToggleButton>
                </span>
              </Tooltip>
            </ToggleButtonGroup>
            {isPracticeAvailable ? (
              <Button
                size="small"
                variant="contained"
                onClick={handleOpenPractice}
                aria-label={tPractice('entryAriaLabel')}
              >
                {tPractice('entryButton')}
              </Button>
            ) : null}
          </Box>

          {/* Main transport row */}
          <Stack direction="row" alignItems="center" spacing={{ xs: 1, sm: 2 }}>
            <Tooltip title={playTooltip}>
              <span>
                <IconButton
                  onClick={handleTogglePlay}
                  disabled={controlsDisabled}
                  aria-label={
                    player.isPlaying ? t('pauseAriaLabel') : t('playAriaLabel')
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
                  {player.isPlaying ? <PauseIcon /> : <PlayArrowIcon />}
                </IconButton>
              </span>
            </Tooltip>

            <Tooltip title={t('stopTooltip')}>
              <span>
                <IconButton
                  onClick={handleStop}
                  disabled={controlsDisabled}
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
                value={Math.min(player.currentTime, player.duration || 0)}
                min={0}
                max={player.duration || 0}
                step={0.01}
                onChange={handleSeekChange}
                onChangeCommitted={handleSeekCommit}
                onMouseDown={handleSeekDragging}
                onTouchStart={handleSeekDragging}
                disabled={controlsDisabled || player.duration <= 0}
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
              {formatTime(player.currentTime)} / {formatTime(player.duration)}
            </Typography>

            <Box
              sx={{
                display: { xs: 'none', sm: 'flex' },
                alignItems: 'center',
                gap: 1,
                minWidth: '120px',
              }}
            >
              <Tooltip
                title={player.isMuted ? t('unmuteTooltip') : t('muteTooltip')}
              >
                <span>
                  <IconButton
                    onClick={handleToggleMute}
                    disabled={controlsDisabled}
                    size="small"
                    aria-label={
                      player.isMuted ? t('unmuteAriaLabel') : t('muteAriaLabel')
                    }
                    sx={{
                      color: 'text.secondary',
                      '&:hover': { color: 'text.primary' },
                    }}
                  >
                    {player.isMuted ? (
                      <VolumeOffIcon fontSize="small" />
                    ) : (
                      <VolumeUpIcon fontSize="small" />
                    )}
                  </IconButton>
                </span>
              </Tooltip>
              <Slider
                value={player.isMuted ? 0 : player.volume}
                min={0}
                max={1}
                step={0.01}
                onChange={handleVolumeChange}
                disabled={controlsDisabled}
                aria-label={t('volumeAriaLabel')}
                sx={{
                  color: 'primary.main',
                  flex: 1,
                  '& .MuiSlider-thumb': { width: 10, height: 10 },
                }}
              />
            </Box>
          </Stack>

          {/* Per-stem selector (separated mode only) */}
          {mode === 'separated' && availableOrdered.length > 0 && (
            <Stack spacing={1}>
              <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                {t('toggleStemsLabel')}
              </Typography>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                {availableOrdered.map((stem) => {
                  const enabled = stemsEnabled[stem] !== false;
                  return (
                    <Chip
                      key={stem}
                      label={t(('stems.' + stem) as Parameters<typeof t>[0])}
                      color={enabled ? 'primary' : 'default'}
                      variant={enabled ? 'filled' : 'outlined'}
                      onClick={() => handleToggleStem(stem)}
                      disabled={controlsDisabled}
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
                    controlsDisabled ||
                    !availableOrdered.some((s) => s !== 'vocals')
                  }
                >
                  {t('presets.instrumental')}
                </Button>
                <Button
                  size="small"
                  variant="outlined"
                  onClick={() => setPreset('vocals')}
                  disabled={
                    controlsDisabled || !availableOrdered.includes('vocals')
                  }
                >
                  {t('presets.vocalsOnly')}
                </Button>
                <Button
                  size="small"
                  variant="outlined"
                  onClick={() => setPreset('all')}
                  disabled={controlsDisabled}
                >
                  {t('presets.allStems')}
                </Button>
              </Stack>
            </Stack>
          )}

          {/* Separation section */}
          <Box sx={{ pt: 2, borderTop: '1px solid rgba(168, 85, 247, 0.2)' }}>
            {!hasSeparatedAudio && (
              <Button
                variant="outlined"
                onClick={() => setIsSeparationDialogOpen(true)}
                fullWidth
                disabled={!player.hasSource || player.sourceRefreshing}
              >
                {t('Separation.startButton')}
              </Button>
            )}

            {hasSeparatedAudio && separation && (
              <Stack spacing={1}>
                <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                  {separation.status === 'finished'
                    ? t('Separation.stemsReady')
                    : separation.status === 'processing'
                      ? `${t('Separation.processing')} (${separation.provider})`
                      : t('Separation.failed', {
                          errorMessage:
                            separation.errorMessage ?? 'Unknown error',
                        })}
                </Typography>
                {separation.status !== 'finished' && (
                  <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
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

      <SeparationDialog
        open={isSeparationDialogOpen}
        onClose={() => setIsSeparationDialogOpen(false)}
        onSuccess={handleSeparationSuccess}
        song={song}
      />

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
