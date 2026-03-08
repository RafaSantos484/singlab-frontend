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

/** Default time window and visible range */
const DEFAULT_WINDOW_SECONDS = 15;
const DEFAULT_VISIBLE_RANGE_SEMITONES = 18;
const HYSTERESIS_MARGIN_SEMITONES = 1;

/** Detection cadence is decoupled from canvas drawing */
const DETECTION_INTERVAL_MS = 14; // ~71 Hz to reduce perceived tracking latency

/** Frequency analysis bounds */
const MIN_FREQUENCY_HZ = 65; // ~C2 (65.4 Hz), aligned with the default vertical window
const MAX_FREQUENCY_HZ = 1300;

/** Default visible MIDI window */
const MIN_VISIBLE_MIDI = 36; // C2
const MAX_VISIBLE_MIDI = 84; // C6

/** Filters used only in the analysis path */
const VOCALS_HP_HZ = 60;
const MIC_HP_HZ = 70;
const LP_HZ = 1500;
const HUM_FREQ_HZ = 60; // Switch to 50 Hz where mains hum is 50 Hz
const NOTCH_Q = 35;

/** RMS gate to drop weak frames */
const MIN_RMS_GATE = 0.012; // ~ -38 dBFS

/** Smoothing / anti-spike */
const YIN_CONFIDENCE_GATE = 0.35; // minimum accepted confidence
const HARD_SPIKE_SEMITONES = 4.0; // hard outlier threshold
const MEDIAN_WINDOW = 3; // small window keeps tracking responsive
const TRANSIENT_SPIKE_SEMITONES = 6.5; // one-frame transient noise spike
const TRANSIENT_ALLOW_CONFIDENCE = 0.88;
const TRANSIENT_CONFIRM_FRAMES = 2;
// Adaptive ramp limiter bounds (in semitones/second)
const RAMP_BASE_ST_PER_SEC = 28;
const RAMP_MAX_ST_PER_SEC = 120;

/** Drawing: minimum X step (px) before adding a new point */
const MIN_X_STEP_PX = 1.25;
const MAX_NEAREST_SEARCH_STEPS = 12;

/** Keep shorter history to reduce draw and hover costs */
const HISTORY_FACTOR = 1.35;

/** Downsample in detection to reduce YIN CPU cost */
const DOWNSAMPLE_FACTOR = 2;

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
  recentMidis: number[]; // recent samples
  lastSmoothedMidi: number | null; // last stabilized output
  lastSmoothedAt: number | null; // performance.now() timestamp of last output
  transientCandidate: number | null;
  transientCandidateFrames: number;
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

function createPitchTrackProcessorState(): PitchTrackProcessorState {
  return {
    recentMidis: [],
    lastSmoothedMidi: null,
    lastSmoothedAt: null,
    transientCandidate: null,
    transientCandidateFrames: 0,
  };
}

function resetPitchTrackProcessorState(state: PitchTrackProcessorState): void {
  state.recentMidis = [];
  state.lastSmoothedMidi = null;
  state.lastSmoothedAt = null;
  state.transientCandidate = null;
  state.transientCandidateFrames = 0;
}

interface DetectionResult {
  frequency: number;
  confidence: number; // 0..1
}

interface CanvasStaticLayer {
  width: number;
  height: number;
  dpr: number;
  minMidi: number;
  maxMidi: number;
  showNoteLabels: boolean;
  bitmap: HTMLCanvasElement;
}

const staticCanvasLayerCache = new WeakMap<
  HTMLCanvasElement,
  CanvasStaticLayer
>();

/** Analysis helpers */
function calcRms(frame: Float32Array): number {
  let s = 0;
  for (let i = 0; i < frame.length; i += 1) s += frame[i] * frame[i];
  return Math.sqrt(s / frame.length);
}

function applyHannWindow(frame: Float32Array): void {
  const N = frame.length;
  if (N <= 1) return;
  for (let n = 0; n < N; n += 1) {
    frame[n] *= 0.5 * (1 - Math.cos((2 * Math.PI * n) / (N - 1)));
  }
}

/** Select the smallest power-of-two fftSize that supports MIN_FREQUENCY_HZ */
function selectFftSize(sampleRate: number): number {
  // ~2 periods of the minimum frequency improves YIN robustness
  const minSamples = Math.ceil((sampleRate / MIN_FREQUENCY_HZ) * 2);
  let size = 1024;
  while (size < minSamples) size *= 2;
  return size;
}

