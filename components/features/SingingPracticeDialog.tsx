'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  FormControl,
  IconButton,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  Switch,
  Typography,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import PauseIcon from '@mui/icons-material/Pause';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import { useTranslations } from 'next-intl';

import type { SeparationStemName, Song } from '@/lib/api/types';
import { useStorageDownloadUrls } from '@/lib/hooks/useStorageDownloadUrls';

const DEFAULT_WINDOW_SECONDS = 30;
const DEFAULT_VISIBLE_RANGE_SEMITONES = 12;
const HYSTERESIS_MARGIN_SEMITONES = 1;
const SAMPLE_INTERVAL_MS = 30;
const PITCH_RMS_THRESHOLD = 0.006;
const PITCH_CORRELATION_THRESHOLD = 0.65;
const MIN_FREQUENCY_HZ = 60;
const MAX_FREQUENCY_HZ = 1100;
const MIN_VISIBLE_MIDI = 36; // C2
const MAX_VISIBLE_MIDI = 84; // C6
const DOWNSAMPLE_FACTOR = 2;

// Smoothing controls for the practice curve.
const MEDIAN_WINDOW_SIZE = 9;
const EMA_ALPHA = 0.35;
const MAX_SEMITONES_PER_SAMPLE = 1.2;
const GAP_HOLD_SAMPLES = 2;
const MAX_PITCH_HISTORY_SAMPLES = 32;

interface PitchPoint {
  time: number;
  midi: number | null;
}

interface PracticeReadout {
  noteLabel: string | null;
  cents: number | null;
}

interface SingingPracticeDialogProps {
  open: boolean;
  onClose: () => void;
  song: Song;
  vocalsUrl: string | null;
  isEligible: boolean;
}

const NOTE_NAMES = [
  'C',
  'C#',
  'D',
  'D#',
  'E',
  'F',
  'F#',
  'G',
  'G#',
  'A',
  'A#',
  'B',
] as const;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function getCenterBounds(visibleRangeSemitones: number): {
  minCenter: number;
  maxCenter: number;
} {
  const halfRange = visibleRangeSemitones / 2;
  const minCenter = MIN_VISIBLE_MIDI + halfRange;
  const maxCenter = MAX_VISIBLE_MIDI - halfRange;

  if (minCenter > maxCenter) {
    const center = (MIN_VISIBLE_MIDI + MAX_VISIBLE_MIDI) / 2;
    return { minCenter: center, maxCenter: center };
  }

  return { minCenter, maxCenter };
}

function frequencyToMidi(frequency: number): number {
  return 69 + 12 * Math.log2(frequency / 440);
}

function midiToNoteLabel(midi: number): string {
  const rounded = Math.round(midi);
  const note = NOTE_NAMES[((rounded % 12) + 12) % 12];
  const octave = Math.floor(rounded / 12) - 1;
  return `${note}${octave}`;
}

function exponentialMovingAverage(
  previous: number | null,
  value: number,
): number {
  if (previous === null) {
    return value;
  }

  return EMA_ALPHA * value + (1 - EMA_ALPHA) * previous;
}

function limitPitchDelta(currentValue: number, previousValue: number): number {
  const delta = currentValue - previousValue;
  if (Math.abs(delta) <= MAX_SEMITONES_PER_SAMPLE) {
    return currentValue;
  }

  return previousValue + Math.sign(delta) * MAX_SEMITONES_PER_SAMPLE;
}

function appendPitchHistory(history: number[], value: number | null): void {
  history.push(value ?? Number.NaN);

  if (history.length > MAX_PITCH_HISTORY_SAMPLES) {
    history.shift();
  }
}

function getMedianFromRecentValid(
  history: number[],
  windowSize: number,
): number | null {
  const recentValid = history
    .slice(-windowSize)
    .filter((item) => Number.isFinite(item));

  if (recentValid.length === 0) {
    return null;
  }

  recentValid.sort((a, b) => a - b);
  return recentValid[Math.floor(recentValid.length / 2)] ?? null;
}

