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
 * @param words - Whisper word chunks containing processed-audio timestamps.
 * @param segments - Speech segment cut map from {@link removeSilencesFromVocals}.
 * @returns New array with identical words but original-audio timestamps.
 */
export function remapWordTimestamps(
  words: Array<{ text: string; timestamp: [number, number | null] }>,
  segments: SpeechSegment[],
): Array<{ text: string; timestamp: [number, number | null] }> {
  if (segments.length === 0) return words;

  return words.map((word) => {
    const [start, end] = word.timestamp;
    return {
      ...word,
      timestamp: [
        remapTimestamp(start, segments),
        end !== null ? remapTimestamp(end, segments) : null,
      ] as [number, number | null],
    };
  });
}
