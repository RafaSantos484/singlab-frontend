/**
 * Pure types and text-processing utilities for lyrics adaptation.
 *
 * Contains no side effects, no LLM, and no async I/O — safe to import
 * anywhere, including SSR. The heavy work (LLM inference) lives entirely
 * in lyricsAdapter.worker.ts.
 */
import type { TranscriptChunk } from './types';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type AdaptationStatus = 'matched' | 'corrected' | 'unmatched';

export interface AdaptedChunk {
  /** Chunk index in the original transcript output. */
  index: number;
  /** Raw text as recognised by Whisper. */
  rawText: string;
  /** Best text after lyrics alignment (may equal rawText when unmatched). */
  adaptedText: string;
  /** Timestamp pair from the original chunk. */
  timestamp: [number, number | null];
  /** How the adaptation ended. */
  status: AdaptationStatus;
  /** Similarity score in [0, 1] against the chosen lyric span. */
  score: number;
  /**
   * How many times this chunk has been retried.
   * 0 = never retried (first adaptation run).
   */
  retryCount: number;
  /**
   * 0-based index of the first matched line in the full parsed lyrics array.
   * Undefined for unmatched segments or when the lyric position is unknown.
   */
  lyricIdxStart?: number;
  /**
   * 0-based index of the last matched line in the full parsed lyrics array.
   * Undefined for unmatched segments or when the lyric position is unknown.
   */
  lyricIdxEnd?: number;
}

// ---------------------------------------------------------------------------
// Worker message protocol
// ---------------------------------------------------------------------------

export type LyricsAdapterRequest =
  | {
      type: 'adapt';
      jobId: number;
      chunks: TranscriptChunk[];
      lyrics: string;
      skipLLM: boolean;
    }
  | {
      /** Retry a single chunk with an escalated prompt. */
      type: 'retry-chunk';
      jobId: number;
      /** Original chunk index in the transcript. */
      index: number;
      /** Raw Whisper text for this chunk. */
      rawText: string;
      /** Original chunk timestamp. */
      timestamp: [number, number | null];
      /**
       * Lyrics text used to build the prompt.
       * When `isBoundedRetry` is true this is a narrowed excerpt; otherwise
       * it is the full lyrics string.
       */
      lyrics: string;
      /**
       * Number of retries already attempted for this chunk.
       * The worker uses this to escalate prompt breadth.
       * 0 = first retry (prompt is already wider than the initial pass).
       */
      retryCount: number;
      /**
       * When true, `lyrics` is a deliberately narrowed scope derived from the
       * nearest resolved neighbours. The worker uses a different prompt that
       * instructs the model to stay within this bounded excerpt.
       */
      isBoundedRetry?: boolean;
      /**
       * When `isBoundedRetry` is true, the 0-based index of the first line of
       * `lyrics` within the full parsed lyrics array. Applied as an offset to
       * the returned `lyricIdxStart` / `lyricIdxEnd` so that subsequently
       * resolved chunks keep accurate full-lyrics positions.
       */
      lyricsLineOffset?: number;
    }
  | { type: 'cancel' };

export type LyricsAdapterResponse =
  | {
      type: 'model-progress';
      jobId: number;
      /** Overall download progress 0–100, averaged across all model files. */
      progress: number;
      status: string;
    }
  | {
      type: 'chunk-done';
      jobId: number;
      done: number;
      total: number;
      result: AdaptedChunk;
    }
  | {
      /** Emitted after a retry-chunk completes (success or fallback). */
      type: 'retry-chunk-done';
      jobId: number;
      result: AdaptedChunk;
    }
  | { type: 'complete'; jobId: number; results: AdaptedChunk[] }
  | { type: 'error'; jobId: number; message: string }
  | { type: 'cancelled' };

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const CORRECT_THRESHOLD = 0.88;
export const POSSIBLE_THRESHOLD = 0.72;
export const SPAN_MAX = 3;
export const LLM_MODEL_ID = 'Xenova/flan-t5-base';

