import type { SpeechSegment } from './ffmpegVocals';

/**
 * Maps a single timestamp from the processed (silence-removed) audio timeline
 * back to the corresponding position in the original audio timeline.
 *
 * Uses binary search for O(log n) lookup across the speech segment list.
 * Timestamps that fall outside all known segments are clamped to the nearest
 * segment boundary.
 *
 * @param processedTime - Timestamp in the processed audio (seconds).
 * @param segments - Ordered speech segments from {@link removeSilencesFromVocals}.
 * @param preferNextOnBoundary - Optional boolean. When true, timestamps that
 *  fall exactly on a processed boundary shared by adjacent segments are
 *  mapped to the next segment's original start; when false they map to the
 *  previous segment's original end. Defaults to `false` (preserves previous
 *  behaviour).
 * @returns Corresponding timestamp in the original vocals audio (seconds).
 */
export function remapTimestamp(
  processedTime: number,
  segments: SpeechSegment[],
  /**
   * When a processed timestamp falls exactly on a boundary shared by two
   * adjacent segments (previous.processedEnd === next.processedStart) the
   * mapping is ambiguous. If `preferNextOnBoundary` is true we map boundary
   * values to the *next* segment's original start (useful for mapping
   * processed *starts*). If false we map to the *previous* segment's
   * original end (useful for mapping processed *ends*). Default preserves
   * previous behaviour (prefer previous on boundary).
   */
  preferNextOnBoundary = false,
): number {
  if (segments.length === 0) return processedTime;

  let lo = 0;
  let hi = segments.length - 1;

  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const seg = segments[mid];

    if (processedTime < seg.processedStart) {
      hi = mid - 1;
    } else if (processedTime > seg.processedEnd) {
      lo = mid + 1;
    } else {
      // Inside this segment — handle exact-boundary ambiguity deterministically
      // so that callers can decide whether a boundary should map to the
      // previous segment's end or the next segment's start.
      const isAtStart = processedTime === seg.processedStart;
      const isAtEnd = processedTime === seg.processedEnd;

      if (isAtEnd && mid < segments.length - 1) {
        const next = segments[mid + 1];
        if (next.processedStart === seg.processedEnd && preferNextOnBoundary) {
          return next.originalStart;
        }
      }
      if (isAtStart && mid > 0) {
        const prev = segments[mid - 1];
        if (prev.processedEnd === seg.processedStart && !preferNextOnBoundary) {
          return prev.originalEnd;
        }
      }

      // Default: map proportionally within this segment. Processed and
      // original segments may have different durations (for example when
      // silences are normalized to a fixed Tb). We scale the processed
      // offset into the original span so remapped timestamps remain
      // consistent with the original audio timeline.
      const processedSpan = seg.processedEnd - seg.processedStart;
      const originalSpan = seg.originalEnd - seg.originalStart;
      if (processedSpan <= 0) return seg.originalStart;
      const ratio = originalSpan / processedSpan;
      return seg.originalStart + (processedTime - seg.processedStart) * ratio;
    }
  }

  // Outside all segments — clamp to the nearest boundary.
  if (hi < 0) return segments[0].originalStart;
  if (lo >= segments.length) return segments[segments.length - 1].originalEnd;

  // If processedTime is between two segments we clamp to the nearest
  // boundary. By default we return the previous segment's end which
  // preserves a non-overlapping timeline; callers that need the opposite
  // behaviour should call `remapTimestamp` with
  // `preferNextOnBoundary=true` for the boundary case.
  return segments[hi].originalEnd;
}

/**
 * Remaps word-level timestamps from the processed (silence-removed) audio
 * timeline back to the original vocals audio timeline.
 *
 * The function accepts word objects that may optionally include a
 * `processedTimestamp` field (the original timestamps emitted by the
 * transcription worker). When present the returned objects will preserve
 * `processedTimestamp` and set `timestamp` to the remapped original-audio
 * coordinates. When `processedTimestamp` is absent we treat the incoming
 * `timestamp` as the processed timeline and return an object that includes
 * `processedTimestamp` (copied from the input) as well as the remapped
 * `timestamp`.
 *
 * @param words - Array of word chunks. Each item must contain `text` and
 *  `timestamp` (processed-audio range). It may also include
 *  `processedTimestamp` in cases where upstream code already attached it.
 * @param segments - Speech segment cut map from {@link removeSilencesFromVocals}.
 * @returns New array with words carrying both `processedTimestamp` and
 *  a remapped `timestamp` aligned to the original vocals audio timeline.
 */
export function remapWordTimestamps(
  words: Array<{
    text: string;
    timestamp: [number, number | null];
    processedTimestamp?: [number, number | null];
  }>,
  segments: SpeechSegment[],
): Array<{
  text: string;
  timestamp: [number, number | null];
  processedTimestamp: [number, number | null];
}> {
  if (segments.length === 0) {
    // If there's no cut map, normalize shape: ensure processedTimestamp exists
    return words.map((word) => ({
      text: word.text,
      processedTimestamp: 'processedTimestamp' in word ? word.processedTimestamp! : word.timestamp,
      timestamp: 'processedTimestamp' in word ? word.timestamp : word.timestamp,
    }));
  }

  return words.map((word) => {
    const processed = 'processedTimestamp' in word ? word.processedTimestamp! : word.timestamp;
    const [start, end] = processed;
    // Map start timestamps to the next segment boundary when they fall on a
    // shared processed boundary — this ensures chunk starts do not collapse
    // into the previous segment and swallow the intervening silence.
    const origStart = remapTimestamp(start, segments, true);
    // Map end timestamps to the previous segment boundary when they fall on
    // a shared processed boundary so chunk ends align to the true end of
    // the spoken interval.
    const origEnd = end !== null ? remapTimestamp(end, segments, false) : null;
    return {
      text: word.text,
      processedTimestamp: processed,
      timestamp: [origStart, origEnd] as [number, number | null],
    };
  });
}
