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

import type {
    NormalizedSeparationInfo,
    SeparationStemName,
    Song,
} from '@/lib/api/types';
import { useSongRawUrl } from '@/lib/hooks/useSongRawUrl';
import { useStorageDownloadUrls } from '@/lib/hooks/useStorageDownloadUrls';
import { normalizeSeparationInfo } from '@/lib/separations';
import { useGlobalState } from '@/lib/store';
import { useGlobalStateDispatch } from '@/lib/store/GlobalStateContext';
import { SeparationDialog } from './SeparationDialog';

type PlaybackSource = 'raw' | 'separated';
type StemKey = SeparationStemName;
type TrackId = 'raw' | StemKey;

interface Track {
    id: TrackId;
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

function formatTime(seconds: number): string {
    if (!isFinite(seconds) || seconds < 0) return '0:00';
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.floor(seconds % 60);
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
}

function extractAvailableStems(
    separation: NormalizedSeparationInfo | null,
    stemUrls: Partial<Record<StemKey, string>>,
): StemKey[] {
    if (!separation || separation.status !== 'finished') return [];
    return STEM_ORDER.filter((stem) => Boolean(stemUrls[stem]));
}

function clampTime(target: number, duration: number): number {
    if (!isFinite(target) || target < 0) return 0;
    if (!isFinite(duration) || duration <= 0) return target;
    return Math.min(target, duration);
}

function getAudioDuration(audio: HTMLAudioElement | null): number {
    if (!audio) return Number.NaN;
    return isFinite(audio.duration) ? audio.duration : Number.NaN;
}

export function GlobalPlayer(): React.ReactElement {
    const { currentSongId, songs } = useGlobalState();

    const currentSong = currentSongId
        ? songs.find((song) => song.id === currentSongId)
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
 * Multi-source player that supports:
 * - `raw`: single original track
 * - `separated`: multi-stem playback with a vocals master clock
 *
 * Separated playback keeps all stems aligned to the master time and applies
 * selection by muting non-selected stems instead of rebuilding the stem set.
 */
function GlobalPlayerInner({ song }: GlobalPlayerInnerProps): React.ReactElement {
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

    const hasVocals = availableStems.includes('vocals');
    const hasSeparatedAudio =
        separation?.status === 'finished' &&
        !areStemUrlsLoading &&
        hasVocals &&
        availableStems.length >= 2;

    const [playbackSource, setPlaybackSource] = useState<PlaybackSource>('raw');
    const [selectedStems, setSelectedStems] = useState<StemKey[]>([]);

    const [isPlaying, setIsPlaying] = useState(false);
    const [isBuffering, setIsBuffering] = useState(false);
    const [isSyncing, setIsSyncing] = useState(false);
    const [isSourceSwitching, setIsSourceSwitching] = useState(false);
    const [isMuted, setIsMuted] = useState(false);
    const [volume, setVolume] = useState(1);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [seekingTime, setSeekingTime] = useState<number | null>(null);

    const [isSeparationDialogOpen, setIsSeparationDialogOpen] = useState(false);
    const [separationSuccessMessage, setSeparationSuccessMessage] = useState<
        string | null
    >(null);
    const [showSeparationSuccessSnackbar, setShowSeparationSuccessSnackbar] =
        useState(false);

    const audioMapRef = useRef<Map<TrackId, HTMLAudioElement>>(new Map());

    const playbackSourceRef = useRef<PlaybackSource>('raw');
    const playbackStatusRef = useRef(playbackStatus);
    const isPlayingRef = useRef(false);
    const isMutedRef = useRef(false);
    const volumeRef = useRef(1);
    const currentTimeRef = useRef(0);
    const seekingTimeRef = useRef<number | null>(null);
    const selectedStemsRef = useRef<StemKey[]>([]);

    // Preserves transport continuity while switching between raw and separated
    // sources. The current master time/play state is captured before rebuild and
    // restored after the new source map is created.
    const pendingModeSwitchTimeRef = useRef<number | null>(null);
    const pendingModeSwitchPlayRef = useRef<boolean | null>(null);
    const isSourceSwitchingRef = useRef(false);

    const effectiveSelectedStems = useMemo<StemKey[]>(() => {
        const validSelected = selectedStems.filter((stem) =>
            availableStems.includes(stem),
        );
        if (validSelected.length > 0) return validSelected;

        const instrumental = availableStems.filter((stem) => stem !== 'vocals');
        if (instrumental.length > 0) return instrumental;

        return availableStems;
    }, [availableStems, selectedStems]);

    const audibleTrackIds = useMemo<Set<TrackId>>(() => {
        if (playbackSource === 'raw') return new Set<TrackId>(['raw']);
        return new Set<TrackId>(effectiveSelectedStems);
    }, [effectiveSelectedStems, playbackSource]);

    const tracks = useMemo<Track[]>(() => {
        if (playbackSource === 'raw') {
            return rawUrl ? [{ id: 'raw', src: rawUrl }] : [];
        }

        return STEM_ORDER.flatMap((stem) => {
            const url = stemUrls[stem];
            return url ? [{ id: stem, src: url }] : [];
        });
    }, [playbackSource, rawUrl, stemUrls]);

    const trackKey = useMemo(
        () => tracks.map((track) => `${track.id}:${track.src}`).join('|'),
        [tracks],
    );

    const getMasterTrackId = useCallback(
        (source: PlaybackSource): TrackId => {
            return source === 'raw' ? 'raw' : 'vocals';
        },
        [],
    );

    const getActiveElements = useCallback((): HTMLAudioElement[] => {
        const map = audioMapRef.current;
        if (playbackSourceRef.current === 'raw') {
            const rawAudio = map.get('raw');
            return rawAudio ? [rawAudio] : [];
        }

        return STEM_ORDER.flatMap((stem) => {
            const stemAudio = map.get(stem);
            return stemAudio ? [stemAudio] : [];
        });
    }, []);

    const getMaster = useCallback((): HTMLAudioElement | null => {
        const masterId = getMasterTrackId(playbackSourceRef.current);
        return audioMapRef.current.get(masterId) ?? null;
    }, [getMasterTrackId]);

    const getCurrentModeDuration = useCallback((): number => {
        const master = getMaster();
        const masterDuration = getAudioDuration(master);
        if (isFinite(masterDuration)) return masterDuration;
        return duration;
    }, [duration, getMaster]);

    const applyVolumes = useCallback((): void => {
        const baseVolume = isMutedRef.current ? 0 : volumeRef.current;

        audioMapRef.current.forEach((audio, id) => {
            const isAudible = audibleTrackIds.has(id);
            audio.volume = isAudible ? baseVolume : 0;
        });
    }, [audibleTrackIds]);

    const disposeAllAudio = useCallback((): void => {
        audioMapRef.current.forEach((audio) => {
            audio.pause();
            audio.src = '';
        });
        audioMapRef.current.clear();
    }, []);

    const setLocalPausedState = useCallback((): void => {
        setIsPlaying(false);
        isPlayingRef.current = false;
    }, []);

    const setPausedState = useCallback((): void => {
        setLocalPausedState();
        dispatch({ type: 'PLAYER_SET_STATUS', payload: 'paused' });
    }, [dispatch, setLocalPausedState]);

    const syncSeparatedToMaster = useCallback((): void => {
        if (playbackSourceRef.current !== 'separated') return;
        const master = getMaster();
        if (!master) return;

        const masterTime = master.currentTime;
        getActiveElements().forEach((audio) => {
            if (audio === master) return;
            if (Math.abs(audio.currentTime - masterTime) > 0.01) {
                audio.currentTime = masterTime;
            }
        });
    }, [getActiveElements, getMaster]);

    const waitForTracksReady = useCallback(
        async (elements: HTMLAudioElement[]): Promise<void> => {
            const allReady = elements.every((audio) => audio.readyState >= 3);
            if (allReady) return;

            await new Promise<void>((resolve) => {
                const timeoutId = window.setTimeout(() => {
                    resolve();
                }, 4000);

                let pending = elements.filter((audio) => audio.readyState < 3).length;
                if (pending === 0) {
                    window.clearTimeout(timeoutId);
                    resolve();
                    return;
                }

                const disposers: Array<() => void> = [];

                const finalize = (): void => {
                    disposers.forEach((dispose) => dispose());
                    window.clearTimeout(timeoutId);
                    resolve();
                };

                elements.forEach((audio) => {
                    if (audio.readyState >= 3) return;

                    const handleCanPlay = (): void => {
                        pending -= 1;
                        if (pending <= 0) {
                            finalize();
                        }
                    };

                    audio.addEventListener('canplay', handleCanPlay, { once: true });
                    disposers.push(() => {
                        audio.removeEventListener('canplay', handleCanPlay);
                    });
                });
            });
        },
        [],
    );

    const stabilizeSeparatedAfterPlay = useCallback((): void => {
        if (playbackSourceRef.current !== 'separated') return;

        const runResync = (): void => {
            syncSeparatedToMaster();
            applyVolumes();
        };

        window.requestAnimationFrame(() => {
            runResync();
            window.requestAnimationFrame(() => {
                runResync();
            });
        });
    }, [applyVolumes, syncSeparatedToMaster]);

    const playAll = useCallback(async (): Promise<void> => {
        const elements = getActiveElements();
        if (elements.length === 0) return;

        // For stem mode, only start after all tracks can play and share a common
        // currentTime to avoid audible drift between channels.
        if (playbackSourceRef.current === 'separated') {
            await waitForTracksReady(elements);
            syncSeparatedToMaster();
        }

        setIsSyncing(true);
        try {
            await Promise.all(elements.map((audio) => audio.play()));
            setIsPlaying(true);
            isPlayingRef.current = true;
            dispatch({ type: 'PLAYER_SET_STATUS', payload: 'playing' });
            setIsBuffering(false);

            if (playbackSourceRef.current === 'separated') {
                stabilizeSeparatedAfterPlay();
            }
        } catch {
            setPausedState();
        } finally {
            setIsSyncing(false);
            applyVolumes();

            if (isSourceSwitchingRef.current) {
                isSourceSwitchingRef.current = false;
                setIsSourceSwitching(false);
            }
        }
    }, [
        applyVolumes,
        dispatch,
        getActiveElements,
        setPausedState,
        stabilizeSeparatedAfterPlay,
        syncSeparatedToMaster,
        waitForTracksReady,
    ]);

    const pauseAll = useCallback((): void => {
        getActiveElements().forEach((audio) => {
            audio.pause();
        });
        setLocalPausedState();
        setIsBuffering(false);
        setIsSyncing(false);
    }, [getActiveElements, setLocalPausedState]);

    const seekAll = useCallback(
        async (targetTime: number, resumeAfterSeek: boolean): Promise<void> => {
            const elements = getActiveElements();
            if (elements.length === 0) return;

            const clampedTarget = clampTime(targetTime, getCurrentModeDuration());
            elements.forEach((audio) => {
                try {
                    audio.currentTime = clampedTarget;
                } catch {
                    audio.currentTime = 0;
                }
            });

            if (playbackSourceRef.current === 'separated') {
                syncSeparatedToMaster();
            }

            const master = getMaster();
            const normalizedTime = master ? master.currentTime : clampedTarget;
            setCurrentTime(normalizedTime);
            currentTimeRef.current = normalizedTime;

            if (!resumeAfterSeek) {
                setPausedState();
                return;
            }

            await playAll();
        },
        [
            getActiveElements,
            getCurrentModeDuration,
            getMaster,
            playAll,
            setPausedState,
            syncSeparatedToMaster,
        ],
    );

    const stopAndResetToStart = useCallback((): void => {
        getActiveElements().forEach((audio) => {
            audio.pause();
            try {
                audio.currentTime = 0;
            } catch {
                audio.currentTime = 0;
            }
        });

        setPausedState();
        setCurrentTime(0);
        currentTimeRef.current = 0;
        setSeekingTime(null);
        seekingTimeRef.current = null;
        setIsBuffering(false);
        setIsSyncing(false);
    }, [getActiveElements, setPausedState]);

    useEffect(() => {
        playbackSourceRef.current = playbackSource;
    }, [playbackSource]);

    useEffect(() => {
        playbackStatusRef.current = playbackStatus;
    }, [playbackStatus]);

    useEffect(() => {
        isPlayingRef.current = isPlaying;
    }, [isPlaying]);

    useEffect(() => {
        isMutedRef.current = isMuted;
    }, [isMuted]);

    useEffect(() => {
        volumeRef.current = volume;
    }, [volume]);

    useEffect(() => {
        currentTimeRef.current = currentTime;
    }, [currentTime]);

    useEffect(() => {
        seekingTimeRef.current = seekingTime;
    }, [seekingTime]);

    useEffect(() => {
        selectedStemsRef.current = selectedStems;
    }, [selectedStems]);

    useEffect(() => {
        disposeAllAudio();

        setPlaybackSource('raw');
        playbackSourceRef.current = 'raw';
        setSelectedStems([]);
        selectedStemsRef.current = [];

        setCurrentTime(0);
        currentTimeRef.current = 0;
        setDuration(0);
        setSeekingTime(null);
        seekingTimeRef.current = null;

        setIsMuted(false);
        isMutedRef.current = false;
        setVolume(1);
        volumeRef.current = 1;

        setIsBuffering(false);
        setIsSyncing(false);
        setLocalPausedState();

        pendingModeSwitchTimeRef.current = null;
        pendingModeSwitchPlayRef.current = null;
        isSourceSwitchingRef.current = false;
        setIsSourceSwitching(false);
    }, [disposeAllAudio, setLocalPausedState, song.id]);

    useEffect(() => {
        // Rebuild active audio elements whenever the effective source/URLs change.
        // This is the single place where audio nodes are created and disposed.
        disposeAllAudio();

        if (tracks.length === 0) {
            setLocalPausedState();
            setCurrentTime(0);
            currentTimeRef.current = 0;
            setDuration(0);
            setIsBuffering(false);
            setIsSyncing(false);
            return;
        }

        const map = new Map<TrackId, HTMLAudioElement>();
        const masterId = getMasterTrackId(playbackSourceRef.current);

        tracks.forEach((track) => {
            const audio = document.createElement('audio');
            audio.preload = 'auto';
            audio.src = track.src;

            if (track.id === masterId) {
                audio.addEventListener('timeupdate', () => {
                    if (seekingTimeRef.current !== null) return;
                    setCurrentTime(audio.currentTime);
                });

                audio.addEventListener('durationchange', () => {
                    if (isFinite(audio.duration)) {
                        setDuration(audio.duration);
                    }
                });

                audio.addEventListener('loadedmetadata', () => {
                    if (isFinite(audio.duration)) {
                        setDuration(audio.duration);
                    }
                });

                audio.addEventListener('waiting', () => {
                    if (!isPlayingRef.current) return;
                    setIsBuffering(true);
                });

                audio.addEventListener('stalled', () => {
                    if (!isPlayingRef.current) return;
                    setIsBuffering(true);
                });

                audio.addEventListener('playing', () => {
                    setIsBuffering(false);
                    if (playbackSourceRef.current === 'separated') {
                        syncSeparatedToMaster();
                    }
                    applyVolumes();
                });

                audio.addEventListener('ended', () => {
                    stopAndResetToStart();
                });
            }

            map.set(track.id, audio);
        });

        audioMapRef.current = map;
        applyVolumes();

        const requestedStartTime =
            pendingModeSwitchTimeRef.current ?? currentTimeRef.current;
        const normalizedStartTime = clampTime(requestedStartTime, duration);

        getActiveElements().forEach((audio) => {
            try {
                audio.currentTime = normalizedStartTime;
            } catch {
                audio.currentTime = 0;
            }
        });

        const master = getMaster();
        const safeStartTime = master ? master.currentTime : normalizedStartTime;
        setCurrentTime(safeStartTime);
        currentTimeRef.current = safeStartTime;

        const shouldResume =
            pendingModeSwitchPlayRef.current ??
            playbackStatusRef.current === 'loading';
        pendingModeSwitchTimeRef.current = null;
        pendingModeSwitchPlayRef.current = null;

        if (shouldResume) {
            void playAll();
        } else if (isSourceSwitchingRef.current) {
            isSourceSwitchingRef.current = false;
            setIsSourceSwitching(false);
        }

        return () => {
            map.forEach((audio) => {
                audio.pause();
                audio.src = '';
            });
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [trackKey]);

    useEffect(() => {
        applyVolumes();
    }, [applyVolumes]);

    useEffect(() => {
        if (playbackStatus !== 'loading') return;
        void seekAll(0, true);
    }, [playbackStatus, seekAll]);

    useEffect(() => {
        const handleVisibilityChange = (): void => {
            if (document.hidden) return;

            const master = getMaster();
            if (!master) return;

            setCurrentTime(master.currentTime);

            if (playbackSourceRef.current === 'separated') {
                syncSeparatedToMaster();
            }

            if (isPlayingRef.current) {
                void playAll();
            }
        };

        document.addEventListener('visibilitychange', handleVisibilityChange);
        return () => {
            document.removeEventListener('visibilitychange', handleVisibilityChange);
        };
    }, [getMaster, playAll, syncSeparatedToMaster]);

    const togglePlay = useCallback(async (): Promise<void> => {
        if (isSyncing || isBuffering || isSourceSwitching) return;
        if (tracks.length === 0) return;

        if (isPlayingRef.current) {
            pauseAll();
            return;
        }

        await playAll();
    }, [isBuffering, isSourceSwitching, isSyncing, pauseAll, playAll, tracks.length]);

    const handleStop = useCallback((): void => {
        stopAndResetToStart();
        dispatch({ type: 'PLAYER_STOP' });
    }, [dispatch, stopAndResetToStart]);

    const handleSeekChange = useCallback(
        (_event: Event, value: number | number[]): void => {
            const nextTime = Array.isArray(value) ? value[0] : value;
            setSeekingTime(nextTime);
        },
        [],
    );

    const handleSeekCommit = useCallback(
        async (
            _event: React.SyntheticEvent | Event,
            value: number | number[],
        ): Promise<void> => {
            const nextTime = Array.isArray(value) ? value[0] : value;
            setSeekingTime(null);
            seekingTimeRef.current = null;
            await seekAll(nextTime, isPlayingRef.current);
        },
        [seekAll],
    );

    const toggleMute = useCallback((): void => {
        setIsMuted((previousValue) => !previousValue);
    }, []);

    const handleVolumeChange = useCallback(
        (_event: Event, value: number | number[]): void => {
            const nextVolume = Array.isArray(value) ? value[0] : value;
            setVolume(nextVolume);
            if (nextVolume > 0) {
                setIsMuted(false);
            }
        },
        [],
    );

    const handleSelectSource = useCallback(
        (
            _event: React.MouseEvent<HTMLElement>,
            value: PlaybackSource | null,
        ): void => {
            if (!value || value === playbackSource || isSourceSwitchingRef.current) {
                return;
            }

            isSourceSwitchingRef.current = true;
            setIsSourceSwitching(true);

            const currentMaster = getMaster();
            const currentMasterTime = currentMaster
                ? currentMaster.currentTime
                : currentTimeRef.current;

            pendingModeSwitchTimeRef.current = currentMasterTime;
            pendingModeSwitchPlayRef.current = isPlayingRef.current;

            pauseAll();
            setPlaybackSource(value);
        },
        [getMaster, pauseAll, playbackSource],
    );

    const toggleStem = useCallback((stem: StemKey): void => {
        if (isSourceSwitchingRef.current) return;

        setSelectedStems((previousStems) => {
            if (previousStems.includes(stem)) {
                if (previousStems.length === 1) return previousStems;
                return previousStems.filter((selectedStem) => selectedStem !== stem);
            }
            return [...previousStems, stem];
        });
    }, []);

    const setPreset = useCallback(
        (preset: 'vocals' | 'instrumental' | 'all'): void => {
            if (isSourceSwitchingRef.current) return;

            if (preset === 'vocals') {
                setSelectedStems(availableStems.includes('vocals') ? ['vocals'] : []);
                return;
            }

            if (preset === 'instrumental') {
                const instrumental = availableStems.filter((stem) => stem !== 'vocals');
                if (instrumental.length > 0) {
                    setSelectedStems(instrumental);
                }
                return;
            }

            setSelectedStems(availableStems);
        },
        [availableStems],
    );

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

    const isPlayerReady = tracks.length > 0;
    const isLoading = isRawRefreshing || playbackStatus === 'loading';
    const isPlayerInteractionLocked =
        isLoading || isBuffering || isSyncing || isSourceSwitching;

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

                        {(isLoading || isBuffering || isSyncing || isSourceSwitching) && (
                            <Tooltip
                                title={
                                    isSyncing || isSourceSwitching
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
                                disabled={isSyncing || isSourceSwitching}
                            >
                                <ToggleButton value="raw">{t('rawLabel')}</ToggleButton>
                                <ToggleButton value="separated">
                                    {t('separatedLabel')}
                                </ToggleButton>
                            </ToggleButtonGroup>
                        </Box>
                    )}

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
                                    disabled={!isPlayerReady || isPlayerInteractionLocked}
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
                                    disabled={!isPlayerReady || isPlayerInteractionLocked}
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
                                    isPlayerInteractionLocked ||
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
                                        disabled={isPlayerInteractionLocked}
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
                                disabled={isPlayerInteractionLocked}
                                aria-label={t('volumeAriaLabel')}
                                sx={{
                                    color: 'primary.main',
                                    flex: 1,
                                    '& .MuiSlider-thumb': { width: 10, height: 10 },
                                }}
                            />
                        </Box>
                    </Stack>

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
                                            disabled={isPlayerInteractionLocked}
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
                                        isPlayerInteractionLocked ||
                                        !availableStems.some((stem) => stem !== 'vocals')
                                    }
                                >
                                    {t('presets.instrumental')}
                                </Button>
                                <Button
                                    size="small"
                                    variant="outlined"
                                    onClick={() => setPreset('vocals')}
                                    disabled={
                                        isPlayerInteractionLocked ||
                                        !availableStems.includes('vocals')
                                    }
                                >
                                    {t('presets.vocalsOnly')}
                                </Button>
                                <Button
                                    size="small"
                                    variant="outlined"
                                    onClick={() => setPreset('all')}
                                    disabled={isPlayerInteractionLocked}
                                >
                                    {t('presets.allStems')}
                                </Button>
                            </Stack>
                        </Stack>
                    )}

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
                                disabled={!isPlayerReady || isPlayerInteractionLocked}
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