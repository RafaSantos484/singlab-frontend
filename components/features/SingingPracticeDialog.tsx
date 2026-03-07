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
import Forward10Icon from '@mui/icons-material/Forward10';
import PauseIcon from '@mui/icons-material/Pause';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import Replay10Icon from '@mui/icons-material/Replay10';
import { useTranslations } from 'next-intl';

import type { SeparationStemName, Song } from '@/lib/api/types';
import { getFirebaseAuth } from '@/lib/firebase/auth';
import { useStorageDownloadUrls } from '@/lib/hooks/useStorageDownloadUrls';
import { buildStemStoragePath } from '@/lib/storage/uploadSeparationStems';

/** Low-latency pitch tracking defaults */
const DEFAULT_WINDOW_SECONDS = 15;
const DEFAULT_VISIBLE_RANGE_SEMITONES = 18;
const HYSTERESIS_MARGIN_SEMITONES = 1;

/** Faster sampling lowers perceived tracking delay */
const SAMPLE_INTERVAL_MS = 15;

/** Detection thresholds tuned for reliability */
const PITCH_RMS_THRESHOLD = 0.008; // Slightly lower gate for softer input
/** YIN threshold: lower values are more selective (0.1-0.2 works well for voice) */
const YIN_CMND_THRESHOLD = 0.12;

/** Frequency analysis bounds extended for lower and higher notes */
const MIN_FREQUENCY_HZ = 50;
const MAX_FREQUENCY_HZ = 1300;

/** Default visible MIDI window */
const MIN_VISIBLE_MIDI = 36; // C2
const MAX_VISIBLE_MIDI = 84; // C6

/** Balanced downsampling for CPU use and stability */
const DOWNSAMPLE_FACTOR = 2;

/** Low-latency smoothing controls */
const MEDIAN_WINDOW_SIZE = 5;

/** Dynamic EMA limits based on detection confidence */
const EMA_ALPHA_FAST = 0.82;
const EMA_ALPHA_SLOW = 0.42;
const EMA_ALPHA_ATTACK_BOOST = 0.12;
const ATTACK_DELTA_SEMITONES = 1.2;

/** Pitch velocity clamp in semitones/second to avoid jagged jumps */
const MAX_SEMITONES_PER_SECOND_SLOW = 20;
const MAX_SEMITONES_PER_SECOND_FAST = 56;
const MAX_SEMITONES_PER_SECOND_ATTACK = 78;

/** Hold last note through short detection gaps */
const GAP_HOLD_SAMPLES = 3;

/** Pitch history buffer size */
const MAX_PITCH_HISTORY_SAMPLES = 28;

/** Outlier rejection: discard large low-confidence jumps */
const OUTLIER_REJECTION_MIN_SEMITONES = 1.7;
const OUTLIER_REJECTION_MAX_SEMITONES = 6.5;
const LOW_CONFIDENCE = 0.72;

/** Sticky cents deadband and quantization for steadier display */
const STICKY_CENTS_DEADBAND = 8;
const CENTS_QUANTIZATION_STEP = 5;

/** Microphone prefilter parameters to keep lows while reducing hum */
const MIC_HIGHPASS_HZ = 50;
const MIC_LOWPASS_HZ = 1600;
const MIC_FILTER_Q = 0.707; // ~Butterworth

interface PitchPoint {
  time: number;
  midi: number | null;
}

interface PracticeReadout {
  vocalsNoteLabel: string | null;
  microphoneNoteLabel: string | null;
}

function trimPitchPoints(points: PitchPoint[], minTime: number): void {
  let firstValidIndex = 0;
  while (
    firstValidIndex < points.length &&
    points[firstValidIndex].time < minTime
  ) {
    firstValidIndex += 1;
  }

  if (firstValidIndex > 0) {
    points.splice(0, firstValidIndex);
  }
}

interface PitchTrackProcessorState {
  pitchHistory: number[];
  emaPitch: number | null;
  lastSmoothedPitch: number | null;
  gapSamples: number;
  lastDisplayCents: number | null;
}

type TimeDomainFrame = Parameters<AnalyserNode['getFloatTimeDomainData']>[0];

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

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function mapRange(
  value: number,
  inMin: number,
  inMax: number,
  outMin: number,
  outMax: number,
): number {
  const t = clamp((value - inMin) / (inMax - inMin), 0, 1);
  return lerp(outMin, outMax, t);
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
  alpha: number,
): number {
  if (previous === null) {
    return value;
  }
  return alpha * value + (1 - alpha) * previous;
}

