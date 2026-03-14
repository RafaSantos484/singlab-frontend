/**
 * Pure deterministic utilities for adapting transcript chunks to lyrics.
 *
 * No side effects, no worker messaging, and no model inference.
 */
import type { TranscriptChunk } from './types';

export type AdaptationStatus = 'matched' | 'corrected' | 'unmatched';

export interface AdaptedChunk {
  index: number;
  rawText: string;
  adaptedText: string;
  timestamp: [number, number | null];
  status: AdaptationStatus;
  score: number;
  lyricIdxStart?: number;
  lyricIdxEnd?: number;
}

export const CORRECT_THRESHOLD = 0.88;
export const POSSIBLE_THRESHOLD = 0.72;
export const SPAN_MAX = 3;

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

interface CorrelationResult {
  adaptedText: string;
  status: AdaptationStatus;
  score: number;
  lyricIdxStart?: number;
  lyricIdxEnd?: number;
}

/**
 * Correlates one transcript verse with the most similar lyric span.
 *
 * `startLineHint` keeps matching mostly forward through the song while still
 * allowing a short lookback window to handle repeated sections.
 */
export function correlateVerseToLyrics(
  verse: string,
  lyricsLines: string[],
  startLineHint = 0,
): CorrelationResult {
  const windowStart = Math.max(0, Math.min(startLineHint, lyricsLines.length));
  const lookbackStart = Math.max(0, windowStart - 2);
  const scopedLines = lyricsLines.slice(lookbackStart);
  const best = pickBestSpan(verse, scopedLines, SPAN_MAX);

  if (best.idxStart < 0 || best.lines.length === 0) {
    return {
      adaptedText: verse.trim(),
      status: 'unmatched',
      score: 0,
    };
  }

  const lyricIdxStart = lookbackStart + best.idxStart;
  const lyricIdxEnd = lookbackStart + best.idxEnd;
  const adaptedText = joinSpanWithPunctuation(best.lines);

  if (best.score >= CORRECT_THRESHOLD) {
    return {
      adaptedText,
      status: 'matched',
      score: best.score,
      lyricIdxStart,
      lyricIdxEnd,
    };
  }

  if (best.score >= POSSIBLE_THRESHOLD) {
    return {
      adaptedText,
      status: 'corrected',
      score: best.score,
      lyricIdxStart,
      lyricIdxEnd,
    };
  }

  return {
    adaptedText: verse.trim(),
    status: 'unmatched',
    score: best.score,
  };
}

/**
 * Runs deterministic correlation for every transcript chunk.
 */
export function adaptTranscriptChunks(
  chunks: TranscriptChunk[],
  lyrics: string,
): AdaptedChunk[] {
  const lyricsLines = parseLyricsLines(lyrics);
  let startLineHint = 0;

  return chunks.map((chunk, index) => {
    const verse = chunk.text.trim();
    if (!verse) {
      return {
        index,
        rawText: '',
        adaptedText: '',
        timestamp: chunk.timestamp,
        status: 'unmatched',
        score: 0,
      } satisfies AdaptedChunk;
    }

    const correlation = correlateVerseToLyrics(verse, lyricsLines, startLineHint);

    if (correlation.lyricIdxEnd !== undefined) {
      startLineHint = Math.max(startLineHint, correlation.lyricIdxEnd);
    }

    return {
      index,
      rawText: verse,
      adaptedText: correlation.adaptedText,
      timestamp: chunk.timestamp,
      status: correlation.status,
      score: correlation.score,
      lyricIdxStart: correlation.lyricIdxStart,
      lyricIdxEnd: correlation.lyricIdxEnd,
    } satisfies AdaptedChunk;
  });
}
