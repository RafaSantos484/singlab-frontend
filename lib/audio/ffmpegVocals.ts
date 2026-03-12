'use client';
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';

// === Fixed internal parameters (not exposed to callers) ===
const SILENCE_NOISE_DB = -45;
/**
 * Minimum silence duration for detection (must be small to catch all gaps).
 * This is the FFmpeg silencedetect threshold — NOT the max kept silence.
 */
const SILENCE_DETECT_MIN_S = 0.5;
/**
 * Maximum silence duration preserved between two speech segments.
 * Silences longer than this are trimmed down to exactly this value.
 * Leading and trailing silences are always removed completely.
 */
const SILENCE_MAX_KEPT_S = 3.0;
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
 * A continuous segment (speech or kept silence) in the vocals track with
 * coordinates in both the original and the silence-removed audio timelines.
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
  /** 16 kHz mono WAV blob with silence gaps trimmed. Ready for Whisper. */
  processedBlob: Blob;
  /**
   * Ordered speech segments mapping processed ↔ original timeline.
   * Pass to {@link remapWordTimestamps} after transcription.
   */
  speechSegments: SpeechSegment[];
  /**
   * Human-readable cut map lines (one per interval), e.g.:
   * "[silence] 0:00.00 — 0:28.00 (28.00s) → removed"
   * "[speech]  0:28.00 — 0:30.61 (2.61s)"
   * "[silence] 0:30.61 — 0:45.00 (14.39s) → kept 10.00s"
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
 * Matches lines like: ` Duration: 00:03:25.12, start: 0.000000, ...`
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

  // Handle a trailing silence_start with no silence_end (audio ends in silence)
  if (pendingStart !== null) {
    silences.push({ start: pendingStart, end: Infinity });
  }

  return silences
    .filter((s) => Number.isFinite(s.start) && s.end > s.start)
    .sort((a, b) => a.start - b.start);
}

// === Cut-map builders ===

/**
 * Represents a trimmed interval in the output audio.
 * type='speech'   → kept as-is
 * type='silence'  → silence kept up to SILENCE_MAX_KEPT_S (keptDuration)
 *                   or fully removed (keptDuration = 0)
 */
interface OutputInterval {
  originalStart: number;
  originalEnd: number;
  type: 'speech' | 'silence';
  /** How many seconds of this interval are kept in the output (0 = removed). */
  keptDuration: number;
}

/**
 * Builds the list of output intervals by:
 * 1. Replacing leading/trailing silence with removed intervals.
 * 2. Clamping intermediate silences to at most SILENCE_MAX_KEPT_S.
 * 3. Keeping all speech segments unchanged.
 */
function buildOutputIntervals(
  silences: SilenceInterval[],
  totalDuration: number,
): OutputInterval[] {
  // Clamp silence ends that extend beyond total duration
  const clampedSilences = silences.map((s) => ({
    start: s.start,
    end: Math.min(s.end, totalDuration),
  }));

  type RawInterval = { start: number; end: number; type: 'speech' | 'silence' };
  const raw: RawInterval[] = [];
  let cursor = 0;

  for (const s of clampedSilences) {
    if (s.start > cursor) {
      raw.push({ start: cursor, end: s.start, type: 'speech' });
    }
    raw.push({ start: s.start, end: s.end, type: 'silence' });
    cursor = s.end;
  }
  if (cursor < totalDuration) {
    raw.push({ start: cursor, end: totalDuration, type: 'speech' });
  }

  // Determine first and last speech index to identify leading/trailing silences
  const firstSpeechIdx = raw.findIndex((iv) => iv.type === 'speech');
  const lastSpeechIdx = [...raw]
    .reverse()
    .findIndex((iv) => iv.type === 'speech');
  const lastSpeechIdxFromStart =
    lastSpeechIdx === -1 ? -1 : raw.length - 1 - lastSpeechIdx;

  return raw.map((iv, idx): OutputInterval => {
    if (iv.type === 'speech') {
      return {
        originalStart: iv.start,
        originalEnd: iv.end,
        type: 'speech',
        keptDuration: iv.end - iv.start,
      };
    }

    // Silence interval
    const silenceDuration = iv.end - iv.start;
    const isLeading = firstSpeechIdx === -1 || idx < firstSpeechIdx;
    const isTrailing =
      lastSpeechIdxFromStart === -1 || idx > lastSpeechIdxFromStart;

    if (isLeading || isTrailing) {
      // Remove completely
      return {
        originalStart: iv.start,
        originalEnd: iv.end,
        type: 'silence',
        keptDuration: 0,
      };
    }

    // Intermediate silence: keep at most SILENCE_MAX_KEPT_S
    const kept = Math.min(silenceDuration, SILENCE_MAX_KEPT_S);
    return {
      originalStart: iv.start,
      originalEnd: iv.end,
      type: 'silence',
      keptDuration: kept,
    };
  });
}

