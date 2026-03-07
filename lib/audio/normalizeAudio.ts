/**
 * @module lib/audio/normalizeAudio
 *
 * Canonical audio normalization using FFmpeg WebAssembly.
 *
 * Every upload path (raw and stems, independent of provider) should pass
 * through this exact pipeline so all tracks share the same encoding profile.
 */

import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';
import { withPendingActivity } from '@/lib/async/pendingActivity';

const FFMPEG_CORE_VERSION = '0.12.6';
const FFMPEG_CORE_BASE = `https://unpkg.com/@ffmpeg/core@${FFMPEG_CORE_VERSION}/dist/umd`;

export const CANONICAL_AUDIO_EXTENSION = '.m4a';
export const CANONICAL_AUDIO_MIME_TYPE = 'audio/mp4';

let ffmpeg: FFmpeg | null = null;
let loadPromise: Promise<void> | null = null;
let conversionQueue: Promise<void> = Promise.resolve();
let fsFileCounter = 0;

export class AudioNormalizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AudioNormalizationError';
  }
}

async function ensureLoaded(): Promise<void> {
  if (ffmpeg?.loaded) return;

  if (!ffmpeg) {
    ffmpeg = new FFmpeg();
  }

  if (!loadPromise) {
    loadPromise = (async (): Promise<void> => {
      const [coreURL, wasmURL] = await Promise.all([
        toBlobURL(`${FFMPEG_CORE_BASE}/ffmpeg-core.js`, 'text/javascript'),
        toBlobURL(`${FFMPEG_CORE_BASE}/ffmpeg-core.wasm`, 'application/wasm'),
      ]);

      await ffmpeg!.load({ coreURL, wasmURL });
    })();
  }

  try {
    await loadPromise;
  } catch (error) {
    loadPromise = null;
    ffmpeg = null;

    const message =
      error instanceof Error
        ? error.message
        : `Unknown FFmpeg load error: ${String(error)}`;
    throw new AudioNormalizationError(message);
  }
}

async function runConversionExclusive<T>(task: () => Promise<T>): Promise<T> {
  const runTask = conversionQueue.then(task, task);
  conversionQueue = runTask.then(
    (): void => undefined,
    (): void => undefined,
  );
  return runTask;
}

function createFsToken(): string {
  fsFileCounter += 1;
  return `${Date.now()}-${fsFileCounter}`;
}

function getExtensionFromName(fileName: string): string {
  if (!fileName.includes('.')) {
    return '';
  }
  return fileName.slice(fileName.lastIndexOf('.'));
}

/**
 * Normalizes any input media (audio/video) into canonical AAC-LC in M4A.
 *
 * Pipeline parameters are fixed to guarantee homogeneous outputs:
 * - Codec: AAC
 * - Sample rate: 48 kHz
 * - Channels: 2 (stereo)
 * - Bitrate: 192 kbps
 *
 * There is no fast-path bypass: ALL files are normalized, even if already .m4a.
 * This ensures consistent sample rate, channel count, and codec profile across
 * all uploads (raw songs and stems from any provider path).
 */
export async function normalizeAudioFile(
  file: Blob,
  options?: {
    fileName?: string;
    onProgress?: (percent: number) => void;
  },
): Promise<File> {
  const sourceName = options?.fileName?.trim() || 'audio-input';

  return withPendingActivity(async (): Promise<File> => {
    return runConversionExclusive(async (): Promise<File> => {
      await ensureLoaded();

      const instance = ffmpeg!;
      const handleProgress = ({ progress }: { progress: number }): void => {
        options?.onProgress?.(Math.round(progress * 100));
      };

      instance.on('progress', handleProgress);

      const ext = getExtensionFromName(sourceName);
      const fsToken = createFsToken();
      const inputName = `input-${fsToken}${ext}`;
      const outputName = `output-${fsToken}${CANONICAL_AUDIO_EXTENSION}`;

      try {
        await instance.writeFile(inputName, await fetchFile(file));

        await instance.exec([
          '-i',
          inputName,
          '-vn',
          '-ar',
          '48000',
          '-ac',
          '2',
          '-c:a',
          'aac',
          '-b:a',
          '192k',
          '-movflags',
          '+faststart',
          outputName,
        ]);

        const data = await instance.readFile(outputName);
        const raw =
          typeof data === 'string'
            ? new TextEncoder().encode(data)
            : Uint8Array.from(data);

        const blob = new Blob([raw], { type: CANONICAL_AUDIO_MIME_TYPE });
        const baseName = sourceName.includes('.')
          ? sourceName.slice(0, sourceName.lastIndexOf('.'))
          : sourceName;

        return new File([blob], `${baseName}${CANONICAL_AUDIO_EXTENSION}`, {
          type: CANONICAL_AUDIO_MIME_TYPE,
        });
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : 'Unknown FFmpeg conversion error';
        throw new AudioNormalizationError(message);
      } finally {
        instance.off('progress', handleProgress);

        try {
          await instance.deleteFile(inputName);
        } catch {
          // Ignore best-effort cleanup errors in shared virtual FS.
        }

        try {
          await instance.deleteFile(outputName);
        } catch {
          // Ignore best-effort cleanup errors in shared virtual FS.
        }
      }
    });
  });
}