function detectPitchFromFrame(
  frame: Float32Array<ArrayBuffer>,
  sampleRate: number,
): number | null {
  const downsampledLength = Math.floor(frame.length / DOWNSAMPLE_FACTOR);
  if (downsampledLength < 64) {
    return null;
  }

  const downsampled = new Float32Array(downsampledLength);
  for (let i = 0; i < downsampledLength; i += 1) {
    downsampled[i] = frame[i * DOWNSAMPLE_FACTOR] ?? 0;
  }

  let rms = 0;
  for (let i = 0; i < downsampledLength; i += 1) {
    rms += downsampled[i] * downsampled[i];
  }
  rms = Math.sqrt(rms / downsampledLength);

  if (!isFinite(rms) || rms < PITCH_RMS_THRESHOLD) {
    return null;
  }

  const minLag = Math.floor(sampleRate / MAX_FREQUENCY_HZ / DOWNSAMPLE_FACTOR);
  const maxLag = Math.floor(sampleRate / MIN_FREQUENCY_HZ / DOWNSAMPLE_FACTOR);

  let bestLag = -1;
  let bestCorrelation = 0;

  for (let lag = minLag; lag <= maxLag; lag += 1) {
    let sum = 0;
    let energyA = 0;
    let energyB = 0;

    for (let i = 0; i < downsampledLength - lag; i += 1) {
      const a = downsampled[i];
      const b = downsampled[i + lag];
      sum += a * b;
      energyA += a * a;
      energyB += b * b;
    }

    const denom = Math.sqrt(energyA * energyB);
    const correlation = denom > 0 ? sum / denom : 0;

    if (correlation > bestCorrelation) {
      bestCorrelation = correlation;
      bestLag = lag;
    }
  }

  if (bestLag <= 0 || bestCorrelation < PITCH_CORRELATION_THRESHOLD) {
    return null;
  }

  const frequency = sampleRate / DOWNSAMPLE_FACTOR / bestLag;
  if (
    !isFinite(frequency) ||
    frequency < MIN_FREQUENCY_HZ ||
    frequency > MAX_FREQUENCY_HZ
  ) {
    return null;
  }

  return frequency;
}

function drawPracticeCanvas(
  canvas: HTMLCanvasElement,
  points: PitchPoint[],
  currentTime: number,
  centerMidi: number,
  timeWindowSeconds: number,
  visibleRangeSemitones: number,
  showNoteLabels: boolean,
): void {
  const context = canvas.getContext('2d');
  if (!context) return;

  const dpr = window.devicePixelRatio || 1;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;

  if (canvas.width !== Math.floor(width * dpr)) {
    canvas.width = Math.floor(width * dpr);
  }
  if (canvas.height !== Math.floor(height * dpr)) {
    canvas.height = Math.floor(height * dpr);
  }

  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  context.clearRect(0, 0, width, height);

  context.fillStyle = 'rgba(10, 5, 32, 0.9)';
  context.fillRect(0, 0, width, height);

  const minTime = currentTime - timeWindowSeconds;
  const minMidi = centerMidi - visibleRangeSemitones / 2;
  const maxMidi = centerMidi + visibleRangeSemitones / 2;

  const xFromTime = (time: number): number =>
    ((time - minTime) / timeWindowSeconds) * width;
  const yFromMidi = (midi: number): number =>
    height - ((midi - minMidi) / visibleRangeSemitones) * height;

  for (
    let midiLine = Math.floor(minMidi);
    midiLine <= Math.ceil(maxMidi);
    midiLine += 1
  ) {
    const y = yFromMidi(midiLine);
    context.strokeStyle = 'rgba(168, 85, 247, 0.18)';
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(0, y);
    context.lineTo(width, y);
    context.stroke();

    if (showNoteLabels) {
      context.fillStyle = 'rgba(226, 232, 240, 0.85)';
      context.font = '12px sans-serif';
      context.fillText(midiToNoteLabel(midiLine), 8, y - 4);
    }
  }

  const visiblePoints = points.filter((point) => point.time >= minTime - 0.5);

  context.strokeStyle = 'rgba(129, 140, 248, 0.95)';
  context.lineWidth = 2;
  context.beginPath();

  let hasPath = false;
  for (let i = 0; i < visiblePoints.length; i += 1) {
    const point = visiblePoints[i];
    if (point.midi === null) {
      hasPath = false;
      continue;
    }

    const x = xFromTime(point.time);
    const y = yFromMidi(point.midi);

    if (!hasPath) {
      context.moveTo(x, y);
      hasPath = true;
    } else {
      context.lineTo(x, y);
    }
  }
  context.stroke();

  context.strokeStyle = 'rgba(244, 114, 182, 0.5)';
  context.lineWidth = 1;
  visiblePoints
    .filter((point) => point.midi === null)
    .forEach((point) => {
      const x = xFromTime(point.time);
      context.beginPath();
      context.moveTo(x, height - 12);
      context.lineTo(x, height - 2);
      context.stroke();
    });

  context.strokeStyle = 'rgba(236, 72, 153, 0.8)';
  context.setLineDash([4, 4]);
  const currentX = xFromTime(currentTime);
  context.beginPath();
  context.moveTo(currentX, 0);
  context.lineTo(currentX, height);
  context.stroke();
  context.setLineDash([]);
}

