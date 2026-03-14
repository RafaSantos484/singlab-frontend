import {
  filterNoisyTranscriptChunks,
  isNoisyTranscriptSegment,
} from '@/lib/transcription/transcriptNoiseFilter';
import type { TranscriptChunk } from '@/lib/transcription/types';

describe('transcriptNoiseFilter', () => {
  it('filters musical symbols and bracketed placeholders', () => {
    expect(isNoisyTranscriptSegment('♫ ♪ ♫')).toBe(true);
    expect(isNoisyTranscriptSegment('[music]')).toBe(true);
    expect(isNoisyTranscriptSegment('[música]')).toBe(true);
  });

  it('filters long repetitive humming-like content', () => {
    expect(isNoisyTranscriptSegment('la la la la la la la la')).toBe(true);
    expect(isNoisyTranscriptSegment('mmm mmm mmm mmm mmm mmm')).toBe(true);
    expect(isNoisyTranscriptSegment('na na na na na na na na na')).toBe(true);
    expect(
      isNoisyTranscriptSegment(
        'Futum, futum, futum, futum, futum, futum, futum, futum, futum, futum, futum, futum',
      ),
    ).toBe(true);
    expect(
      isNoisyTranscriptSegment(
        'O lado de la, o lado de la, o lado de la, o lado de la, o lado de la, o lado de la, o lado de la, o lado de la, o lado de la, o lado de la',
      ),
    ).toBe(true);
  });

  it('keeps short or semantic lyrical segments', () => {
    expect(isNoisyTranscriptSegment('Na na na')).toBe(false);
    expect(isNoisyTranscriptSegment('I need your love tonight')).toBe(false);
    expect(isNoisyTranscriptSegment('Quero cantar com você')).toBe(false);
    expect(isNoisyTranscriptSegment('O lado de lá, o lado de lá')).toBe(false);
  });

  it('preserves timestamp data for remaining chunks after filtering', () => {
    const chunks: TranscriptChunk[] = [
      {
        text: '[music]',
        processedTimestamp: [0, 1],
        timestamp: [2, 3],
      },
      {
        text: 'I need your love tonight',
        processedTimestamp: [1, 2],
        timestamp: [3, 4],
      },
    ];

    const filtered = filterNoisyTranscriptChunks(chunks);
    expect(filtered).toHaveLength(1);
    expect(filtered[0]).toEqual({
      text: 'I need your love tonight',
      processedTimestamp: [1, 2],
      timestamp: [3, 4],
    });
  });
});
