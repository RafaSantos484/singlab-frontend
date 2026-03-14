import type { TranscriptChunk } from './types';

const MUSICAL_SYMBOL_REGEX = /[♪♫♩♬♭♯♮𝄞]/u;
const BRACKETED_TEXT_REGEX = /^[\[\(\{<]\s*([^\]\)\}>]+)\s*[\]\)\}>]$/u;
const NON_LETTER_OR_DIGIT_REGEX = /^[^\p{L}\p{N}]+$/u;
const REPEATED_SHORT_TOKEN_REGEX =
  /\b([\p{L}]{1,4})\b(?:[\s,.;:!?-]+\1\b){4,}/iu;
const REPEATED_TOKEN_REGEX = /\b([\p{L}]{2,20})\b(?:[\s,.;:!?-]+\1\b){9,}/iu;
const DIACRITICS_REGEX = /\p{M}+/gu;

const PLACEHOLDER_MARKERS = [
  'music',
  'musica',
  'musical',
  'instrumental',
  'humming',
  'hum',
  'vocalizing',
  'vocalise',
  'vocalize',
  'vocalization',
  'vocalizacao',
  'melody',
] as const;

/**
 * Returns true when a token is likely a humming/onomatopoeic syllable.
 * We keep this strict and short-token focused to avoid false positives.
 */
function isHummingToken(token: string): boolean {
  const lowered = token.toLowerCase();
  if (lowered.length > 4) {
    return false;
  }

  if (
    /^(?:ah|eh|ih|oh|uh|mm+|hm+|hum+|la+|na+|da+|ta+|pa+|ra+)$/u.test(lowered)
  ) {
    return true;
  }

  return /^[ahumnlrtdp]{1,4}$/u.test(lowered);
}

function normalizeForComparison(text: string): string {
  return text
    .normalize('NFKD')
    .replace(DIACRITICS_REGEX, '')
    .toLowerCase()
    .trim();
}

function isBracketedPlaceholder(text: string): boolean {
  const match = text.match(BRACKETED_TEXT_REGEX);
  if (!match) {
    return false;
  }

  const inner = normalizeForComparison(match[1]);
  const compact = inner.replace(/[^a-z0-9]+/g, ' ').trim();
  if (!compact) {
    return true;
  }

  return PLACEHOLDER_MARKERS.some((marker) => {
    const markerPattern = new RegExp(`(^|\\s)${marker}(\\s|$)`, 'u');
    return markerPattern.test(compact);
  });
}

function isOverwhelminglyRepetitive(text: string): boolean {
  const normalized = normalizeForComparison(text);
  const tokens = normalized.match(/\p{L}+/gu) ?? [];
  if (tokens.length < 6) {
    return false;
  }

  if (REPEATED_TOKEN_REGEX.test(normalized)) {
    return true;
  }

  if (REPEATED_SHORT_TOKEN_REGEX.test(normalized)) {
    return true;
  }

  const phraseCandidates = normalized
    .split(/[\n,;:.!?]+/u)
    .map((part) => part.trim().replace(/\s+/g, ' '))
    .filter((part) => part.length > 0);

  if (phraseCandidates.length >= 8) {
    const phraseCounts = new Map<string, number>();
    for (const phrase of phraseCandidates) {
      phraseCounts.set(phrase, (phraseCounts.get(phrase) ?? 0) + 1);
    }

    let dominantPhrase = '';
    let dominantPhraseCount = 0;
    for (const [phrase, count] of phraseCounts) {
      if (count > dominantPhraseCount) {
        dominantPhrase = phrase;
        dominantPhraseCount = count;
      }
    }

    const dominantPhraseRatio = dominantPhraseCount / phraseCandidates.length;
    const dominantPhraseTokenCount =
      dominantPhrase.match(/\p{L}+/gu)?.length ?? 0;

    if (
      dominantPhraseCount >= 6 &&
      dominantPhraseRatio >= 0.75 &&
      dominantPhraseTokenCount >= 1 &&
      dominantPhraseTokenCount <= 6
    ) {
      return true;
    }
  }

  const frequencies = new Map<string, number>();
  for (const token of tokens) {
    frequencies.set(token, (frequencies.get(token) ?? 0) + 1);
  }

  let dominantToken = '';
  let dominantCount = 0;
  for (const [token, count] of frequencies) {
    if (count > dominantCount) {
      dominantCount = count;
      dominantToken = token;
    }
  }

  const uniqueRatio = frequencies.size / tokens.length;
  const hummingTokenCount = tokens.filter((token) =>
    isHummingToken(token),
  ).length;
  const hummingRatio = hummingTokenCount / tokens.length;
  const semanticTokenCount = tokens.filter(
    (token) => token.length >= 3 && !isHummingToken(token),
  ).length;

  if (semanticTokenCount >= 2 && tokens.length < 20) {
    return false;
  }

  const dominantRatio = dominantCount / tokens.length;
  const dominantLooksLikeHumming = isHummingToken(dominantToken);

  return (
    hummingRatio >= 0.75 &&
    uniqueRatio <= 0.45 &&
    dominantLooksLikeHumming &&
    dominantRatio >= 0.5
  );
}

/**
 * Detects clearly non-lyrical Whisper segments that should not be shown or
 * forwarded to lyrics adaptation.
 */
export function isNoisyTranscriptSegment(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) {
    console.debug(
      '[TranscriptionNoiseFilter] Filtering out empty or whitespace-only transcript segment',
    );
    return true;
  }

  if (MUSICAL_SYMBOL_REGEX.test(trimmed)) {
    console.debug(
      '[TranscriptionNoiseFilter] Filtering out segment with musical symbols:',
      trimmed,
    );
    return true;
  }

  if (isBracketedPlaceholder(trimmed)) {
    console.debug(
      '[TranscriptionNoiseFilter] Filtering out bracketed placeholder:',
      trimmed,
    );
    return true;
  }

  if (NON_LETTER_OR_DIGIT_REGEX.test(trimmed)) {
    console.debug(
      '[TranscriptionNoiseFilter] Filtering out segment with no letters or digits:',
      trimmed,
    );
    return true;
  }

  if (isOverwhelminglyRepetitive(trimmed)) {
    console.debug(
      '[TranscriptionNoiseFilter] Filtering out overwhelmingly repetitive segment:',
      trimmed,
    );
    return true;
  }

  return false;
}

export function filterNoisyTranscriptChunks(
  chunks: TranscriptChunk[],
): TranscriptChunk[] {
  return chunks.filter((chunk) => !isNoisyTranscriptSegment(chunk.text));
}
