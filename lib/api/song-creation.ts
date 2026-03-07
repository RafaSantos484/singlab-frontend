/**
 * @module lib/api/song-creation
 *
 * Service layer for song creation operations.
 *
 * Upload flow:
 * 1. Validate the audio file (size and type via MIME + extension fallback).
 * 2. Extract metadata (title, artist) from audio tags (optional).
 * 3. Normalize audio/video to canonical AAC/M4A using FFmpeg WASM.
 * 4. Generate a stable `songId` (Firestore doc ID).
 * 5. Upload the normalized file to Storage at `users/:userId/songs/:songId/raw.m4a`.
 * 6. Create the song document directly in Firestore with metadata and storage path.
 *
 * If the Firestore write fails after Storage upload, the file is
 * automatically rolled back (deleted from Storage).
 */

import { getFirebaseAuth } from '@/lib/firebase/auth';
import { withPendingActivity } from '@/lib/async/pendingActivity';
import { uploadRawSong, deleteRawSong } from '@/lib/storage/uploadRawSong';
import { generateSongId, createSongDoc } from '@/lib/firebase/songs';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_FILE_SIZE_MB = 100;
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;

// Supported audio/video formats from FFmpeg
// All these formats are normalized before uploading.
const SUPPORTED_AUDIO_FORMATS = [
  'audio/mpeg', // .mp3
  'audio/mp3', // .mp3 (alternative MIME)
  'audio/x-mpeg', // .mp3 (older MIME)
  'audio/wav', // .wav
  'audio/x-wav', // .wav (alternative)
  'audio/ogg', // .ogg
  'audio/webm', // .webm (audio)
  'video/webm', // .webm (video)
  'video/mp4', // .mp4 (video with audio)
  'audio/mp4', // .mp4 (audio-only)
  'video/quicktime', // .mov
  'audio/flac', // .flac
  'audio/x-flac', // .flac (alternative)
  'audio/aac', // .aac
  'audio/x-aac', // .aac (alternative)
  'audio/m4a', // .m4a
  'audio/x-m4a', // .m4a (alternative)
];

// Supported extensions as fallback when MIME type is absent or generic
const SUPPORTED_EXTENSIONS = [
  '.mp3',
  '.wav',
  '.ogg',
  '.webm',
  '.mp4',
  '.mov',
  '.flac',
  '.aac',
  '.m4a',
  '.mpeg',
  '.mpga',
];

// ---------------------------------------------------------------------------
// Upload phase type
// ---------------------------------------------------------------------------

/**
 * Describes the current phase of the song creation process:
 * - `'converting'`  – audio/video file is being normalized.
 * - `'uploading'`   – normalized file is being uploaded to Firebase Storage.
 * - `'saving'`      – file upload is complete; song document is being
 *                     written to Firestore.
 */
export type SongCreationPhase = 'converting' | 'uploading' | 'saving';

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/**
 * Thrown when the Firebase Storage upload step fails.
 */
export class StorageUploadError extends Error {
  constructor(cause?: string) {
    super(cause ?? 'Failed to upload file to storage');
    this.name = 'StorageUploadError';
  }
}

export class InvalidFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidFileError';
  }
}

export class FileSizeExceededError extends InvalidFileError {
  constructor(fileName: string, sizeMB: number) {
    // Message is an i18n key relative to the Validation namespace
    super('file.sizeTooLarge');
    this.name = 'FileSizeExceededError';
    // Expose raw values for callers that need them (e.g. logging)
    this.fileName = fileName;
    this.sizeMB = sizeMB;
  }

  readonly fileName: string;
  readonly sizeMB: number;
}

export class InvalidFileTypeError extends InvalidFileError {
  constructor(fileName: string) {
    // Message is an i18n key relative to the Validation namespace
    super('file.invalidType');
    this.name = 'InvalidFileTypeError';
    this.fileName = fileName;
  }

  readonly fileName: string;
}

// ---------------------------------------------------------------------------
// File validation
// ---------------------------------------------------------------------------

/**
 * Validates a file for upload.
 *
 * @param file - The file to validate.
 * @throws {FileSizeExceededError} If file size exceeds limit.
 * @throws {InvalidFileTypeError} If file type is not supported.
 */
