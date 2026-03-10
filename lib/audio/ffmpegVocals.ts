'use client';

import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';

// === Fixed internal parameters (not exposed to callers) ===
const SILENCE_NOISE_DB = -45;
const SILENCE_MIN_DURATION_S = 0.3;
const OUTPUT_SAMPLE_RATE = 16000;
const OUTPUT_CHANNELS = 1;
const FFMPEG_CORE_CDN =
  'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/umd';

// Minimal valid WAV: 44-byte PCM header + 2 bytes of silence (16 kHz mono)
const EMPTY_WAV = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0x26, 0x00, 0x00, 0x00, 0x57, 0x41, 0x56, 0x45, 0x66,
  0x6d, 0x74, 0x20, 0x10, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x80, 0x3e,
  0x00, 0x00, 0x00, 0x7d, 0x00, 0x00, 0x02, 0x00, 0x10, 0x00, 0x64, 0x61, 0x74,
  0x61, 0x02, 0x00, 0x00, 0x00, 0x00, 0x00,
]);

/**
 * A continuous speech segment in the vocals track with coordinates in both
 * the original and the silence-removed audio timelines.
 *
 * Used to reconstruct word timestamps after Whisper transcribes the
 * silence-removed audio: a word timestamped at `processedStart..processedEnd`
 * in the processed audio maps back to `originalStart..originalEnd` in the
 * source vocals track.
 */
export interface SpeechSegment {
  /** Start time in the original vocals audio (seconds). */
  originalStart: number;
  /** End time in the original vocals audio (seconds). */
  originalEnd: number;
  /** Corresponding start time in the silence-removed audio (seconds). */
  processedStart: number;
  /** Corresponding end time in the silence-removed audio (seconds). */
  processedEnd: number;
}

/** Result returned by {@link removeSilencesFromVocals}. */
export interface SilenceRemovalResult {
  /** 16 kHz mono WAV blob with all silence gaps removed. Ready for Whisper. */
  processedBlob: Blob;
  /**
   * Ordered speech segments mapping processed ↔ original timeline.
   * Pass to {@link remapWordTimestamps} after transcription.
   */
  speechSegments: SpeechSegment[];
  /**
   * Human-readable cut map lines (one per interval), e.g.:
   *   "[silence] 0:00.00 — 0:28.00 (28.00s)"
   *   "[speech]  0:28.00 — 0:30.61 (2.61s)"
   */
  cutMapLines: string[];
}

// === Singleton FFmpeg instance ===

let ffmpegInstance: FFmpeg | null = null;

async function getFFmpeg(): Promise<FFmpeg> {
  if (ffmpegInstance) return ffmpegInstance;

  const ffmpeg = new FFmpeg();
  await ffmpeg.load({
    coreURL: await toBlobURL(
      `${FFMPEG_CORE_CDN}/ffmpeg-core.js`,
      'text/javascript',
    ),
    wasmURL: await toBlobURL(
      `${FFMPEG_CORE_CDN}/ffmpeg-core.wasm`,
      'application/wasm',
    ),
  });

  ffmpegInstance = ffmpeg;
  return ffmpeg;
}

// === Internal helpers ===

