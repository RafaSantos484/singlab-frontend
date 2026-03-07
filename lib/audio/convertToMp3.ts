/**
 * @deprecated Use `normalizeAudioFile` from `lib/audio/normalizeAudio`.
 */

import {
  AudioNormalizationError,
  normalizeAudioFile,
} from '@/lib/audio/normalizeAudio';

/**
 * @deprecated Backward-compatible alias for legacy call sites.
 */
export class Mp3ConversionError extends AudioNormalizationError {
  constructor(message: string) {
    super(message);
    this.name = 'Mp3ConversionError';
  }
}

/**
 * @deprecated Backward-compatible alias that now returns canonical `.m4a`.
 */
export async function convertToMp3(
  file: File,
  onProgress?: (percent: number) => void,
): Promise<File> {
  try {
    return await normalizeAudioFile(file, {
      fileName: file.name,
      onProgress,
    });
  } catch (error) {
    if (error instanceof AudioNormalizationError) {
      throw new Mp3ConversionError(error.message);
    }

    const message =
      error instanceof Error ? error.message : 'Unknown audio conversion error';
    throw new Mp3ConversionError(message);
  }
}
