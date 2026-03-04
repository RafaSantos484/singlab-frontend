/**
 * @module lib/audio/convertToMp3
 *
 * Client-side audio/video → MP3 conversion using FFmpeg WebAssembly.
 *
 * FFmpeg core is loaded lazily on first use from a CDN (single-threaded,
 * no SharedArrayBuffer / COOP headers required). The singleton instance is
 * reused across calls.
 *
 * When the input file is already an MP3 (`audio/mpeg`) it is returned
 * unchanged to avoid a needless re-encode.
 */

import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';

// ---------------------------------------------------------------------------
// CDN - single-threaded @ffmpeg/core (no COOP/COEP headers required)
// Use UMD build for browser runtime compatibility in Next.js.
// ---------------------------------------------------------------------------

const FFMPEG_CORE_VERSION = '0.12.6';
const FFMPEG_CORE_BASE = `https://unpkg.com/@ffmpeg/core@${FFMPEG_CORE_VERSION}/dist/umd`;

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let ffmpeg: FFmpeg | null = null;
let loadPromise: Promise<void> | null = null;
let conversionQueue: Promise<void> = Promise.resolve();
let fsFileCounter = 0;

export class Mp3ConversionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'Mp3ConversionError';
  }
}

/**
 * Ensures the FFmpeg WASM core is loaded exactly once.
 * Subsequent calls wait on the same promise.
 */
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
    throw new Mp3ConversionError(message);
  }
}

/**
 * Runs conversion tasks one at a time because FFmpeg WASM instance + virtual FS
 * are shared singleton resources and are not safe for concurrent write/exec/read.
 */
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

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Converts any supported audio or video file to MP3 using FFmpeg WASM.
 *
 * If the input file is already an MP3 (`audio/mpeg` type **and** `.mp3`
 * extension) it is returned as-is without re-encoding.
 *
 * @param file - The source audio or video file.
 * @param onProgress - Optional callback receiving progress (0–100).
 * @returns A new `File` with `.mp3` extension and `audio/mpeg` type.
 */
export async function convertToMp3(
  file: File,
  onProgress?: (percent: number) => void,
): Promise<File> {
  // Fast path – already MP3
  if (file.type === 'audio/mpeg' && file.name.toLowerCase().endsWith('.mp3')) {
    return file;
  }

  return runConversionExclusive(async (): Promise<File> => {
    await ensureLoaded();

    const instance = ffmpeg!;

    // Wire up progress events
    const handleProgress = ({ progress }: { progress: number }): void => {
      onProgress?.(Math.round(progress * 100));
    };
    instance.on('progress', handleProgress);

    // Derive safe unique input/output filenames in shared virtual FS
    const ext = file.name.includes('.')
      ? file.name.slice(file.name.lastIndexOf('.'))
      : '';
    const fsToken = createFsToken();
    const inputName = `input-${fsToken}${ext}`;
    const outputName = `output-${fsToken}.mp3`;

    try {
      // Write input to virtual FS
      await instance.writeFile(inputName, await fetchFile(file));

      // Transcode to MP3 (strip video, variable-bitrate ~192kbps)
      await instance.exec([
        '-i',
        inputName,
        '-vn', // drop video stream
        '-acodec',
        'libmp3lame',
        '-q:a',
        '2', // VBR quality 2 ≈ 190 kbps
        outputName,
      ]);

      // Read output
      const data = await instance.readFile(outputName);
      // FileData is `Uint8Array | string`; FFmpeg binary output is always Uint8Array.
      // `Uint8Array.from()` copies the data with a fresh ArrayBuffer, satisfying
      // strict TypeScript's BlobPart constraint.
      const raw =
        typeof data === 'string'
          ? new TextEncoder().encode(data)
          : Uint8Array.from(data);
      const blob = new Blob([raw], { type: 'audio/mpeg' });

      // Build output filename: replace the original extension with .mp3
      const baseName = file.name.includes('.')
        ? file.name.slice(0, file.name.lastIndexOf('.'))
        : file.name;
      const mp3Name = `${baseName}.mp3`;

      return new File([blob], mp3Name, { type: 'audio/mpeg' });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Unknown FFmpeg conversion error';
      throw new Mp3ConversionError(message);
    } finally {
      instance.off('progress', handleProgress);

      // Clean up virtual FS to free memory
      try {
        await instance.deleteFile(inputName);
      } catch {
        // Ignore – file may not exist if exec failed before writeFile settled
      }
      try {
        await instance.deleteFile(outputName);
      } catch {
        // Ignore
      }
    }
  });
}