function uniqueId(): string {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function getFileExtension(mimeType: string | null | undefined): string {
  if (!mimeType) return 'bin';
  if (mimeType.includes('wav')) return 'wav';
  if (mimeType.includes('mp3')) return 'mp3';
  if (mimeType.includes('ogg') || mimeType.includes('opus')) return 'ogg';
  if (mimeType.includes('webm')) return 'webm';
  if (mimeType.includes('flac')) return 'flac';
  if (
    mimeType.includes('m4a') ||
    mimeType.includes('mp4') ||
    mimeType.includes('aac')
  )
    return 'm4a';
  return 'bin';
}

function safeDeleteFile(ffmpeg: FFmpeg, name: string): void {
  try {
    ffmpeg.deleteFile(name);
  } catch {
    // File may not exist — safe to ignore.
  }
}

// === Log parsers ===

/**
 * Parses total audio duration from FFmpeg log.
 * Matches lines like: `  Duration: 00:03:25.12, start: 0.000000, ...`
 */
function parseDurationFromLog(lines: string[]): number | null {
  const pattern = /Duration:\s*(\d{2}):(\d{2}):(\d{2})\.(\d+)/;
  for (const line of lines) {
    const m = line.match(pattern);
    if (m) {
      const h = parseInt(m[1], 10);
      const min = parseInt(m[2], 10);
      const s = parseInt(m[3], 10);
      const frac = parseFloat(`0.${m[4]}`);
      return h * 3600 + min * 60 + s + frac;
    }
  }
  return null;
}

interface SilenceInterval {
  start: number;
  end: number;
}

/**
 * Parses `silencedetect` filter lines from FFmpeg log output.
 *
 * Handles both line forms emitted by the filter:
 * - `[silencedetect @ 0x…] silence_start: 0.056`
 * - `[silencedetect @ 0x…] silence_end: 13.20 | silence_duration: 13.14`
 */
function parseSilenceLog(lines: string[]): SilenceInterval[] {
  const silences: SilenceInterval[] = [];
  let pendingStart: number | null = null;

  const startPattern = /silence_start:\s*([0-9.]+)/i;
  const endPattern =
    /silence_end:\s*([0-9.]+).*?silence_duration:\s*([0-9.]+)/i;

  for (const line of lines) {
    const startMatch = line.match(startPattern);
    if (startMatch) {
      pendingStart = parseFloat(startMatch[1]);
      continue;
    }

    const endMatch = line.match(endPattern);
    if (endMatch) {
      const end = parseFloat(endMatch[1]);
      const duration = parseFloat(endMatch[2]);
      const start = pendingStart ?? Math.max(0, end - duration);
      silences.push({ start, end });
      pendingStart = null;
    }
  }

  return silences
    .filter(
      (s) =>
        Number.isFinite(s.start) && Number.isFinite(s.end) && s.end > s.start,
    )
    .sort((a, b) => a.start - b.start);
}

// === Cut-map builders ===

/**
 * Builds an ordered list of {@link SpeechSegment}s from detected silence
 * intervals. Each segment carries both original-audio and processed-audio
 * coordinates so timestamps can be remapped after transcription.
 */
function buildSpeechSegments(
  silences: SilenceInterval[],
  totalDuration: number,
): SpeechSegment[] {
  const segments: SpeechSegment[] = [];
  let originalCursor = 0;
  let processedOffset = 0;

  for (const silence of silences) {
    const speechStart = Math.max(0, Math.min(totalDuration, originalCursor));
    const speechEnd = Math.max(0, Math.min(totalDuration, silence.start));

    if (speechEnd > speechStart) {
      const len = speechEnd - speechStart;
      segments.push({
        originalStart: speechStart,
        originalEnd: speechEnd,
        processedStart: processedOffset,
        processedEnd: processedOffset + len,
      });
      processedOffset += len;
    }

    originalCursor = Math.max(originalCursor, silence.end);
  }

  // Any remaining audio after the last silence is all speech.
  if (originalCursor < totalDuration) {
    const len = totalDuration - originalCursor;
    segments.push({
      originalStart: originalCursor,
      originalEnd: totalDuration,
      processedStart: processedOffset,
      processedEnd: processedOffset + len,
    });
  }

  return segments.filter((s) => s.originalEnd > s.originalStart);
}

function formatTimecode(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = (seconds % 60).toFixed(2).padStart(5, '0');
  return `${m}:${s}`;
}

/**
 * Formats a human-readable cut map showing every silence and speech interval
 * with start, end, and duration.
 *
 * Example:
 * ```
 * [silence] 0:00.00 — 0:28.00 (28.00s)
 * [speech]  0:28.00 — 0:30.61 (2.61s)
 * ```
 */
function formatCutMap(
  silences: SilenceInterval[],
  totalDuration: number,
): string[] {
  type Interval = { start: number; end: number; type: 'silence' | 'speech' };
  const intervals: Interval[] = [];
  let cursor = 0;

  for (const s of silences) {
    if (s.start > cursor) {
      intervals.push({ start: cursor, end: s.start, type: 'speech' });
    }
    intervals.push({ start: s.start, end: s.end, type: 'silence' });
    cursor = s.end;
  }

  if (cursor < totalDuration) {
    intervals.push({ start: cursor, end: totalDuration, type: 'speech' });
  }

  return intervals.map((iv) => {
    const label = iv.type === 'silence' ? '[silence]' : '[speech] ';
    const dur = (iv.end - iv.start).toFixed(2);
    return `${label} ${formatTimecode(iv.start)} — ${formatTimecode(iv.end)} (${dur}s)`;
  });
}

// === Public API ===

/**
 * Removes silences from a vocals audio blob using FFmpeg WASM.
 *
 * **Pipeline:**
 * 1. Runs `silencedetect` to find silence intervals. Parses total duration from
 *    the same FFmpeg pass (no extra decode step needed).
 * 2. Builds a {@link SpeechSegment} cut map linking original ↔ processed time.
 * 3. Cuts and concatenates speech segments via `atrim+asetpts+concat`.
 * 4. Exports a 16 kHz mono WAV suitable for Whisper.
 *
 * All tuning parameters are fixed internally:
 * - Noise floor: -45 dB
 * - Minimum silence duration: 0.3 s
 * - Output: 16 kHz, 1 channel, WAV
 *
 * @param audioBlob - Vocals audio blob in any format supported by FFmpeg.
 * @returns Processed audio blob, speech segment map, and formatted cut map.
 */
export async function removeSilencesFromVocals(
  audioBlob: Blob,
): Promise<SilenceRemovalResult> {
  const ffmpeg = await getFFmpeg();
  const ext = getFileExtension(audioBlob.type);
  const id = uniqueId();
  const inputFile = `vocals_${id}.${ext}`;
  const outputFile = `processed_${id}.wav`;

  await ffmpeg.writeFile(inputFile, await fetchFile(audioBlob));

  // Step 1: Detect silences. Capture all log lines so we can also parse the
  // total Duration header emitted by FFmpeg for the input file.
  const logLines: string[] = [];
  const onLog = ({ message }: { message: string }): void => {
    logLines.push(message);
  };

  ffmpeg.on('log', onLog);
  try {
    await ffmpeg.exec([
      '-hide_banner',
      '-i',
      inputFile,
      '-af',
      `silencedetect=noise=${SILENCE_NOISE_DB}dB:d=${SILENCE_MIN_DURATION_S}`,
      '-f',
      'null',
      '-',
    ]);
  } finally {
    ffmpeg.off('log', onLog);
  }

  const totalDuration = parseDurationFromLog(logLines) ?? 0;
  const silences = parseSilenceLog(logLines);
  const speechSegments = buildSpeechSegments(silences, totalDuration);
  const cutMapLines = formatCutMap(silences, totalDuration);

  // Step 2: Cut and concatenate speech segments via atrim+concat filter graph.
  if (speechSegments.length === 0) {
    safeDeleteFile(ffmpeg, inputFile);
    return {
      processedBlob: new Blob([EMPTY_WAV], { type: 'audio/wav' }),
      speechSegments: [],
      cutMapLines,
    };
  }

  try {
    const segmentFilters = speechSegments
      .map(
        (seg, i) =>
          `[0:a]atrim=start=${seg.originalStart.toFixed(6)}:end=${seg.originalEnd.toFixed(6)},asetpts=PTS-STARTPTS[s${i}]`,
      )
      .join(';');

    const concatInputs = speechSegments.map((_, i) => `[s${i}]`).join('');
    const filterGraph = `${segmentFilters};${concatInputs}concat=n=${speechSegments.length}:v=0:a=1[aout]`;

    await ffmpeg.exec([
      '-hide_banner',
      '-nostats',
      '-i',
      inputFile,
      '-filter_complex',
      filterGraph,
      '-map',
      '[aout]',
      '-ac',
      String(OUTPUT_CHANNELS),
      '-ar',
      String(OUTPUT_SAMPLE_RATE),
      outputFile,
    ]);

    const rawData = (await ffmpeg.readFile(outputFile)) as Uint8Array;
    const processedBlob = new Blob([rawData.slice(0)], { type: 'audio/wav' });
    return { processedBlob, speechSegments, cutMapLines };
  } finally {
    safeDeleteFile(ffmpeg, inputFile);
    safeDeleteFile(ffmpeg, outputFile);
  }
}
