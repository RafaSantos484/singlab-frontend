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
 * @returns Corresponding timestamp in the original vocals audio (seconds).
 */
export function remapTimestamp(
  processedTime: number,
  segments: SpeechSegment[],
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
      // Inside this segment — linear offset from the original start.
      return seg.originalStart + (processedTime - seg.processedStart);
    }
  }

  // Outside all segments — clamp to the nearest boundary.
  if (hi < 0) return segments[0].originalStart;
  if (lo >= segments.length) return segments[segments.length - 1].originalEnd;
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
    const origStart = remapTimestamp(start, segments);
    const origEnd = end !== null ? remapTimestamp(end, segments) : null;
    return {
      text: word.text,
      processedTimestamp: processed,
      timestamp: [origStart, origEnd] as [number, number | null],
    };
  });
}
