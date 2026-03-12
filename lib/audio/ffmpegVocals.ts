'use client';
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';

// === Fixed internal parameters (not exposed to callers) ===
const SILENCE_NOISE_DB = -45;
/**
 * Ta: Silence detection threshold (seconds).
 * A contiguous region is considered "silence" only when its duration is
 * greater than or equal to this value. Passed to FFmpeg's `silencedetect`
 * filter as the `d=` parameter.
 */
const SILENCE_DETECTION_THRESHOLD_S = 0.01;
/**
 * Tb: Normalized silence duration (seconds).
 * Every detected silence (duration >= Ta) is replaced in the processed
 * audio with an explicit silence segment whose duration is exactly Tb.
 * Leading/trailing silences are removed completely; intermediate silences
 * detected by the rule above become silence regions of length Tb in the
 * processed output.
 */
const SILENCE_NORMALIZED_DURATION_S = 2.0;
/**
 * Minimum speech duration (seconds).
 * Speech intervals shorter than this value are treated as silence and
 * converted to normalized silence intervals before merging and audio
 * synthesis. This allows tiny spurious speech fragments (near 0s) to be
 * collapsed into the surrounding silence.
 */
const MIN_SPEECH_DURATION_S = 0.1;
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
  /** Segment type from the cut map: 'speech' or 'silence' (kept normalized). */
  type: 'speech' | 'silence';
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
 * type='silence'  → intermediate detected silences are replaced by a
 *                   normalized silence region of length Tb (see
 *                   `SILENCE_NORMALIZED_DURATION_S`); leading/trailing
 *                   silences are removed completely (keptDuration = 0).
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
 * 2. Replacing intermediate detected silences (duration >= Ta) with a
 *    fixed-length silence of exactly Tb seconds.
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

  // Convert tiny speech intervals into silence before determining leading/
  // trailing silences and kept durations. This conversion happens prior to
  // merging so adjacent short speech fragments become part of sibling
  // silence intervals.
  for (const iv of raw) {
    if (iv.type === 'speech') {
      const dur = iv.end - iv.start;
      if (dur < MIN_SPEECH_DURATION_S) {
        iv.type = 'silence';
      }
    }
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

    // Intermediate silence: normalize detected silence to exactly Tb
    const kept = SILENCE_NORMALIZED_DURATION_S;
    return {
      originalStart: iv.start,
      originalEnd: iv.end,
      type: 'silence',
      keptDuration: kept,
    };
  });
}

/**
 * Merge consecutive output intervals that have the same `type`.
 * - For `speech` intervals we merge original ranges and sum keptDuration
 *   (keptDuration for speech equals original span).
 * - For `silence` intervals we merge original ranges and produce a single
 *   normalized keptDuration: if any merged silence had keptDuration > 0
 *   (i.e., was kept), the merged keptDuration becomes a single Tb value.
 *   If all merged silences were removed (keptDuration === 0) the result
 *   remains removed (keptDuration = 0).
 */
function mergeAdjacentIntervals(intervals: OutputInterval[]): OutputInterval[] {
  if (intervals.length === 0) return [];
  const out: OutputInterval[] = [];
  for (const iv of intervals) {
    const last = out[out.length - 1];
    if (!last || last.type !== iv.type) {
      out.push({ ...iv });
      continue;
    }

    // Same type — merge into `last`.
    last.originalEnd = iv.originalEnd;

    if (last.type === 'speech') {
      // For speech, keptDuration should equal the full original span.
      last.keptDuration = last.originalEnd - last.originalStart;
    } else {
      // Silence: if any part was kept, merged keptDuration becomes exactly Tb;
      // otherwise it's removed (0).
      const anyKept = last.keptDuration > 0 || iv.keptDuration > 0;
      last.keptDuration = anyKept ? SILENCE_NORMALIZED_DURATION_S : 0;
    }
  }

  return out;
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

    // For all kept intervals (speech or silence) map to the full original
    // interval. When processed and original durations differ the remapping
    // logic will scale processed-time positions into the original span.
    const originalStart = iv.originalStart;
    const originalEnd = iv.originalEnd;

    segments.push({
      originalStart,
      originalEnd,
      processedStart: processedOffset,
      processedEnd: processedOffset + iv.keptDuration,
      type: iv.type,
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
 * 3. Replaces intermediate detected silences (duration >= Ta) with a fixed
 *    silence segment of exactly Tb seconds.
 * 4. Builds a {@link SpeechSegment} cut map linking original ↔ processed time.
 * 5. Cuts and concatenates kept intervals via `atrim+asetpts+concat`.
 * 6. Exports a 16 kHz mono WAV suitable for Whisper.
 *
 * All tuning parameters are fixed internally (see constants at the top):
 * - Noise floor: -45 dB
 * - Silence detection threshold (Ta): `SILENCE_DETECTION_THRESHOLD_S` (seconds)
 * - Normalized silence duration (Tb): `SILENCE_NORMALIZED_DURATION_S` (seconds)
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
      `silencedetect=noise=${SILENCE_NOISE_DB}dB:d=${SILENCE_DETECTION_THRESHOLD_S}`,
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
  // Merge adjacent intervals of the same type (collapses consecutive
  // short silences into a single silence, and consecutive speech into one).
  const mergedIntervals = mergeAdjacentIntervals(outputIntervals);
  // Keep only intervals that contribute audio to the processed output
  // (speech intervals and normalized intermediate silences with keptDuration>0).
  const keptIntervals = mergedIntervals.filter((iv) => iv.keptDuration > 0);
  const speechSegments = buildSpeechSegments(keptIntervals);
  const cutMapLines = formatCutMap(mergedIntervals);

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
    // Build filter graph using the kept intervals. For speech intervals we
    // extract the original audio fragment. For silence intervals we generate
    // synthetic silence using `anullsrc` trimmed to the normalized Tb length.
    const segmentFilters = keptIntervals
      .map((iv, i) => {
        if (iv.type === 'speech') {
          return `[0:a]atrim=start=${iv.originalStart.toFixed(6)}:end=${iv.originalEnd.toFixed(6)},asetpts=PTS-STARTPTS[s${i}]`;
        }
        // Silence: synthesize silence of duration = keptDuration (Tb)
        return `anullsrc=channel_layout=mono:sample_rate=${OUTPUT_SAMPLE_RATE},atrim=duration=${iv.keptDuration.toFixed(6)},asetpts=PTS-STARTPTS[s${i}]`;
      })
      .join(';');
    const concatInputs = keptIntervals.map((_, i) => `[s${i}]`).join('');
    const filterGraph = `${segmentFilters};${concatInputs}concat=n=${keptIntervals.length}:v=0:a=1[aout]`;

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