export function validateSongFile(file: File): void {
  // Check file size
  if (file.size > MAX_FILE_SIZE_BYTES) {
    throw new FileSizeExceededError(file.name, file.size / 1024 / 1024);
  }

  // Check file type – first by MIME, then by extension as fallback
  const mimeOk = SUPPORTED_AUDIO_FORMATS.includes(file.type);
  const ext = file.name.includes('.')
    ? file.name.slice(file.name.lastIndexOf('.')).toLowerCase()
    : '';
  const extOk = SUPPORTED_EXTENSIONS.includes(ext);

  if (!mimeOk && !extOk) {
    throw new InvalidFileTypeError(file.name);
  }
}

// ---------------------------------------------------------------------------
// Song creation service
// ---------------------------------------------------------------------------

export interface CreateSongOptions {
  title: string;
  author: string;
  file: File;
  /** Optional callback invoked when the creation phase changes. */
  onPhaseChange?: (phase: SongCreationPhase) => void;
}

export interface CreateSongResult {
  songId: string;
  title: string;
  author: string;
}

/**
 * Creates a new song using a two-step process:
 * 1. Uploads the normalized audio file to Storage (caller must normalize beforehand).
 * 2. Creates the song document directly in Firestore with metadata.
 *
 * The `onPhaseChange` callback receives `'uploading'` before the Storage
 * upload and `'saving'` before the Firestore write, allowing the UI to
 * display granular progress.
 *
 * If the Firestore write fails after the file has been uploaded to Storage,
 * the file is automatically rolled back (deleted). This ensures the storage
 * is not left with orphaned files.
 *
 * **Note:** The caller (e.g., `SongCreateDialog`) is responsible for:
 * - File format validation (MIME type + extension fallback)
 * - Audio metadata extraction (title, artist from tags)
 * - Canonical normalization using FFmpeg (via `normalizeAudioFile`)
 *
 * @param options - Normalized file, metadata (title, author) and optional phase callback.
 * @returns The created song result.
 * @throws {InvalidFileError} If client-side file validation fails.
 * @throws {StorageUploadError} If the Firebase Storage upload step fails.
 * @throws {Error} If the Firestore write fails (file is rolled back).
 */
export async function createSong(
  options: CreateSongOptions,
): Promise<CreateSongResult> {
  return withPendingActivity(async (): Promise<CreateSongResult> => {
    const { title, author, file, onPhaseChange } = options;

    // 1. Validate file before doing anything async.
    validateSongFile(file);

    // 2. Resolve the current user — required to build the storage path.
    const currentUser = getFirebaseAuth().currentUser;
    if (!currentUser) {
      throw new Error('No authenticated user');
    }
    const userId = currentUser.uid;

    // 3. Generate a stable songId that matches the storage path.
    const songId = generateSongId(userId);

    // 4. Upload the raw audio file to Storage.
    onPhaseChange?.('uploading');
    try {
      await uploadRawSong(userId, songId, file);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Unknown storage error';
      throw new StorageUploadError(message);
    }

    // 5. Create the song document directly in Firestore.
    onPhaseChange?.('saving');
    try {
      await createSongDoc(userId, songId, title, author);

      return { songId, title, author };
    } catch (err) {
      // Firestore write failed — rollback the Storage upload to avoid orphaned files.
      try {
        await deleteRawSong(userId, songId);
      } catch (rollbackErr) {
        const rollbackMsg =
          rollbackErr instanceof Error ? rollbackErr.message : 'Unknown error';
        console.error(
          `Failed to rollback storage upload for song ${songId}: ${rollbackMsg}`,
        );
      }

      // Re-throw the original error.
      throw err;
    }
  });
}

/**
 * Validates and formats metadata fields for song creation.
 *
 * @param title - Song title (will be trimmed).
 * @param author - Song author (will be trimmed).
 * @returns Validation errors (i18n keys in `Validation` namespace), or null if valid.
 */
export function validateSongMetadata(
  title: string,
  author: string,
): { title?: string; author?: string } | null {
  const errors: { title?: string; author?: string } = {};

  const trimmedTitle = title.trim();
  const trimmedAuthor = author.trim();

  if (!trimmedTitle) {
    errors.title = 'songTitle.required';
  } else if (trimmedTitle.length > 255) {
    errors.title = 'songTitle.tooLong';
  }

  if (!trimmedAuthor) {
    errors.author = 'songAuthor.required';
  } else if (trimmedAuthor.length > 255) {
    errors.author = 'songAuthor.tooLong';
  }

  return Object.keys(errors).length > 0 ? errors : null;
}
