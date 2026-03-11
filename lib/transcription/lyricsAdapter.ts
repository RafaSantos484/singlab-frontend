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
      /** Full lyrics text (needed to build the prompt). */
      lyrics: string;
      /**
       * Number of retries already attempted for this chunk.
       * The worker uses this to escalate prompt breadth.
       * 0 = first retry (prompt is already wider than the initial pass).
       */
      retryCount: number;
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