/** Reusable buffers to reduce GC pressure during YIN detection */
const yinScratch = new Map<number, { d: Float32Array; cmnd: Float32Array }>();

/** Downsampling buffers cached by frame length */
const downScratch = new Map<number, Float32Array>();

function abs(n: number): number {
  return Math.abs(n);
}

/**
 * YIN (difference + CMND) with parabolic interpolation and no hard threshold.
 * Uses a downsampled signal to reduce CPU cost.
 */
function detectPitchYINFromFrame(
  frame: TimeDomainFrame,
  sampleRate: number,
): DetectionResult | null {
  const src = frame as Float32Array;
  const factor = DOWNSAMPLE_FACTOR;

  // Downsample via block averaging to smooth before decimation
  const dsLen = Math.floor(src.length / factor);
  if (dsLen < 64) return null;

  let ds = downScratch.get(src.length);
  if (!ds || ds.length < dsLen) {
    ds = new Float32Array(dsLen);
    downScratch.set(src.length, ds);
  }
  // Simple average per block
  for (let j = 0, i = 0; j < dsLen; j += 1) {
    let sum = 0;
    for (let k = 0; k < factor; k += 1) {
      sum += src[i++];
    }
    ds[j] = sum / factor;
  }

  const x = ds as Float32Array;
  const len = dsLen;
  const srEff = sampleRate / factor;

  const minLag = Math.max(2, Math.floor(srEff / MAX_FREQUENCY_HZ));
  const maxLag = Math.min(Math.floor(srEff / MIN_FREQUENCY_HZ), len - 2);
  if (maxLag <= minLag + 2) return null;

  // Scratch buffers cached by effective maxLag
  let scratch = yinScratch.get(maxLag);
  if (
    !scratch ||
    scratch.d.length < maxLag + 1 ||
    scratch.cmnd.length < maxLag + 1
  ) {
    scratch = {
      d: new Float32Array(maxLag + 1),
      cmnd: new Float32Array(maxLag + 1),
    };
    yinScratch.set(maxLag, scratch);
  }
  const d = scratch.d;
  const cmnd = scratch.cmnd;

  // Difference function d(tau)
  for (let tau = 1; tau <= maxLag; tau += 1) {
    let sum = 0;
    const limit = len - tau;
    for (let i = 0; i < limit; i += 1) {
      const diff = x[i] - x[i + tau];
      sum += diff * diff;
    }
    d[tau] = sum;
  }

  // CMND
  cmnd[0] = 1;
  let cumulative = 0;
  for (let tau = 1; tau <= maxLag; tau += 1) {
    cumulative += d[tau];
    cmnd[tau] = d[tau] * (tau / (cumulative + 1e-12));
  }

  // No threshold: use the global minimum
  let tauEstimate = minLag;
  let minV = cmnd[minLag];
  for (let tau = minLag + 1; tau <= maxLag; tau += 1) {
    const v = cmnd[tau];
    if (v < minV) {
      minV = v;
      tauEstimate = tau;
    }
  }

  // Parabolic interpolation around the minimum
  let refinedTau = tauEstimate;
  if (tauEstimate > minLag && tauEstimate < maxLag) {
    const cM1 = cmnd[tauEstimate - 1];
    const c0 = cmnd[tauEstimate];
    const cP1 = cmnd[tauEstimate + 1];
    const denom = cM1 - 2 * c0 + cP1;
    if (abs(denom) > 1e-12) {
      const offset = (0.5 * (cM1 - cP1)) / denom;
      refinedTau = tauEstimate + clamp(offset, -0.5, 0.5);
    }
  }

  const freq = srEff / refinedTau;
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

function drawStaticBackgroundLayer(
  width: number,
  height: number,
  dpr: number,
  minMidi: number,
  maxMidi: number,
  showNoteLabels: boolean,
): HTMLCanvasElement {
  const bitmap = document.createElement('canvas');
  bitmap.width = Math.floor(width * dpr);
  bitmap.height = Math.floor(height * dpr);

  const context = bitmap.getContext('2d');
  if (!context) return bitmap;

  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  context.clearRect(0, 0, width, height);
  context.fillStyle = 'rgba(10, 5, 32, 0.9)';
  context.fillRect(0, 0, width, height);

  const visibleRangeSemitones = maxMidi - minMidi;
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

  return bitmap;
}

function isSameStaticLayer(
  layer: CanvasStaticLayer,
  width: number,
  height: number,
  dpr: number,
  minMidi: number,
  maxMidi: number,
  showNoteLabels: boolean,
): boolean {
  return (
    layer.width === width &&
    layer.height === height &&
    layer.dpr === dpr &&
    Math.abs(layer.minMidi - minMidi) < 1e-6 &&
    Math.abs(layer.maxMidi - maxMidi) < 1e-6 &&
    layer.showNoteLabels === showNoteLabels
  );
}

function findClosestPointByTime(
  points: PitchPoint[],
  hoveredTime: number,
  minTime: number,
): PitchPoint | null {
  if (points.length === 0) return null;

  let lo = 0;
  let hi = points.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (points[mid].time < hoveredTime) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }

  const centerIndex = lo;
  let best: PitchPoint | null = null;
  let bestDist = 0.5;

  const inspect = (index: number): void => {
    if (index < 0 || index >= points.length) return;
    const point = points[index];
    if (point.time < minTime || point.midi === null) return;
    const dist = Math.abs(point.time - hoveredTime);
    if (dist < bestDist) {
      bestDist = dist;
      best = point;
    }
  };

  inspect(centerIndex);
  inspect(centerIndex - 1);

  for (let step = 1; step <= MAX_NEAREST_SEARCH_STEPS; step += 1) {
    inspect(centerIndex - step);
    inspect(centerIndex + step);
  }

  return best;
}