// ---------------------------------------------------------------------------
// String normalisation & similarity
// ---------------------------------------------------------------------------

export function normalizeLine(s: string): string {
  return s
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[""]/g, '"')
    .replace(/['']/g, "'")
    .replace(/[.,;:!?()\[\]{}"'-]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    new Array<number>(n + 1).fill(0),
  );
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost,
      );
    }
  }
  return dp[m][n];
}

export function similarity(a: string, b: string): number {
  const an = normalizeLine(a);
  const bn = normalizeLine(b);
  const dist = levenshtein(an, bn);
  const maxLen = Math.max(an.length, bn.length) || 1;
  return 1 - dist / maxLen;
}

// ---------------------------------------------------------------------------
// Span picking
// ---------------------------------------------------------------------------

export interface BestSpan {
  lines: string[];
  idxStart: number;
  idxEnd: number;
  score: number;
}

export function pickBestSpan(
  verse: string,
  lyricsLines: string[],
  maxSpan: number = SPAN_MAX,
): BestSpan {
  let best: BestSpan = {
    lines: [],
    idxStart: -1,
    idxEnd: -1,
    score: 0,
  };
  for (let i = 0; i < lyricsLines.length; i++) {
    for (let k = 1; k <= maxSpan && i + k <= lyricsLines.length; k++) {
      const spanLines = lyricsLines.slice(i, i + k);
      const s = similarity(verse, spanLines.join(' '));
      if (s > best.score) {
        best = { lines: spanLines, idxStart: i, idxEnd: i + k - 1, score: s };
      }
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Punctuation & capitalisation helpers
// ---------------------------------------------------------------------------

const LOWERCASE_LEADERS = [
  'E',
  'Mas',
  'Ou',
  'Nem',
  'Que',
  'Pois',
  'Porém',
  'Contudo',
  'Todavia',
  'Entretanto',
  'Logo',
  'Portanto',
];

function shouldKeepCased(word: string): boolean {
  if (!word) return false;
  if (/^\d/.test(word)) return true;
  if (/^[A-ZÀ-Ý]{2,}$/.test(word)) return true;
  return false;
}

function startsWithLowercaseLeader(s: string): boolean {
  const m = /^([^\s]+)/.exec(s.trim());
  if (!m) return false;
  return LOWERCASE_LEADERS.some((w) => w.toLowerCase() === m[1].toLowerCase());
}

function decapitalizeFirstWord(s: string): string {
  const trimmed = s.trim();
  if (!trimmed) return s;
  const parts = trimmed.split(/\s+/);
  const first = parts[0];
  if (shouldKeepCased(first)) return s;
  if (startsWithLowercaseLeader(first)) {
    parts[0] = first.toLowerCase();
    return parts.join(' ');
  }
  if (/^[A-ZÀ-Ý][a-zà-ý]+/.test(first)) {
    parts[0] = first.charAt(0).toLowerCase() + first.slice(1);
    return parts.join(' ');
  }
  return s;
}

function endsWithTerminalPunct(s: string): boolean {
  return /[.!?…;:]$/.test(s.trim());
}

/**
 * Joins multiple lyric lines into a single sentence with proper punctuation
 * and capitalisation adjustments when lines are merged with commas.
 */
export function joinSpanWithPunctuation(lines: string[]): string {
  const trimmed = lines.map((l) => l.trim()).filter(Boolean);
  if (trimmed.length === 0) return '';
  let out = trimmed[0];
  for (let i = 1; i < trimmed.length; i++) {
    const cur = trimmed[i];
    if (endsWithTerminalPunct(out)) {
      out = `${out} ${cur}`;
    } else {
      out = `${out}, ${decapitalizeFirstWord(cur)}`;
    }
  }
  if (!endsWithTerminalPunct(out)) {
    out = `${out}.`;
  }
  return out;
}

/**
 * Parses a multi-line lyrics string into a clean array of non-empty lines.
 * Empty lines, blank separators, and [MARKER] lines are removed.
 */
export function parseLyricsLines(lyrics: string): string[] {
  return lyrics
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !/^\[.*\]$/.test(l));
}

// ---------------------------------------------------------------------------
// Auto-retry boundary helpers (pure, SSR-safe)
// ---------------------------------------------------------------------------

/**
 * Returns true when a chunk is considered resolved for boundary purposes:
 * status is 'matched' or 'corrected'. User edits produce 'corrected'.
 */
export function isResolvedChunk(chunk: AdaptedChunk): boolean {
  return chunk.status === 'matched' || chunk.status === 'corrected';
}

/**
 * Finds the nearest resolved chunk strictly before `chunkIndex`.
 * Returns null when none exists.
 */
export function findPrevResolved(
  results: AdaptedChunk[],
  chunkIndex: number,
): AdaptedChunk | null {
  let nearest: AdaptedChunk | null = null;
  for (const r of results) {
    if (r.index < chunkIndex && isResolvedChunk(r)) {
      if (nearest === null || r.index > nearest.index) {
        nearest = r;
      }
    }
  }
  return nearest;
}

/**
 * Finds the nearest resolved chunk strictly after `chunkIndex`.
 * Returns null when none exists.
 */
export function findNextResolved(
  results: AdaptedChunk[],
  chunkIndex: number,
): AdaptedChunk | null {
  let nearest: AdaptedChunk | null = null;
  for (const r of results) {
    if (r.index > chunkIndex && isResolvedChunk(r)) {
      if (nearest === null || r.index < nearest.index) {
        nearest = r;
      }
    }
  }
  return nearest;
}

/**
 * Builds a reduced lyric scope for retrying an unmatched segment, bounded by
 * the line ranges of the nearest resolved neighbours.
 *
 * Returns `{ lyrics, startLine }` where `lyrics` is the bounded excerpt
 * (newline-separated) and `startLine` is the 0-based index of its first line
 * in `allLyricsLines` — needed to restore absolute lyric positions.
 *
 * Returns null when no usable boundary can be established (both neighbours
 * are null) or when the derived window is empty.
 */
export function buildBoundedLyricScope(
  allLyricsLines: string[],
  prev: AdaptedChunk | null,
  next: AdaptedChunk | null,
): { lyrics: string; startLine: number } | null {
  if (!prev && !next) return null;

  let startLine = 0;
  let endLine = allLyricsLines.length - 1;

  if (prev) {
    if (prev.lyricIdxEnd !== undefined) {
      startLine = prev.lyricIdxEnd + 1;
    } else {
      // Fallback: estimate the boundary by finding the best span for
      // the adapted text in the full lyrics.
      const span = pickBestSpan(prev.adaptedText, allLyricsLines);
      if (span.idxEnd >= 0) startLine = span.idxEnd + 1;
    }
  }

  if (next) {
    if (next.lyricIdxStart !== undefined) {
      endLine = next.lyricIdxStart - 1;
    } else {
      const span = pickBestSpan(next.adaptedText, allLyricsLines);
      if (span.idxStart >= 0) endLine = span.idxStart - 1;
    }
  }

  startLine = Math.max(0, startLine);
  endLine = Math.min(allLyricsLines.length - 1, endLine);

  if (startLine > endLine) {
    // Boundaries are adjacent or crossed — widen to include the boundary
    // lines themselves so the segment still has a minimal plausible window.
    if (prev) {
      const fall = prev.lyricIdxEnd ?? prev.lyricIdxStart;
      if (fall !== undefined && fall >= 0) startLine = fall;
    }
    if (next) {
      const fall = next.lyricIdxStart ?? next.lyricIdxEnd;
      if (fall !== undefined && fall < allLyricsLines.length) endLine = fall;
    }
    startLine = Math.max(0, startLine);
    endLine = Math.min(allLyricsLines.length - 1, endLine);
    if (startLine > endLine) return null;
  }

  const selected = allLyricsLines.slice(startLine, endLine + 1);
  if (selected.length === 0) return null;
  return { lyrics: selected.join('\n'), startLine };
}