function limitPitchDelta(
  currentValue: number,
  previousValue: number,
  maxSemitonesPerSample: number,
): number {
  const delta = currentValue - previousValue;
  if (Math.abs(delta) <= maxSemitonesPerSample) {
    return currentValue;
  }
  return previousValue + Math.sign(delta) * maxSemitonesPerSample;
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

function createPitchTrackProcessorState(): PitchTrackProcessorState {
  return {
    pitchHistory: [],
    emaPitch: null,
    lastSmoothedPitch: null,
    gapSamples: 0,
    lastDisplayCents: null,
  };
}

function resetPitchTrackProcessorState(state: PitchTrackProcessorState): void {
  state.pitchHistory = [];
  state.emaPitch = null;
  state.lastSmoothedPitch = null;
  state.gapSamples = 0;
  state.lastDisplayCents = null;
}

function removeDCOffset(data: Float32Array): void {
  let mean = 0;
  for (let i = 0; i < data.length; i += 1) mean += data[i];
  mean /= data.length || 1;
  for (let i = 0; i < data.length; i += 1) data[i] -= mean;
}

interface DetectionResult {
  frequency: number;
  confidence: number; // 0..1, where 1 is best
}

/** YIN (difference + cumulative mean normalized difference) with parabolic interpolation */
function detectPitchYINFromFrame(
  frame: TimeDomainFrame,
  sampleRate: number,
): DetectionResult | null {
  // Downsample
  const dsLen = Math.floor(frame.length / DOWNSAMPLE_FACTOR);
  if (dsLen < 64) return null;

  const x = new Float32Array(dsLen);
  for (let i = 0; i < dsLen; i += 1) {
    x[i] = frame[i * DOWNSAMPLE_FACTOR] ?? 0;
  }

  // Lightweight preprocessing
  removeDCOffset(x);
  // YIN generally works better here without a window (preserves periodicity)
  // applyHannWindow(x); // optional

  // RMS gating
  let rms = 0;
  for (let i = 0; i < dsLen; i += 1) rms += x[i] * x[i];
  rms = Math.sqrt(rms / dsLen);
  if (!isFinite(rms) || rms < PITCH_RMS_THRESHOLD) return null;

  const dsRate = sampleRate / DOWNSAMPLE_FACTOR;
  const minLag = Math.max(2, Math.floor(dsRate / MAX_FREQUENCY_HZ));
  const maxLag = Math.min(Math.floor(dsRate / MIN_FREQUENCY_HZ), dsLen - 2);

  if (maxLag <= minLag + 2) return null;

  // Difference function d(tau)
  const d = new Float32Array(maxLag + 1);
  for (let tau = 1; tau <= maxLag; tau += 1) {
    let sum = 0;
    for (let i = 0; i < dsLen - tau; i += 1) {
      const diff = x[i] - x[i + tau];
      sum += diff * diff;
    }
    d[tau] = sum;
  }

  // Cumulative mean normalized difference function (CMND)
  const cmnd = new Float32Array(maxLag + 1);
  cmnd[0] = 1;
  let cumulative = 0;
  for (let tau = 1; tau <= maxLag; tau += 1) {
    cumulative += d[tau];
    cmnd[tau] = d[tau] * (tau / (cumulative || 1));
  }

  // Pick the first tau with cmnd below threshold at a local minimum
  let tauEstimate = -1;
  for (let tau = minLag + 1; tau < maxLag; tau += 1) {
    if (
      cmnd[tau] < YIN_CMND_THRESHOLD &&
      cmnd[tau] < cmnd[tau - 1] &&
      cmnd[tau] <= cmnd[tau + 1]
    ) {
      tauEstimate = tau;
      break;
    }
  }
  // Fallback to the global minimum for better noise stability
  if (tauEstimate < 0) {
    let minV = Infinity;
    for (let tau = minLag; tau <= maxLag; tau += 1) {
      if (cmnd[tau] < minV) {
        minV = cmnd[tau];
        tauEstimate = tau;
      }
    }
  }

  // Parabolic interpolation around the minimum
  let refinedTau = tauEstimate;
  if (tauEstimate > minLag && tauEstimate < maxLag) {
    const cM1 = cmnd[tauEstimate - 1];
    const c0 = cmnd[tauEstimate];
    const cP1 = cmnd[tauEstimate + 1];
    const denom = cM1 - 2 * c0 + cP1;
    if (Math.abs(denom) > 1e-12) {
      const offset = (0.5 * (cM1 - cP1)) / denom;
      refinedTau = tauEstimate + clamp(offset, -0.5, 0.5);
    }
  }

  const freq = dsRate / refinedTau;
  if (!isFinite(freq) || freq < MIN_FREQUENCY_HZ || freq > MAX_FREQUENCY_HZ) {
    return null;
  }

  const confidence = clamp(1 - cmnd[Math.round(tauEstimate)], 0, 1);
  return { frequency: freq, confidence };
}

function drawRoundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

/** Draw a smooth line using quadratic segments per continuous chunk. */
function drawSmoothPath(
  context: CanvasRenderingContext2D,
  pts: { x: number; y: number }[],
): void {
  if (pts.length === 0) return;
  if (pts.length === 1) {
    context.beginPath();
    context.arc(pts[0].x, pts[0].y, 1.5, 0, Math.PI * 2);
    context.fill();
    return;
  }

  context.beginPath();
  context.moveTo(pts[0].x, pts[0].y);

  for (let i = 1; i < pts.length - 1; i += 1) {
    const xc = (pts[i].x + pts[i + 1].x) / 2;
    const yc = (pts[i].y + pts[i + 1].y) / 2;
    context.quadraticCurveTo(pts[i].x, pts[i].y, xc, yc);
  }

  const last = pts.length - 1;
  context.quadraticCurveTo(
    pts[last - 1].x,
    pts[last - 1].y,
    pts[last].x,
    pts[last].y,
  );
  context.stroke();
}

function drawPracticeCanvas(
  canvas: HTMLCanvasElement,
  vocalsPoints: PitchPoint[],
  microphonePoints: PitchPoint[],
  currentTime: number,
  centerMidi: number,
  timeWindowSeconds: number,
  visibleRangeSemitones: number,
  showNoteLabels: boolean,
  hoverX: number | null,
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

  // Horizontal guide lines and note labels.
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

  const visibleVocalsPoints = vocalsPoints.filter(
    (point) => point.time >= minTime - 0.5,
  );
  const visibleMicrophonePoints = microphonePoints.filter(
    (point) => point.time >= minTime - 0.5,
  );

  // Smoothed vocals pitch curve.
  context.strokeStyle = 'rgba(129, 140, 248, 0.95)';
  context.lineWidth = 2;
  context.lineCap = 'round';
  context.lineJoin = 'round';

  let segment: { x: number; y: number }[] = [];
  for (let i = 0; i < visibleVocalsPoints.length; i += 1) {
    const point = visibleVocalsPoints[i];
    if (point.midi === null) {
      if (segment.length > 0) {
        drawSmoothPath(context, segment);
        segment = [];
      }
      continue;
    }
    const x = xFromTime(point.time);
    const y = yFromMidi(point.midi);
    segment.push({ x, y });
  }
  if (segment.length > 0) {
    drawSmoothPath(context, segment);
  }

  // Smoothed microphone pitch curve.
  context.strokeStyle = 'rgba(34, 197, 94, 0.95)';
  context.lineWidth = 2;

  segment = [];
  for (let i = 0; i < visibleMicrophonePoints.length; i += 1) {
    const point = visibleMicrophonePoints[i];
    if (point.midi === null) {
      if (segment.length > 0) {
        drawSmoothPath(context, segment);
        segment = [];
      }
      continue;
    }
    const x = xFromTime(point.time);
    const y = yFromMidi(point.midi);
    segment.push({ x, y });
  }
  if (segment.length > 0) {
    drawSmoothPath(context, segment);
  }

  // Gap markers where no pitch was detected.
  context.strokeStyle = 'rgba(244, 114, 182, 0.5)';
  context.lineWidth = 1;
  for (let i = 0; i < visibleVocalsPoints.length; i += 1) {
    const point = visibleVocalsPoints[i];
    if (point.midi !== null) {
      continue;
    }

    const x = xFromTime(point.time);
    const heightVal = height;
    context.beginPath();
    context.moveTo(x, heightVal - 12);
    context.lineTo(x, heightVal - 2);
    context.stroke();
  }

  // Time cursor.
  context.strokeStyle = 'rgba(236, 72, 153, 0.8)';
  context.setLineDash([4, 4]);
  const currentX = xFromTime(currentTime);
  context.beginPath();
  context.moveTo(currentX, 0);
  context.lineTo(currentX, height);
  context.stroke();
  context.setLineDash([]);

  // Hover inspection overlay.
  if (hoverX !== null) {
    context.strokeStyle = 'rgba(255, 255, 255, 0.45)';
    context.lineWidth = 1;
    context.setLineDash([3, 4]);
    context.beginPath();
    context.moveTo(hoverX, 0);
    context.lineTo(hoverX, height);
    context.stroke();
    context.setLineDash([]);

    const hoveredTime = minTime + (hoverX / width) * timeWindowSeconds;

    const pickClosest = (pts: PitchPoint[]): PitchPoint | null => {
      let best: PitchPoint | null = null;
      let bestDist = 0.5;
      for (const p of pts) {
        if (p.midi !== null) {
          const dist = Math.abs(p.time - hoveredTime);
          if (dist < bestDist) {
            bestDist = dist;
            best = p;
          }
        }
      }
      return best;
    };

    const closestVocalsPoint = pickClosest(visibleVocalsPoints);
    const closestMicrophonePoint = pickClosest(visibleMicrophonePoints);

    const hoverItems: Array<{
      x: number;
      y: number;
      label: string;
      fillColor: string;
      borderColor: string;
    }> = [];

    if (closestVocalsPoint?.midi != null) {
      hoverItems.push({
        x: xFromTime(closestVocalsPoint.time),
        y: yFromMidi(closestVocalsPoint.midi),
        label: midiToNoteLabel(closestVocalsPoint.midi),
        fillColor: 'rgba(129, 140, 248, 1)',
        borderColor: 'rgba(129, 140, 248, 0.85)',
      });
    }

    if (closestMicrophonePoint?.midi != null) {
      hoverItems.push({
        x: xFromTime(closestMicrophonePoint.time),
        y: yFromMidi(closestMicrophonePoint.midi),
        label: midiToNoteLabel(closestMicrophonePoint.midi),
        fillColor: 'rgba(34, 197, 94, 1)',
        borderColor: 'rgba(34, 197, 94, 0.85)',
      });
    }

    hoverItems.forEach((item, index) => {
      context.fillStyle = item.fillColor;
      context.beginPath();
      context.arc(item.x, item.y, 4, 0, Math.PI * 2);
      context.fill();

      const fontSize = 13;
      context.font = `bold ${fontSize}px sans-serif`;
      const textW = context.measureText(item.label).width;
      const padX = 8;
      const padY = 5;
      const boxW = textW + padX * 2;
      const boxH = fontSize + padY * 2;
      const rawBoxX = hoverX + 10;
      const boxX = Math.min(rawBoxX, width - boxW - 4);
      const stackedY = item.y - boxH / 2 + index * (boxH + 6);
      const boxY = Math.max(2, Math.min(stackedY, height - boxH - 2));

      context.fillStyle = 'rgba(30, 27, 75, 0.92)';
      drawRoundRect(context, boxX, boxY, boxW, boxH, 5);
      context.fill();

      context.strokeStyle = item.borderColor;
      context.lineWidth = 1;
      drawRoundRect(context, boxX, boxY, boxW, boxH, 5);
      context.stroke();

      context.fillStyle = 'rgba(226, 232, 240, 1)';
      context.fillText(item.label, boxX + padX, boxY + padY + fontSize - 1);
    });
  }
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
  const [isMicrophoneEnabled, setIsMicrophoneEnabled] = useState(true); // Controls analysis only
  const [isDynamicAxis, setIsDynamicAxis] = useState(true);
  const [showNoteLabels, setShowNoteLabels] = useState(true);
  const [readout, setReadout] = useState<PracticeReadout>({
    vocalsNoteLabel: null,
    microphoneNoteLabel: null,
  });
  const [isAudioLoaded, setIsAudioLoaded] = useState(false);
  const [blockedSourceKey, setBlockedSourceKey] = useState<string | null>(null);
  const [microphoneErrorKey, setMicrophoneErrorKey] = useState<
    'unsupported' | 'denied' | 'unavailable' | null
  >(null);
  const [isMicrophoneReady, setIsMicrophoneReady] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const backingAudioRefs = useRef<HTMLAudioElement[]>([]);
  const audioContextRef = useRef<AudioContext | null>(null);
  const vocalsAnalyserRef = useRef<AnalyserNode | null>(null);
  const microphoneAnalyserRef = useRef<AnalyserNode | null>(null);
  const backingGainRef = useRef<GainNode | null>(null);
  const vocalsFrameRef = useRef<TimeDomainFrame | null>(null);
  const microphoneFrameRef = useRef<TimeDomainFrame | null>(null);
  const microphoneStreamRef = useRef<MediaStream | null>(null);
  const vocalsPointsRef = useRef<PitchPoint[]>([]);
  const microphonePointsRef = useRef<PitchPoint[]>([]);
  const vocalsProcessorRef = useRef<PitchTrackProcessorState>(
    createPitchTrackProcessorState(),
  );
  const microphoneProcessorRef = useRef<PitchTrackProcessorState>(
    createPitchTrackProcessorState(),
  );
  const centerMidiRef = useRef(60);
  const lastSampleAtRef = useRef(0);
  const instrumentalEnabledRef = useRef(isInstrumentalEnabled);
  const microphoneEnabledRef = useRef(isMicrophoneEnabled);
  const hoverXRef = useRef<number | null>(null);
  const readoutRef = useRef<PracticeReadout>({
    vocalsNoteLabel: null,
    microphoneNoteLabel: null,
  });

  const stemPaths = useMemo((): Partial<
    Record<SeparationStemName, string>
  > | null => {
    const currentUser = getFirebaseAuth().currentUser;
    if (!currentUser?.uid || !song.separatedSongInfo?.stems) {
      return null;
    }

    const next: Partial<Record<SeparationStemName, string>> = {};
    song.separatedSongInfo.stems.forEach((stem) => {
      next[stem] = buildStemStoragePath(currentUser.uid, song.id, stem);
    });

    return next;
  }, [song.id, song.separatedSongInfo]);

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
  const isMicrophoneUnavailable =
    isMicrophoneEnabled && microphoneErrorKey !== null;

  useEffect(() => {
    if (!open || !isEligible) {
      return;
    }

    const { minCenter, maxCenter } = getCenterBounds(visibleRangeSemitones);
    centerMidiRef.current = clamp(centerMidiRef.current, minCenter, maxCenter);
    vocalsPointsRef.current = [];
    microphonePointsRef.current = [];
    resetPitchTrackProcessorState(vocalsProcessorRef.current);
    resetPitchTrackProcessorState(microphoneProcessorRef.current);
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
        centerMidiRef.current - semitoneDelta,
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

    let isDisposed = false;
    const vocalsProcessorState = vocalsProcessorRef.current;
    const microphoneProcessorState = microphoneProcessorRef.current;

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

    // Keep source references for analysis and playback sync.
    audioRef.current = audioElement;
    backingAudioRefs.current = backingElements;

    const context = new AudioContext();

    // ====== ANALYZERS ======
    const vocalsAnalyser = context.createAnalyser();
    vocalsAnalyser.fftSize = 4096; // use same analysis window as microphone for consistency
    vocalsAnalyser.smoothingTimeConstant = 0;

    const microphoneAnalyser = context.createAnalyser();
    microphoneAnalyser.fftSize = 4096; // Larger window improves low-note tracking
    microphoneAnalyser.smoothingTimeConstant = 0;

    const vocalsSource = context.createMediaElementSource(audioElement);
    const backingGain = context.createGain();
    backingGain.gain.value = instrumentalEnabledRef.current ? 1 : 0;

    const backingSources = backingElements.map((element) =>
      context.createMediaElementSource(element),
    );

    // Route vocals playback and analysis through separate branches.
    // Analysis uses the same HP/LP preprocessing as microphone to keep pitch
    // tracking behavior consistent between both curves.
    const vocalsHp = context.createBiquadFilter();
    vocalsHp.type = 'highpass';
    vocalsHp.frequency.value = MIC_HIGHPASS_HZ;
    vocalsHp.Q.value = MIC_FILTER_Q;

    const vocalsLp = context.createBiquadFilter();
    vocalsLp.type = 'lowpass';
    vocalsLp.frequency.value = MIC_LOWPASS_HZ;
    vocalsLp.Q.value = MIC_FILTER_Q;

    // Routing
    vocalsSource.connect(vocalsHp);
    vocalsHp.connect(vocalsLp);
    vocalsLp.connect(vocalsAnalyser);
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

    const setupMicrophone = async (): Promise<void> => {
      if (!navigator.mediaDevices?.getUserMedia) {
        if (!isDisposed) {
          setMicrophoneErrorKey('unsupported');
          setIsMicrophoneReady(false);
        }
        return;
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
          },
        });

        if (isDisposed) {
          stream.getTracks().forEach((track) => {
            track.stop();
          });
          return;
        }

        const microphoneSource = context.createMediaStreamSource(stream);

        // Chain: mic -> HP -> LP -> analyser (no output to destination)
        const hp = context.createBiquadFilter();
        hp.type = 'highpass';
        hp.frequency.value = MIC_HIGHPASS_HZ;
        hp.Q.value = MIC_FILTER_Q;

        const lp = context.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = MIC_LOWPASS_HZ;
        lp.Q.value = MIC_FILTER_Q;

        microphoneSource.connect(hp);
        hp.connect(lp);
        lp.connect(microphoneAnalyser);

        microphoneStreamRef.current = stream;
        microphoneAnalyserRef.current = microphoneAnalyser;
        microphoneFrameRef.current = new Float32Array(
          microphoneAnalyser.fftSize,
        ) as TimeDomainFrame;

        setMicrophoneErrorKey(null);
        setIsMicrophoneReady(true);
      } catch (error: unknown) {
        if (isDisposed) {
          return;
        }

        const isPermissionError =
          error instanceof DOMException &&
          (error.name === 'NotAllowedError' ||
            error.name === 'SecurityError' ||
            error.name === 'PermissionDeniedError');

        setMicrophoneErrorKey(isPermissionError ? 'denied' : 'unavailable');
        setIsMicrophoneReady(false);
      }
    };

    void setupMicrophone();

    audioContextRef.current = context;
    vocalsAnalyserRef.current = vocalsAnalyser;
    backingGainRef.current = backingGain;
    vocalsFrameRef.current = new Float32Array(
      vocalsAnalyser.fftSize,
    ) as TimeDomainFrame;

    return () => {
      isDisposed = true;
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

      const microphoneStream = microphoneStreamRef.current;
      if (microphoneStream) {
        microphoneStream.getTracks().forEach((track) => {
          track.stop();
        });
      }

      void context.close();

      vocalsAnalyserRef.current = null;
      microphoneAnalyserRef.current = null;
      backingGainRef.current = null;
      vocalsFrameRef.current = null;
      microphoneFrameRef.current = null;
      microphoneStreamRef.current = null;
      audioRef.current = null;
      backingAudioRefs.current = [];
      audioContextRef.current = null;
      vocalsPointsRef.current = [];
      microphonePointsRef.current = [];
      resetPitchTrackProcessorState(vocalsProcessorState);
      resetPitchTrackProcessorState(microphoneProcessorState);
      setReadout({
        vocalsNoteLabel: null,
        microphoneNoteLabel: null,
      });
      readoutRef.current = {
        vocalsNoteLabel: null,
        microphoneNoteLabel: null,
      };
      centerMidiRef.current = 60;
      setIsAudioLoaded(false);
      setIsMicrophoneReady(false);
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

  // Microphone monitoring output was removed.
  // The switch now toggles analysis only, without routing mic audio to speakers.
  useEffect(() => {
    microphoneEnabledRef.current = isMicrophoneEnabled;
  }, [isMicrophoneEnabled]);

  /** Pitch processing without octave continuity correction */
  function processPitchDetection(
    state: PitchTrackProcessorState,
    detection: DetectionResult | null,
    elapsedMs: number,
  ): number | null {
    const frequency = detection?.frequency ?? null;
    const confidence = detection?.confidence ?? null;

    const rawMidi = frequency != null ? frequencyToMidi(frequency) : null;

    appendPitchHistory(state.pitchHistory, rawMidi);

    let medianMidi = getMedianFromRecentValid(
      state.pitchHistory,
      MEDIAN_WINDOW_SIZE,
    );

    // Reject large jumps when confidence is low.
    if (
      medianMidi !== null &&
      state.lastSmoothedPitch !== null &&
      confidence !== null &&
      confidence < LOW_CONFIDENCE
    ) {
      const outlierLimit = mapRange(
        confidence,
        0,
        LOW_CONFIDENCE,
        OUTLIER_REJECTION_MIN_SEMITONES,
        OUTLIER_REJECTION_MAX_SEMITONES,
      );

      if (Math.abs(medianMidi - state.lastSmoothedPitch) > outlierLimit) {
        medianMidi = null;
      }
    }

    let smoothedMidi: number | null = null;

    if (medianMidi !== null) {
      const previousPitch = state.lastSmoothedPitch;
      const pitchDelta =
        previousPitch === null ? 0 : Math.abs(medianMidi - previousPitch);

      const dynAlpha =
        confidence === null
          ? EMA_ALPHA_SLOW
          : mapRange(confidence, 0.45, 0.99, EMA_ALPHA_SLOW, EMA_ALPHA_FAST);

      const attackAlphaBoost =
        pitchDelta > ATTACK_DELTA_SEMITONES
          ? mapRange(
              pitchDelta,
              ATTACK_DELTA_SEMITONES,
              ATTACK_DELTA_SEMITONES + 6,
              0,
              EMA_ALPHA_ATTACK_BOOST,
            )
          : 0;

      const effectiveAlpha = clamp(
        dynAlpha + attackAlphaBoost,
        EMA_ALPHA_SLOW,
        0.95,
      );

      const emaMidi = exponentialMovingAverage(
        state.emaPitch,
        medianMidi,
        effectiveAlpha,
      );

      const dtSec = Math.max(elapsedMs, SAMPLE_INTERVAL_MS) / 1000;
      const maxSemitonesPerSecond =
        confidence === null
          ? MAX_SEMITONES_PER_SECOND_SLOW
          : mapRange(
              confidence,
              0.45,
              0.99,
              MAX_SEMITONES_PER_SECOND_SLOW,
              MAX_SEMITONES_PER_SECOND_FAST,
            );

      const boostedMaxSemitonesPerSecond =
        pitchDelta > ATTACK_DELTA_SEMITONES * 1.8
          ? Math.max(maxSemitonesPerSecond, MAX_SEMITONES_PER_SECOND_ATTACK)
          : maxSemitonesPerSecond;

      const maxSemitonesPerSample = boostedMaxSemitonesPerSecond * dtSec;

      smoothedMidi =
        state.lastSmoothedPitch !== null
          ? limitPitchDelta(
              emaMidi,
              state.lastSmoothedPitch,
              maxSemitonesPerSample,
            )
          : emaMidi;

      state.emaPitch = emaMidi;
      state.lastSmoothedPitch = smoothedMidi;
      state.gapSamples = 0;
    } else {
      state.gapSamples += 1;
      if (
        state.gapSamples <= GAP_HOLD_SAMPLES &&
        state.lastSmoothedPitch !== null
      ) {
        smoothedMidi = state.lastSmoothedPitch;
      } else {
        smoothedMidi = null;
        state.emaPitch = null;
      }
    }

    if (smoothedMidi === null) {
      state.lastDisplayCents = null;
      return null;
    }

    // Sticky cents plus fixed-step quantization
    const nearestMidi = Math.round(smoothedMidi);
    let cents = (smoothedMidi - nearestMidi) * 100;
    if (state.lastDisplayCents !== null) {
      const deltaCents = cents - state.lastDisplayCents;
      if (Math.abs(deltaCents) < STICKY_CENTS_DEADBAND) {
        cents = state.lastDisplayCents;
      }
    }
    cents =
      Math.round(cents / CENTS_QUANTIZATION_STEP) * CENTS_QUANTIZATION_STEP;
    state.lastDisplayCents = cents;

    return nearestMidi + cents / 100;
  }

  useEffect(() => {
    if (!open || !isEligible || !resolvedVocalsUrl) {
      return;
    }

    let animationFrameId = 0;

    const syncAndDraw = (): void => {
      const audioElement = audioRef.current;
      const backingElements = backingAudioRefs.current;
      const vocalsAnalyser = vocalsAnalyserRef.current;
      const vocalsFrame = vocalsFrameRef.current;
      const microphoneAnalyser = microphoneAnalyserRef.current;
      const microphoneFrame = microphoneFrameRef.current;
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

        // Keep backing stems aligned with the vocal track.
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

      if (audioElement && vocalsAnalyser && vocalsFrame) {
        const now = performance.now();
        const elapsedMs = now - lastSampleAtRef.current;
        if (elapsedMs >= SAMPLE_INTERVAL_MS) {
          lastSampleAtRef.current = now;

          let vocalsDisplayMidi: number | null = null;
          if (!isAnalysisBlockedByCors) {
            vocalsAnalyser.getFloatTimeDomainData(vocalsFrame);
            const det = detectPitchYINFromFrame(
              vocalsFrame,
              vocalsAnalyser.context.sampleRate,
            );
            vocalsDisplayMidi = processPitchDetection(
              vocalsProcessorRef.current,
              det,
              elapsedMs,
            );
          } else {
            resetPitchTrackProcessorState(vocalsProcessorRef.current);
          }

          const isMicrophoneTrackActive =
            microphoneEnabledRef.current &&
            microphoneErrorKey === null &&
            microphoneAnalyser !== null &&
            microphoneFrame !== null;

          let microphoneDisplayMidi: number | null = null;
          if (isMicrophoneTrackActive) {
            microphoneAnalyser.getFloatTimeDomainData(microphoneFrame);
            const detMic = detectPitchYINFromFrame(
              microphoneFrame,
              microphoneAnalyser.context.sampleRate,
            );
            microphoneDisplayMidi = processPitchDetection(
              microphoneProcessorRef.current,
              detMic,
              elapsedMs,
            );
          } else {
            resetPitchTrackProcessorState(microphoneProcessorRef.current);
          }

          const axisReferenceMidi = vocalsDisplayMidi ?? microphoneDisplayMidi;

          // Dynamic vertical axis recentering.
          if (axisReferenceMidi !== null && isDynamicAxis) {
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

            if (axisReferenceMidi > upperBoundary - hysteresisMargin) {
              centerMidiRef.current =
                axisReferenceMidi -
                (visibleRangeSemitones / 2 - hysteresisMargin);
            } else if (axisReferenceMidi < lowerBoundary + hysteresisMargin) {
              centerMidiRef.current =
                axisReferenceMidi +
                (visibleRangeSemitones / 2 - hysteresisMargin);
            }

            centerMidiRef.current = clamp(
              centerMidiRef.current,
              minCenter,
              maxCenter,
            );
          }

          // Store display pitch in history for steadier curve rendering.
          vocalsPointsRef.current.push({
            time: audioElement.currentTime,
            midi: vocalsDisplayMidi,
          });
          microphonePointsRef.current.push({
            time: audioElement.currentTime,
            midi: isMicrophoneTrackActive ? microphoneDisplayMidi : null,
          });

          const nextReadout: PracticeReadout = {
            vocalsNoteLabel:
              vocalsDisplayMidi !== null
                ? midiToNoteLabel(vocalsDisplayMidi)
                : null,
            microphoneNoteLabel:
              isMicrophoneTrackActive && microphoneDisplayMidi !== null
                ? midiToNoteLabel(microphoneDisplayMidi)
                : null,
          };

          const currentReadout = readoutRef.current;
          if (
            currentReadout.vocalsNoteLabel !== nextReadout.vocalsNoteLabel ||
            currentReadout.microphoneNoteLabel !==
              nextReadout.microphoneNoteLabel
          ) {
            readoutRef.current = nextReadout;
            setReadout(nextReadout);
          }

          const minHistoryTime = audioElement.currentTime - windowSeconds * 1.5;
          trimPitchPoints(vocalsPointsRef.current, minHistoryTime);
          trimPitchPoints(microphonePointsRef.current, minHistoryTime);
        }
      }

      if (canvas && audioElement) {
        drawPracticeCanvas(
          canvas,
          vocalsPointsRef.current,
          microphonePointsRef.current,
          audioElement.currentTime,
          centerMidiRef.current,
          windowSeconds,
          visibleRangeSemitones,
          showNoteLabels,
          hoverXRef.current,
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
    isMicrophoneEnabled,
    microphoneErrorKey,
  ]);

  const statusLabel = useMemo((): string => {
    if (isAnalysisBlockedByCors) {
      return t('status.corsBlocked');
    }

    if (isMicrophoneUnavailable) {
      if (microphoneErrorKey === 'denied') {
        return t('status.microphone.denied');
      }

      if (microphoneErrorKey === 'unsupported') {
        return t('status.microphone.unsupported');
      }

      return t('status.microphone.unavailable');
    }

    if (isMicrophoneEnabled && !isMicrophoneReady) {
      return t('status.microphone.connecting');
    }

    if (!isAudioLoaded) {
      return t('status.syncing');
    }

    if (!isPracticePlaying) {
      return t('status.waitingPlayback');
    }

    if (readout.vocalsNoteLabel === null) {
      return t('status.unvoiced');
    }

    return t('status.analyzing');
  }, [
    isAnalysisBlockedByCors,
    isMicrophoneUnavailable,
    isMicrophoneEnabled,
    isMicrophoneReady,
    microphoneErrorKey,
    isAudioLoaded,
    isPracticePlaying,
    readout.vocalsNoteLabel,
    t,
  ]);

  const microphoneAlertMessage = useMemo((): string | null => {
    if (!isMicrophoneUnavailable || microphoneErrorKey === null) {
      return null;
    }

    if (microphoneErrorKey === 'denied') {
      return t('microphone.denied');
    }

    if (microphoneErrorKey === 'unsupported') {
      return t('microphone.unsupported');
    }

    return t('microphone.unavailable');
  }, [isMicrophoneUnavailable, microphoneErrorKey, t]);

  const handleSeekBy = (deltaSec: number): void => {
    const audioElement = audioRef.current;
    if (!audioElement) {
      return;
    }

    const { duration } = audioElement;
    if (!isFinite(duration) || duration <= 0) {
      return;
    }

    const from = audioElement.currentTime;
    const target = Math.max(0, Math.min(duration, from + deltaSec));
    audioElement.currentTime = target;

    backingAudioRefs.current.forEach((element) => {
      try {
        element.currentTime = target;
      } catch {
        // no-op
      }
    });

    if (deltaSec < 0) {
      // Backward seek: clear revisited interval
      const clearFrom = Math.max(0, target - 0.5);
      vocalsPointsRef.current = vocalsPointsRef.current.filter(
        (point) => point.time < clearFrom,
      );
      microphonePointsRef.current = microphonePointsRef.current.filter(
        (point) => point.time < clearFrom,
      );

      resetPitchTrackProcessorState(vocalsProcessorRef.current);
      resetPitchTrackProcessorState(microphoneProcessorRef.current);
      setReadout({
        vocalsNoteLabel: null,
        microphoneNoteLabel: null,
      });
      readoutRef.current = {
        vocalsNoteLabel: null,
        microphoneNoteLabel: null,
      };
    } else {
      // Forward seek: break line with sentinel
      vocalsPointsRef.current.push({ time: from, midi: null });
      microphonePointsRef.current.push({ time: from, midi: null });
    }
  };

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
          <Stack
            direction="row"
            spacing={1.5}
            alignItems="center"
            sx={{ flexWrap: 'wrap' }}
          >
            <Box sx={{ minWidth: 220 }}>
              <Chip
                label={statusLabel}
                color="primary"
                variant="outlined"
                sx={{ width: '100%' }}
              />
            </Box>

            <Stack direction="row" spacing={0.5} alignItems="center">
              <IconButton
                size="small"
                onClick={() => handleSeekBy(-10)}
                aria-label={t('seekBack10AriaLabel')}
              >
                <Replay10Icon />
              </IconButton>

              <Button
                variant="outlined"
                size="small"
                onClick={handleTogglePracticePlayback}
                startIcon={
                  isPracticePlaying ? <PauseIcon /> : <PlayArrowIcon />
                }
                aria-label={
                  isPracticePlaying
                    ? t('pauseButtonAriaLabel')
                    : t('playButtonAriaLabel')
                }
              >
                {isPracticePlaying ? t('pauseButton') : t('playButton')}
              </Button>

              <IconButton
                size="small"
                onClick={() => handleSeekBy(10)}
                aria-label={t('seekForward10AriaLabel')}
              >
                <Forward10Icon />
              </IconButton>
            </Stack>

            <Stack direction="row" spacing={2} alignItems="center">
              <Stack direction="row" spacing={1} alignItems="center">
                <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                  {t('currentVocalsNoteLabel')}
                </Typography>
                <Box sx={{ minWidth: 70, textAlign: 'center' }}>
                  <Typography variant="body1" sx={{ fontWeight: 600 }}>
                    {readout.vocalsNoteLabel ?? t('noPitch')}
                  </Typography>
                </Box>
              </Stack>

              <Stack direction="row" spacing={1} alignItems="center">
                <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                  {t('currentMicrophoneNoteLabel')}
                </Typography>
                <Box sx={{ minWidth: 70, textAlign: 'center' }}>
                  <Typography variant="body1" sx={{ fontWeight: 600 }}>
                    {readout.microphoneNoteLabel ?? t('noPitch')}
                  </Typography>
                </Box>
              </Stack>
            </Stack>
          </Stack>

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
                {t('controls.microphone')}
              </Typography>
              <Switch
                checked={isMicrophoneEnabled}
                onChange={(event) =>
                  setIsMicrophoneEnabled(event.target.checked)
                }
                inputProps={{ 'aria-label': t('controls.microphone') }}
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

          {isMicrophoneUnavailable ? (
            <Alert severity="warning" sx={{ mb: 2 }}>
              {microphoneAlertMessage}
            </Alert>
          ) : null}

          {isMicrophoneEnabled &&
          !isMicrophoneUnavailable &&
          !isMicrophoneReady ? (
            <Alert severity="info" sx={{ mb: 2 }}>
              {t('microphone.connecting')}
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
              onMouseMove={(event) => {
                const rect = event.currentTarget.getBoundingClientRect();
                hoverXRef.current = event.clientX - rect.left;
              }}
              onMouseLeave={() => {
                hoverXRef.current = null;
              }}
            />
          </Box>

          <Stack direction="row" spacing={2} sx={{ mt: 1 }}>
            <Stack direction="row" spacing={0.75} alignItems="center">
              <Box
                sx={{
                  width: 18,
                  height: 3,
                  borderRadius: 999,
                  bgcolor: 'rgba(129, 140, 248, 0.95)',
                }}
              />
              <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                {t('legend.vocals')}
              </Typography>
            </Stack>

            <Stack direction="row" spacing={0.75} alignItems="center">
              <Box
                sx={{
                  width: 18,
                  height: 3,
                  borderRadius: 999,
                  bgcolor: 'rgba(34, 197, 94, 0.95)',
                }}
              />
              <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                {t('legend.microphone')}
              </Typography>
            </Stack>
          </Stack>

          <Typography variant="body2" sx={{ mt: 1, color: 'text.secondary' }}>
            {t('controls.verticalScrollHint')}
          </Typography>
        </Box>
      </Box>
    </Dialog>
  );
}