function appendPitchPoint(points: PitchPoint[], point: PitchPoint): void {
  const previous = points[points.length - 1];
  const normalizedTime =
    previous && point.time <= previous.time ? previous.time + 1e-4 : point.time;
  points.push({
    time: normalizedTime,
    midi: point.midi,
  });
}

/** Canvas drawing optimized to avoid per-frame allocations */
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

  const dpr = window.devicePixelRatio ?? 1;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;

  const targetW = Math.floor(width * dpr);
  const targetH = Math.floor(height * dpr);
  if (canvas.width !== targetW) canvas.width = targetW;
  if (canvas.height !== targetH) canvas.height = targetH;

  const minTime = currentTime - timeWindowSeconds;
  const minMidi = centerMidi - visibleRangeSemitones / 2;
  const maxMidi = centerMidi + visibleRangeSemitones / 2;

  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  context.clearRect(0, 0, width, height);

  const cachedLayer = staticCanvasLayerCache.get(canvas);
  if (
    !cachedLayer ||
    !isSameStaticLayer(
      cachedLayer,
      width,
      height,
      dpr,
      minMidi,
      maxMidi,
      showNoteLabels,
    )
  ) {
    const bitmap = drawStaticBackgroundLayer(
      width,
      height,
      dpr,
      minMidi,
      maxMidi,
      showNoteLabels,
    );
    staticCanvasLayerCache.set(canvas, {
      width,
      height,
      dpr,
      minMidi,
      maxMidi,
      showNoteLabels,
      bitmap,
    });
  }

  const activeLayer = staticCanvasLayerCache.get(canvas);
  if (activeLayer) {
    context.drawImage(activeLayer.bitmap, 0, 0, width, height);
  }

  const xFromTime = (time: number): number =>
    ((time - minTime) / timeWindowSeconds) * width;
  const yFromMidi = (midi: number): number =>
    height - ((midi - minMidi) / visibleRangeSemitones) * height;

  // Helper to draw one series with pixel-step decimation
  const drawSeries = (points: PitchPoint[], stroke: string): void => {
    context.strokeStyle = stroke;
    context.lineWidth = 1.6;
    context.lineCap = 'round';
    context.lineJoin = 'round';

    let hasSegment = false;
    let lastX = -Infinity;

    for (let i = 0; i < points.length; i += 1) {
      const p = points[i];
      if (p.time < minTime - 0.5) continue; // outside the active window
      if (p.midi == null) {
        if (hasSegment) context.stroke();
        hasSegment = false;
        lastX = -Infinity;
        continue;
      }
      const x = xFromTime(p.time);
      if (x < -2 || x > width + 2) continue; // outside canvas bounds (with margin)
      // Pixel-based decimation
      if (x - lastX < MIN_X_STEP_PX) continue;
      lastX = x;

      const y = yFromMidi(p.midi);
      if (!hasSegment) {
        context.beginPath();
        context.moveTo(x, y);
        hasSegment = true;
      } else {
        context.lineTo(x, y);
      }
    }
    if (hasSegment) context.stroke();
  };

  // Draw series
  drawSeries(vocalsPoints, 'rgba(129, 140, 248, 0.95)');
  drawSeries(microphonePoints, 'rgba(34, 197, 94, 0.95)');

  // Gap markers (no detection) for vocals
  context.strokeStyle = 'rgba(244, 114, 182, 0.5)';
  context.lineWidth = 1;
  for (let i = 0; i < vocalsPoints.length; i += 1) {
    const point = vocalsPoints[i];
    if (point.time < minTime - 0.5) continue;
    if (point.midi !== null) continue;
    const x = xFromTime(point.time);
    const heightVal = height;
    context.beginPath();
    context.moveTo(x, heightVal - 12);
    context.lineTo(x, heightVal - 2);
    context.stroke();
  }

  // Time cursor
  context.strokeStyle = 'rgba(236, 72, 153, 0.8)';
  context.setLineDash([4, 4]);
  const currentX = xFromTime(currentTime);
  context.beginPath();
  context.moveTo(currentX, 0);
  context.lineTo(currentX, height);
  context.stroke();
  context.setLineDash([]);

  // Hover overlay
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

    const closestVocalsPoint = findClosestPointByTime(
      vocalsPoints,
      hoveredTime,
      minTime - 0.5,
    );
    const closestMicrophonePoint = findClosestPointByTime(
      microphonePoints,
      hoveredTime,
      minTime - 0.5,
    );

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