/**
 * Converts output intervals into SpeechSegments for timestamp remapping.
 *
 * Each kept interval (speech or partial silence) becomes a segment with
 * both original and processed coordinates.
 */
function buildSpeechSegments(intervals: OutputInterval[]): SpeechSegment[] {
  const segments: SpeechSegment[] = [];
  let processedOffset = 0;

  for (const iv of intervals) {
    if (iv.keptDuration <= 0) continue;

    // For intermediate silence we keep only the tail (end of the silence gap)
    // so it naturally leads into the next speech segment.
    const originalStart =
      iv.type === 'silence'
        ? iv.originalEnd - iv.keptDuration
        : iv.originalStart;
    const originalEnd = iv.type === 'silence' ? iv.originalEnd : iv.originalEnd;

    segments.push({
      originalStart,
      originalEnd,
      processedStart: processedOffset,
      processedEnd: processedOffset + iv.keptDuration,
    });
    processedOffset += iv.keptDuration;
  }

  return segments.filter((s) => s.originalEnd > s.originalStart);
}

function formatTimecode(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = (seconds % 60).toFixed(2).padStart(5, '0');
  return `${m}:${s}`;
}

/**
 * Formats a human-readable cut map showing every interval with its fate.
 */
function formatCutMap(intervals: OutputInterval[]): string[] {
  return intervals.map((iv) => {
    const silenceDuration = iv.originalEnd - iv.originalStart;
    const label = iv.type === 'silence' ? '[silence]' : '[speech] ';
    const range = `${formatTimecode(iv.originalStart)} — ${formatTimecode(iv.originalEnd)} (${silenceDuration.toFixed(2)}s)`;

    if (iv.type === 'speech') {
      return `${label} ${range}`;
    }
    if (iv.keptDuration <= 0) {
      return `${label} ${range} → removed`;
    }
    return `${label} ${range} → kept ${iv.keptDuration.toFixed(2)}s`;
  });
}

// === Public API ===
/**
 * Removes/trims silences from a vocals audio blob using FFmpeg WASM.
 *
 * **Pipeline:**
 * 1. Runs `silencedetect` to find all silence intervals.
 * 2. Removes leading/trailing silences completely.
 * 3. Trims intermediate silences to at most `SILENCE_MAX_KEPT_S` seconds.
 * 4. Builds a {@link SpeechSegment} cut map linking original ↔ processed time.
 * 5. Cuts and concatenates kept intervals via `atrim+asetpts+concat`.
 * 6. Exports a 16 kHz mono WAV suitable for Whisper.
 *
 * All tuning parameters are fixed internally:
 * - Noise floor: -45 dB
 * - Silence detection threshold: 0.1 s
 * - Max kept intermediate silence: 10.0 s
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

  // Step 1: Detect silences.
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
      `silencedetect=noise=${SILENCE_NOISE_DB}dB:d=${SILENCE_DETECT_MIN_S}`,
      '-f',
      'null',
      '-',
    ]);
  } finally {
    ffmpeg.off('log', onLog);
  }

  const totalDuration = parseDurationFromLog(logLines) ?? 0;
  const silences = parseSilenceLog(logLines);

  const outputIntervals = buildOutputIntervals(silences, totalDuration);
  const speechSegments = buildSpeechSegments(outputIntervals);
  const cutMapLines = formatCutMap(outputIntervals);

  // Step 2: Cut and concatenate kept intervals via atrim+concat filter graph.
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