export function SingingPracticeDialog({
  open,
  onClose,
  song,
  vocalsUrl,
  isEligible,
}: SingingPracticeDialogProps): React.ReactElement {
  const t = useTranslations('Practice');

  const [windowSeconds, setWindowSeconds] = useState<number>(
    DEFAULT_WINDOW_SECONDS,
  );
  const [visibleRangeSemitones, setVisibleRangeSemitones] = useState<number>(
    DEFAULT_VISIBLE_RANGE_SEMITONES,
  );
  const [isPracticePlaying, setIsPracticePlaying] = useState(true);
  const [isInstrumentalEnabled, setIsInstrumentalEnabled] = useState(true);
  const [isDynamicAxis, setIsDynamicAxis] = useState(true);
  const [showNoteLabels, setShowNoteLabels] = useState(true);
  const [readout, setReadout] = useState<PracticeReadout>({
    noteLabel: null,
    cents: null,
  });
  const [isAudioLoaded, setIsAudioLoaded] = useState(false);
  const [blockedSourceKey, setBlockedSourceKey] = useState<string | null>(null);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const backingAudioRefs = useRef<HTMLAudioElement[]>([]);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const backingGainRef = useRef<GainNode | null>(null);
  const frameRef = useRef<Float32Array<ArrayBuffer> | null>(null);
  const pointsRef = useRef<PitchPoint[]>([]);
  const centerMidiRef = useRef(60);
  const lastSampleAtRef = useRef(0);
  const pitchHistoryRef = useRef<number[]>([]);
  const emaPitchRef = useRef<number | null>(null);
  const lastSmoothedPitchRef = useRef<number | null>(null);
  const gapSamplesRef = useRef(0);
  const instrumentalEnabledRef = useRef(isInstrumentalEnabled);

  const stemPaths = useMemo(
    () => song.separatedSongInfo?.stems?.paths ?? null,
    [song.separatedSongInfo?.stems?.paths],
  );

  const { urls: stemUrls } = useStorageDownloadUrls(stemPaths);

  const resolvedVocalsUrl = useMemo(
    () => vocalsUrl ?? stemUrls.vocals ?? null,
    [vocalsUrl, stemUrls.vocals],
  );

  const backingStemUrls = useMemo(
    () =>
      (Object.entries(stemUrls) as Array<[SeparationStemName, string]>).reduce<
        string[]
      >((acc, [stem, url]) => {
        if (!url || stem === 'vocals') {
          return acc;
        }

        acc.push(url);
        return acc;
      }, []),
    [stemUrls],
  );

  const analysisSourceKey = useMemo((): string | null => {
    if (!resolvedVocalsUrl || !isEligible || !open) {
      return null;
    }

    return `${song.id}|${resolvedVocalsUrl}|${backingStemUrls.join('|')}`;
  }, [backingStemUrls, isEligible, open, resolvedVocalsUrl, song.id]);

  const isAnalysisBlockedByCors =
    analysisSourceKey !== null && blockedSourceKey === analysisSourceKey;

  useEffect(() => {
    if (!open || !isEligible) {
      return;
    }

    const { minCenter, maxCenter } = getCenterBounds(visibleRangeSemitones);
    centerMidiRef.current = clamp(centerMidiRef.current, minCenter, maxCenter);
    pointsRef.current = [];
    pitchHistoryRef.current = [];
    emaPitchRef.current = null;
    lastSmoothedPitchRef.current = null;
    gapSamplesRef.current = 0;
    lastSampleAtRef.current = 0;
  }, [open, isEligible, visibleRangeSemitones]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const { minCenter, maxCenter } = getCenterBounds(visibleRangeSemitones);
    let attachedCanvas: HTMLCanvasElement | null = null;
    let animationFrameId = 0;

    const handleWheel = (event: WheelEvent): void => {
      if (isDynamicAxis) {
        return;
      }

      event.preventDefault();
      const rawDelta = event.deltaY * 0.03;
      const semitoneDelta =
        Math.sign(rawDelta) * clamp(Math.abs(rawDelta), 0.35, 3);
      centerMidiRef.current = clamp(
        centerMidiRef.current + semitoneDelta,
        minCenter,
        maxCenter,
      );
    };

    const attachWheel = (): void => {
      const canvas = canvasRef.current;
      if (!canvas) {
        animationFrameId = window.requestAnimationFrame(attachWheel);
        return;
      }

      attachedCanvas = canvas;
      attachedCanvas.addEventListener('wheel', handleWheel, {
        passive: false,
      });
    };

    attachWheel();

    return () => {
      window.cancelAnimationFrame(animationFrameId);
      if (attachedCanvas) {
        attachedCanvas.removeEventListener('wheel', handleWheel);
      }
    };
  }, [isDynamicAxis, open, visibleRangeSemitones]);

  useEffect(() => {
    const { minCenter, maxCenter } = getCenterBounds(visibleRangeSemitones);
    centerMidiRef.current = clamp(centerMidiRef.current, minCenter, maxCenter);
  }, [visibleRangeSemitones]);

  useEffect(() => {
    if (!open || !resolvedVocalsUrl || !isEligible) {
      return;
    }

    const createAudioElement = (src: string): HTMLAudioElement => {
      const element = new Audio();
      element.crossOrigin = 'anonymous';
      element.src = src;
      element.preload = 'auto';
      element.muted = false;
      element.volume = 1;
      element.setAttribute('playsinline', 'true');
      return element;
    };

    const audioElement = createAudioElement(resolvedVocalsUrl);
    const backingElements = backingStemUrls.map((url) =>
      createAudioElement(url),
    );

    // Keep media element at normal gain so analyser and monitor output
    // always receive the same signal from the source.
    audioRef.current = audioElement;
    backingAudioRefs.current = backingElements;

    const context = new AudioContext();
    const analyser = context.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.1;

    const vocalsSource = context.createMediaElementSource(audioElement);
    const backingGain = context.createGain();
    backingGain.gain.value = instrumentalEnabledRef.current ? 1 : 0;

    const backingSources = backingElements.map((element) =>
      context.createMediaElementSource(element),
    );

    vocalsSource.connect(analyser);
    vocalsSource.connect(context.destination);
    backingSources.forEach((source) => {
      source.connect(backingGain);
    });
    backingGain.connect(context.destination);

    const handleAudioError = (): void => {
      if (analysisSourceKey !== null) {
        setBlockedSourceKey(analysisSourceKey);
      }
    };

    const handleCanPlay = (): void => {
      setBlockedSourceKey((currentKey) =>
        currentKey === analysisSourceKey ? null : currentKey,
      );
      setIsAudioLoaded(true);
    };

    const handleEnded = (): void => {
      setIsPracticePlaying(false);
      backingElements.forEach((element) => {
        element.pause();
      });
    };

    audioElement.addEventListener('error', handleAudioError);
    audioElement.addEventListener('canplay', handleCanPlay);
    audioElement.addEventListener('ended', handleEnded);

    audioContextRef.current = context;
    analyserRef.current = analyser;
    backingGainRef.current = backingGain;
    frameRef.current = new Float32Array(
      analyser.fftSize,
    ) as Float32Array<ArrayBuffer>;

    return () => {
      audioElement.removeEventListener('error', handleAudioError);
      audioElement.removeEventListener('canplay', handleCanPlay);
      audioElement.removeEventListener('ended', handleEnded);
      audioElement.pause();
      audioElement.removeAttribute('src');
      backingElements.forEach((element) => {
        element.pause();
        element.removeAttribute('src');
      });

      try {
        audioElement.load();
      } catch {
        // no-op
      }

      backingElements.forEach((element) => {
        try {
          element.load();
        } catch {
          // no-op
        }
      });

      void context.close();

      analyserRef.current = null;
      backingGainRef.current = null;
      frameRef.current = null;
      audioRef.current = null;
      backingAudioRefs.current = [];
      audioContextRef.current = null;
      pointsRef.current = [];
      pitchHistoryRef.current = [];
      emaPitchRef.current = null;
      lastSmoothedPitchRef.current = null;
      gapSamplesRef.current = 0;
      setReadout({ noteLabel: null, cents: null });
      centerMidiRef.current = 60;
      setIsAudioLoaded(false);
    };
  }, [analysisSourceKey, open, resolvedVocalsUrl, isEligible, backingStemUrls]);

  useEffect(() => {
    instrumentalEnabledRef.current = isInstrumentalEnabled;

    const backingGain = backingGainRef.current;
    if (!backingGain) {
      return;
    }

    backingGain.gain.value = isInstrumentalEnabled ? 1 : 0;
  }, [isInstrumentalEnabled]);

  useEffect(() => {
    if (!open || !isEligible || !resolvedVocalsUrl) {
      return;
    }

    let animationFrameId = 0;

    const syncAndDraw = (): void => {
      const audioElement = audioRef.current;
      const backingElements = backingAudioRefs.current;
      const analyser = analyserRef.current;
      const frame = frameRef.current;
      const canvas = canvasRef.current;

      if (audioElement) {
        if (isPracticePlaying) {
          const context = audioContextRef.current;
          if (context && context.state === 'suspended') {
            void context.resume();
          }

          if (audioElement.paused) {
            void audioElement.play().catch(() => undefined);
          }

          backingElements.forEach((element) => {
            if (element.paused) {
              void element.play().catch(() => undefined);
            }
          });
        } else if (!audioElement.paused) {
          audioElement.pause();
          backingElements.forEach((element) => {
            if (!element.paused) {
              element.pause();
            }
          });
        }

        backingElements.forEach((element) => {
          const drift = Math.abs(
            element.currentTime - audioElement.currentTime,
          );
          if (drift > 0.08) {
            try {
              element.currentTime = audioElement.currentTime;
            } catch {
              // no-op
            }
          }
        });
      }

      if (audioElement && analyser && frame) {
        const now = performance.now();
        if (now - lastSampleAtRef.current >= SAMPLE_INTERVAL_MS) {
          lastSampleAtRef.current = now;

          analyser.getFloatTimeDomainData(frame);
          if (isAnalysisBlockedByCors) {
            animationFrameId = window.requestAnimationFrame(syncAndDraw);
            return;
          }

          const frequency = detectPitchFromFrame(
            frame,
            analyser.context.sampleRate,
          );

          const rawMidi =
            frequency !== null ? frequencyToMidi(frequency) : null;

          appendPitchHistory(pitchHistoryRef.current, rawMidi);

          const medianMidi = getMedianFromRecentValid(
            pitchHistoryRef.current,
            MEDIAN_WINDOW_SIZE,
          );

          let smoothedMidi: number | null = null;

          if (medianMidi !== null) {
            const emaMidi = exponentialMovingAverage(
              emaPitchRef.current,
              medianMidi,
            );

            smoothedMidi =
              lastSmoothedPitchRef.current !== null
                ? limitPitchDelta(emaMidi, lastSmoothedPitchRef.current)
                : emaMidi;

            emaPitchRef.current = emaMidi;
            lastSmoothedPitchRef.current = smoothedMidi;
            gapSamplesRef.current = 0;
          } else {
            gapSamplesRef.current += 1;
            if (
              gapSamplesRef.current <= GAP_HOLD_SAMPLES &&
              lastSmoothedPitchRef.current !== null
            ) {
              smoothedMidi = lastSmoothedPitchRef.current;
            } else {
              smoothedMidi = null;
              emaPitchRef.current = null;
            }
          }

          if (smoothedMidi !== null && isDynamicAxis) {
            const { minCenter, maxCenter } = getCenterBounds(
              visibleRangeSemitones,
            );
            const hysteresisMargin = clamp(
              visibleRangeSemitones * 0.2,
              HYSTERESIS_MARGIN_SEMITONES,
              3,
            );
            const upperBoundary =
              centerMidiRef.current + visibleRangeSemitones / 2;
            const lowerBoundary =
              centerMidiRef.current - visibleRangeSemitones / 2;

            if (smoothedMidi > upperBoundary - hysteresisMargin) {
              centerMidiRef.current =
                smoothedMidi - (visibleRangeSemitones / 2 - hysteresisMargin);
            } else if (smoothedMidi < lowerBoundary + hysteresisMargin) {
              centerMidiRef.current =
                smoothedMidi + (visibleRangeSemitones / 2 - hysteresisMargin);
            }

            centerMidiRef.current = clamp(
              centerMidiRef.current,
              minCenter,
              maxCenter,
            );
          }

          if (smoothedMidi !== null) {
            const nearestMidi = Math.round(smoothedMidi);
            const cents = Math.round((smoothedMidi - nearestMidi) * 100);
            setReadout({
              noteLabel: midiToNoteLabel(smoothedMidi),
              cents,
            });
          } else {
            setReadout({ noteLabel: null, cents: null });
          }

          pointsRef.current.push({
            time: audioElement.currentTime,
            midi: smoothedMidi,
          });

          const minHistoryTime = audioElement.currentTime - windowSeconds * 1.5;
          pointsRef.current = pointsRef.current.filter(
            (point) => point.time >= minHistoryTime,
          );
        }
      }

      if (canvas && audioElement) {
        drawPracticeCanvas(
          canvas,
          pointsRef.current,
          audioElement.currentTime,
          centerMidiRef.current,
          windowSeconds,
          visibleRangeSemitones,
          showNoteLabels,
        );
      }

      animationFrameId = window.requestAnimationFrame(syncAndDraw);
    };

    animationFrameId = window.requestAnimationFrame(syncAndDraw);

    return () => {
      window.cancelAnimationFrame(animationFrameId);
    };
  }, [
    open,
    isEligible,
    isDynamicAxis,
    showNoteLabels,
    resolvedVocalsUrl,
    windowSeconds,
    visibleRangeSemitones,
    analysisSourceKey,
    isAnalysisBlockedByCors,
    isPracticePlaying,
  ]);

  const statusLabel = useMemo((): string => {
    if (isAnalysisBlockedByCors) {
      return t('status.corsBlocked');
    }

    if (!isAudioLoaded) {
      return t('status.syncing');
    }

    if (!isPracticePlaying) {
      return t('status.waitingPlayback');
    }

    if (readout.noteLabel === null) {
      return t('status.unvoiced');
    }

    return t('status.analyzing');
  }, [
    isAnalysisBlockedByCors,
    isAudioLoaded,
    isPracticePlaying,
    readout.noteLabel,
    t,
  ]);

  const handleTogglePracticePlayback = async (): Promise<void> => {
    const nextPlaying = !isPracticePlaying;
    setIsPracticePlaying(nextPlaying);

    const context = audioContextRef.current;
    const audioElement = audioRef.current;

    try {
      if (context && context.state === 'suspended') {
        await context.resume();
      }

      if (audioElement && nextPlaying && audioElement.paused) {
        await audioElement.play();
      }
    } catch {
      // no-op
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullScreen
      aria-label={t('dialogAriaLabel')}
    >
      <Box
        sx={{
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          bgcolor: 'background.default',
        }}
      >
        <Stack
          direction="row"
          alignItems="center"
          justifyContent="space-between"
          sx={{
            px: { xs: 2, md: 4 },
            py: 2,
            borderBottom: '1px solid rgba(124, 58, 237, 0.3)',
            bgcolor: 'background.paper',
          }}
        >
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="h5" sx={{ fontWeight: 700 }}>
              {t('title')}
            </Typography>
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              {song.title} - {song.author}
            </Typography>
          </Box>

          <IconButton onClick={onClose} aria-label={t('closeAriaLabel')}>
            <CloseIcon />
          </IconButton>
        </Stack>

        <Box
          sx={{
            px: { xs: 2, md: 4 },
            py: 2,
            borderBottom: '1px solid rgba(124, 58, 237, 0.2)',
            display: 'flex',
            flexDirection: 'column',
            gap: 1.5,
          }}
        >
          <Box
            sx={{
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              gap: 1.5,
            }}
          >
            <Chip label={statusLabel} color="primary" variant="outlined" />

            <Button
              variant="outlined"
              size="small"
              onClick={handleTogglePracticePlayback}
              startIcon={isPracticePlaying ? <PauseIcon /> : <PlayArrowIcon />}
              aria-label={
                isPracticePlaying
                  ? t('pauseButtonAriaLabel')
                  : t('playButtonAriaLabel')
              }
            >
              {isPracticePlaying ? t('pauseButton') : t('playButton')}
            </Button>

            <Stack direction="row" spacing={1.5} alignItems="center">
              <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                {t('currentNoteLabel')}
              </Typography>
              <Typography variant="body1" sx={{ fontWeight: 600 }}>
                {readout.noteLabel ?? t('noPitch')}
              </Typography>
            </Stack>

            <Stack direction="row" spacing={1.5} alignItems="center">
              <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                {t('currentDeviationLabel')}
              </Typography>
              <Typography variant="body1" sx={{ fontWeight: 600 }}>
                {readout.cents === null
                  ? t('noDeviation')
                  : `${readout.cents > 0 ? '+' : ''}${readout.cents}c`}
              </Typography>
            </Stack>
          </Box>

          <Box
            sx={{
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              gap: 1.5,
            }}
          >
            <FormControl size="small" sx={{ minWidth: 140 }}>
              <InputLabel id="practice-window-label">
                {t('controls.window')}
              </InputLabel>
              <Select
                labelId="practice-window-label"
                value={windowSeconds}
                label={t('controls.window')}
                onChange={(event) => {
                  setWindowSeconds(event.target.value as number);
                }}
              >
                <MenuItem value={15}>{t('controls.window15')}</MenuItem>
                <MenuItem value={30}>{t('controls.window30')}</MenuItem>
                <MenuItem value={45}>{t('controls.window45')}</MenuItem>
              </Select>
            </FormControl>

            <FormControl size="small" sx={{ minWidth: 160 }}>
              <InputLabel id="practice-vertical-window-label">
                {t('controls.verticalWindow')}
              </InputLabel>
              <Select
                labelId="practice-vertical-window-label"
                value={visibleRangeSemitones}
                label={t('controls.verticalWindow')}
                onChange={(event) => {
                  setVisibleRangeSemitones(event.target.value as number);
                }}
              >
                <MenuItem value={6}>{t('controls.semitones6')}</MenuItem>
                <MenuItem value={12}>{t('controls.semitones12')}</MenuItem>
                <MenuItem value={18}>{t('controls.semitones18')}</MenuItem>
                <MenuItem value={24}>{t('controls.semitones24')}</MenuItem>
              </Select>
            </FormControl>

            <Stack direction="row" spacing={1} alignItems="center">
              <Typography variant="body2">
                {t('controls.instrumental')}
              </Typography>
              <Switch
                checked={isInstrumentalEnabled}
                onChange={(event) =>
                  setIsInstrumentalEnabled(event.target.checked)
                }
                inputProps={{ 'aria-label': t('controls.instrumental') }}
              />
            </Stack>

            <Stack direction="row" spacing={1} alignItems="center">
              <Typography variant="body2">
                {t('controls.dynamicAxis')}
              </Typography>
              <Switch
                checked={isDynamicAxis}
                onChange={(event) => setIsDynamicAxis(event.target.checked)}
                inputProps={{ 'aria-label': t('controls.dynamicAxis') }}
              />
            </Stack>

            <Stack direction="row" spacing={1} alignItems="center">
              <Typography variant="body2">
                {t('controls.showNoteLabels')}
              </Typography>
              <Switch
                checked={showNoteLabels}
                onChange={(event) => setShowNoteLabels(event.target.checked)}
                inputProps={{ 'aria-label': t('controls.showNoteLabels') }}
              />
            </Stack>
          </Box>
        </Box>

        <Box
          sx={{
            p: { xs: 2, md: 4 },
            flex: 1,
            minHeight: 0,
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          {!isEligible || !resolvedVocalsUrl ? (
            <Alert severity="warning" sx={{ mb: 2 }}>
              {t('unavailableMessage')}
            </Alert>
          ) : null}

          {isAnalysisBlockedByCors ? (
            <Alert severity="warning" sx={{ mb: 2 }}>
              {t('corsBlockedMessage')}
            </Alert>
          ) : null}

          <Box
            sx={{
              flex: 1,
              minHeight: 260,
              borderRadius: 2,
              border: '1px solid rgba(124, 58, 237, 0.25)',
              overflow: 'hidden',
            }}
          >
            <canvas
              ref={canvasRef}
              aria-label={t('chartAriaLabel')}
              style={{ width: '100%', height: '100%', display: 'block' }}
            />
          </Box>

          <Typography variant="body2" sx={{ mt: 1, color: 'text.secondary' }}>
            {t('controls.verticalScrollHint')}
          </Typography>
        </Box>
      </Box>
    </Dialog>
  );
}