/**
 * Robust stabilization: gate + median + confidence-adaptive ramp limiter.
 * Octave continuity correction is intentionally removed.
 */
function stabilizePitch(
  state: PitchTrackProcessorState,
  detection: DetectionResult | null,
  nowMs: number,
): number | null {
  if (!detection || detection.confidence < YIN_CONFIDENCE_GATE) {
    state.transientCandidate = null;
    state.transientCandidateFrames = 0;
    return null;
  }

  // Raw MIDI directly from detected frequency
  const midi = frequencyToMidi(detection.frequency);

  // Sliding median for robust smoothing
  state.recentMidis.push(midi);
  if (state.recentMidis.length > MEDIAN_WINDOW) {
    state.recentMidis.splice(0, state.recentMidis.length - MEDIAN_WINDOW);
  }
  const sorted = state.recentMidis.slice().sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];

  // Reject one-frame transient spikes (impulsive noise)
  const last = state.lastSmoothedMidi;
  if (last != null) {
    const jump = Math.abs(median - last);
    if (
      jump > TRANSIENT_SPIKE_SEMITONES &&
      detection.confidence < TRANSIENT_ALLOW_CONFIDENCE
    ) {
      if (
        state.transientCandidate !== null &&
        Math.abs(state.transientCandidate - median) < 0.75
      ) {
        state.transientCandidateFrames += 1;
      } else {
        state.transientCandidate = median;
        state.transientCandidateFrames = 1;
      }

      if (state.transientCandidateFrames < TRANSIENT_CONFIRM_FRAMES) {
        return last;
      }
    } else {
      state.transientCandidate = null;
      state.transientCandidateFrames = 0;
    }

    // Hard outlier rejection when confidence is not high enough
    const deltaToMedian = Math.abs(midi - median);
    if (deltaToMedian > HARD_SPIKE_SEMITONES && detection.confidence < 0.7) {
      // Ignore spike and keep previous value
      return last;
    }
  }

  // Confidence-adaptive ramp limiter:
  // - High confidence allows faster transitions
  // - Low confidence keeps stronger damping
  const limitPerSec =
    RAMP_BASE_ST_PER_SEC +
    (RAMP_MAX_ST_PER_SEC - RAMP_BASE_ST_PER_SEC) * detection.confidence;

  let smoothed = median;
  const lastAt = state.lastSmoothedAt;
  if (last != null && lastAt != null) {
    const dt = Math.max(0.001, (nowMs - lastAt) / 1000);
    let limit = limitPerSec * dt;

    // Extra acceleration for clearly real jumps at high confidence
    if (Math.abs(median - last) > 3 && detection.confidence > 0.85) {
      limit = RAMP_MAX_ST_PER_SEC * dt;
    }

    if (Math.abs(smoothed - last) > limit) {
      smoothed = last + Math.sign(smoothed - last) * limit;
    }
  }

  state.lastSmoothedMidi = smoothed;
  state.lastSmoothedAt = nowMs;
  return smoothed;
}

export const __testUtils = {
  appendPitchPoint,
  createPitchTrackProcessorState,
  findClosestPointByTime,
  selectFftSize,
  stabilizePitch,
};

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
  const [isMicrophoneEnabled, setIsMicrophoneEnabled] = useState(true); // analysis only
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
  const lastDetectAtRef = useRef(0); // detection cadence clock, not draw cadence

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
        if (!url || stem === 'vocals') return acc;
        acc.push(url);
        return acc;
      }, []),
    [stemUrls],
  );

  const analysisSourceKey = useMemo((): string | null => {
    if (!resolvedVocalsUrl || !isEligible || !open) return null;
    return `${song.id}\n${resolvedVocalsUrl}\n${backingStemUrls.join('\n')}`;
  }, [backingStemUrls, isEligible, open, resolvedVocalsUrl, song.id]);

  const isAnalysisBlockedByCors =
    analysisSourceKey !== null && blockedSourceKey === analysisSourceKey;
  const isMicrophoneUnavailable =
    isMicrophoneEnabled && microphoneErrorKey !== null;

  useEffect(() => {
    if (!open || !isEligible) return;
    const { minCenter, maxCenter } = getCenterBounds(visibleRangeSemitones);
    centerMidiRef.current = clamp(centerMidiRef.current, minCenter, maxCenter);

    vocalsPointsRef.current = [];
    microphonePointsRef.current = [];
    resetPitchTrackProcessorState(vocalsProcessorRef.current);
    resetPitchTrackProcessorState(microphoneProcessorRef.current);
    lastDetectAtRef.current = 0;
  }, [open, isEligible, visibleRangeSemitones]);

  useEffect(() => {
    if (!open) return;
    const { minCenter, maxCenter } = getCenterBounds(visibleRangeSemitones);

    let attachedCanvas: HTMLCanvasElement | null = null;
    let animationFrameId = 0;

    const handleWheel = (event: WheelEvent): void => {
      if (isDynamicAxis) return;
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
      attachedCanvas.addEventListener('wheel', handleWheel, { passive: false });
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
    if (!open || !resolvedVocalsUrl || !isEligible) return;

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

    audioRef.current = audioElement;
    backingAudioRefs.current = backingElements;

    const context = new AudioContext();

    // ====== ANALYSIS (WITH PRECONDITIONING FILTERS) ======
    // Select minimum fftSize that supports MIN_FREQUENCY_HZ
    const analyserFftSize = selectFftSize(context.sampleRate);

    const vocalsAnalyser = context.createAnalyser();
    vocalsAnalyser.fftSize = analyserFftSize;
    vocalsAnalyser.smoothingTimeConstant = 0;

    const microphoneAnalyser = context.createAnalyser();
    microphoneAnalyser.fftSize = analyserFftSize;
    microphoneAnalyser.smoothingTimeConstant = 0;

    // Sources
    const vocalsSource = context.createMediaElementSource(audioElement);

    const backingGain = context.createGain();
    backingGain.gain.value = instrumentalEnabledRef.current ? 1 : 0;

    const backingSources = backingElements.map((element) =>
      context.createMediaElementSource(element),
    );

    // === Filter chain (analysis only) for vocals ===
    const vHP = context.createBiquadFilter();
    vHP.type = 'highpass';
    vHP.frequency.value = VOCALS_HP_HZ;
    vHP.Q.value = 0.707;

    const vNotch60 = context.createBiquadFilter();
    vNotch60.type = 'notch';
    vNotch60.frequency.value = HUM_FREQ_HZ;
    vNotch60.Q.value = NOTCH_Q;

    const vNotch120 = context.createBiquadFilter();
    vNotch120.type = 'notch';
    vNotch120.frequency.value = HUM_FREQ_HZ * 2;
    vNotch120.Q.value = NOTCH_Q;

    const vLP = context.createBiquadFilter();
    vLP.type = 'lowpass';
    vLP.frequency.value = LP_HZ;
    vLP.Q.value = 0.707;

    // Routing for analysis and playback
    // vocals -> filters -> analyser (analysis only)
    vocalsSource.connect(vHP);
    vHP.connect(vNotch60);
    vNotch60.connect(vNotch120);
    vNotch120.connect(vLP);
    vLP.connect(vocalsAnalyser);

    // vocals -> destination (audible, unfiltered)
    vocalsSource.connect(context.destination);

    // === Backing -> gain -> destination ===
    backingSources.forEach((source) => source.connect(backingGain));
    backingGain.connect(context.destination);

    const handleAudioError = (): void => {
      if (analysisSourceKey !== null) setBlockedSourceKey(analysisSourceKey);
    };
    const handleCanPlay = (): void => {
      setBlockedSourceKey((currentKey) =>
        currentKey === analysisSourceKey ? null : currentKey,
      );
      setIsAudioLoaded(true);
    };
    const handleEnded = (): void => {
      setIsPracticePlaying(false);
      backingElements.forEach((element) => element.pause());
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
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        const microphoneSource = context.createMediaStreamSource(stream);

        // === Filter chain (analysis only) for microphone ===
        const mHP = context.createBiquadFilter();
        mHP.type = 'highpass';
        mHP.frequency.value = MIC_HP_HZ;
        mHP.Q.value = 0.707;

        const mNotch60 = context.createBiquadFilter();
        mNotch60.type = 'notch';
        mNotch60.frequency.value = HUM_FREQ_HZ;
        mNotch60.Q.value = NOTCH_Q;

        const mNotch120 = context.createBiquadFilter();
        mNotch120.type = 'notch';
        mNotch120.frequency.value = HUM_FREQ_HZ * 2;
        mNotch120.Q.value = NOTCH_Q;

        const mLP = context.createBiquadFilter();
        mLP.type = 'lowpass';
        mLP.frequency.value = LP_HZ;
        mLP.Q.value = 0.707;

        // mic -> filters -> analyser (never routed to destination)
        microphoneSource.connect(mHP);
        mHP.connect(mNotch60);
        mNotch60.connect(mNotch120);
        mNotch120.connect(mLP);
        mLP.connect(microphoneAnalyser);

        microphoneStreamRef.current = stream;
        microphoneAnalyserRef.current = microphoneAnalyser;
        microphoneFrameRef.current = new Float32Array(
          microphoneAnalyser.fftSize,
        ) as TimeDomainFrame;

        setMicrophoneErrorKey(null);
        setIsMicrophoneReady(true);
      } catch (error: unknown) {
        if (isDisposed) return;
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
        microphoneStream.getTracks().forEach((track) => track.stop());
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
    if (!backingGain) return;
    backingGain.gain.value = isInstrumentalEnabled ? 1 : 0;
  }, [isInstrumentalEnabled]);

  // Microphone switch controls analysis only (no monitoring)
  useEffect(() => {
    microphoneEnabledRef.current = isMicrophoneEnabled;
  }, [isMicrophoneEnabled]);

  useEffect(() => {
    if (!open || !isEligible || !resolvedVocalsUrl) return;

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
            if (element.paused) void element.play().catch(() => undefined);
          });
        } else if (!audioElement.paused) {
          audioElement.pause();
          backingElements.forEach((element) => {
            if (!element.paused) element.pause();
          });
        }

        // Keep backing stems synchronized with vocals
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

      // === DETECTION (~60 Hz) ===
      if (audioElement && vocalsAnalyser && vocalsFrame) {
        const now = performance.now();
        const elapsedMs = now - lastDetectAtRef.current;
        if (elapsedMs >= DETECTION_INTERVAL_MS) {
          if (lastDetectAtRef.current === 0) {
            lastDetectAtRef.current = now;
          } else {
            const overshoot = elapsedMs % DETECTION_INTERVAL_MS;
            lastDetectAtRef.current = now - overshoot;
          }

          let vocalsDisplayMidi: number | null = null;
          if (!isAnalysisBlockedByCors) {
            vocalsAnalyser.getFloatTimeDomainData(vocalsFrame);
            const rms = calcRms(vocalsFrame as Float32Array);
            if (rms >= MIN_RMS_GATE) {
              applyHannWindow(vocalsFrame as Float32Array);
              const det = detectPitchYINFromFrame(
                vocalsFrame,
                vocalsAnalyser.context.sampleRate,
              );
              vocalsDisplayMidi = stabilizePitch(
                vocalsProcessorRef.current,
                det,
                now,
              );
            } else {
              vocalsDisplayMidi = null;
            }
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
            const rmsMic = calcRms(microphoneFrame as Float32Array);
            if (rmsMic >= MIN_RMS_GATE) {
              applyHannWindow(microphoneFrame as Float32Array);
              const detMic = detectPitchYINFromFrame(
                microphoneFrame,
                microphoneAnalyser.context.sampleRate,
              );
              microphoneDisplayMidi = stabilizePitch(
                microphoneProcessorRef.current,
                detMic,
                now,
              );
            } else {
              microphoneDisplayMidi = null;
            }
          } else {
            resetPitchTrackProcessorState(microphoneProcessorRef.current);
          }

          const axisReferenceMidi = vocalsDisplayMidi ?? microphoneDisplayMidi;

          // Dynamic vertical-axis recentering (visual only)
          if (axisReferenceMidi !== null && isDynamicAxis) {
            let { minCenter, maxCenter } = getCenterBounds(
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
            const bounds = getCenterBounds(visibleRangeSemitones);
            minCenter = bounds.minCenter;
            maxCenter = bounds.maxCenter;
            centerMidiRef.current = clamp(
              centerMidiRef.current,
              minCenter,
              maxCenter,
            );
          }

          // Store pitch points with bounded history
          appendPitchPoint(vocalsPointsRef.current, {
            time: audioElement.currentTime,
            midi: vocalsDisplayMidi,
          });

          const isMicrophoneTrackActive2 =
            microphoneEnabledRef.current && microphoneErrorKey === null;

          appendPitchPoint(microphonePointsRef.current, {
            time: audioElement.currentTime,
            midi: isMicrophoneTrackActive2 ? microphoneDisplayMidi : null,
          });

          const nextReadout: PracticeReadout = {
            vocalsNoteLabel:
              vocalsDisplayMidi !== null
                ? midiToNoteLabel(vocalsDisplayMidi)
                : null,
            microphoneNoteLabel:
              isMicrophoneTrackActive2 && microphoneDisplayMidi !== null
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

          const minHistoryTime =
            audioElement.currentTime - windowSeconds * HISTORY_FACTOR;
          trimPitchPoints(vocalsPointsRef.current, minHistoryTime);
          trimPitchPoints(microphonePointsRef.current, minHistoryTime);
        }
      }

      // === DRAW (every animation frame) ===
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
    if (isAnalysisBlockedByCors) return t('status.corsBlocked');
    if (isMicrophoneUnavailable) {
      if (microphoneErrorKey === 'denied') return t('status.microphone.denied');
      if (microphoneErrorKey === 'unsupported')
        return t('status.microphone.unsupported');
      return t('status.microphone.unavailable');
    }
    if (isMicrophoneEnabled && !isMicrophoneReady)
      return t('status.microphone.connecting');
    if (!isAudioLoaded) return t('status.syncing');
    if (!isPracticePlaying) return t('status.waitingPlayback');
    if (readout.vocalsNoteLabel === null) return t('status.unvoiced');
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
    if (!isMicrophoneUnavailable || microphoneErrorKey === null) return null;
    if (microphoneErrorKey === 'denied') return t('microphone.denied');
    if (microphoneErrorKey === 'unsupported')
      return t('microphone.unsupported');
    return t('microphone.unavailable');
  }, [isMicrophoneUnavailable, microphoneErrorKey, t]);

  const handleSeekBy = (deltaSec: number): void => {
    const audioElement = audioRef.current;
    if (!audioElement) return;
    const { duration } = audioElement;
    if (!isFinite(duration) || duration <= 0) return;

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
      // Clear revisited interval after backward seek
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
      // Forward seek: break line continuity with a sentinel point
      appendPitchPoint(vocalsPointsRef.current, { time: from, midi: null });
      appendPitchPoint(microphonePointsRef.current, { time: from, midi: null });
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

            {/* Controls */}
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
          </Stack>
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
