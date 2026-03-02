/**
 * @module lib/api/song-creation
 *
 * Service layer for song creation operations.
 *
 * Upload flow:
 * 1. Validate the audio file (size and type).
 * 2. Generate a stable `songId`.
 * 3. Upload the raw file to Firebase Storage at
 *    `users/:userId/songs/:songId/raw.mp3`.
 * 4. Register the song with the API by sending JSON metadata.
 *
 * The backend validates that the storage file exists before persisting the
 * Firestore document.
 */

import { collection, doc } from 'firebase/firestore';

import { getFirebaseAuth } from '@/lib/firebase/auth';
import { getFirebaseFirestore } from '@/lib/firebase/firestore';
import { uploadRawSong, deleteRawSong } from '@/lib/storage/uploadRawSong';
import { songsApi } from './index';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_FILE_SIZE_MB = 100;
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;

// Supported audio/video formats from FFmpeg
const SUPPORTED_AUDIO_FORMATS = [
  'audio/mpeg', // .mp3
  'audio/wav', // .wav
  'audio/ogg', // .ogg
  'audio/webm', // .webm
  'video/mp4', // .mp4 (video with audio)
  'video/quicktime', // .mov
  'audio/flac', // .flac
];

// ---------------------------------------------------------------------------
// Upload phase type
// ---------------------------------------------------------------------------

/**
 * Describes the current phase of the two-step song creation process:
 * - `'uploading'`   – raw audio file is being uploaded to Firebase Storage.
 * - `'registering'` – file upload is complete; song metadata is being
 *                     registered via the API.
 */
export type SongCreationPhase = 'uploading' | 'registering';

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

  // Check file type
  if (!SUPPORTED_AUDIO_FORMATS.includes(file.type)) {
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
 * Generates a Firestore-compatible document ID for a new song.
 * Uses the Firestore client SDK to produce the same format as server-generated IDs.
 *
 * @param userId - Firebase Auth UID of the song owner.
 * @returns A new unique song document ID.
 */
function generateSongId(userId: string): string {
  const firestore = getFirebaseFirestore();
  return doc(collection(firestore, 'users', userId, 'songs')).id;
}

/**
 * Creates a new song using a two-step process:
 * 1. Uploads the raw audio file to Firebase Storage.
 * 2. Registers the song document with the API (JSON metadata only).
 *
 * The `onPhaseChange` callback receives `'uploading'` before the Storage
 * upload and `'registering'` before the API call, allowing the UI to
 * display granular progress.
 *
 * If the API registration fails after the file has been uploaded to Storage,
 * the file is automatically rolled back (deleted). This ensures the storage
 * is not left with orphaned files.
 *
 * @param options - File, metadata (title, author) and optional phase callback.
 * @returns The created song result.
 * @throws {InvalidFileError} If client-side file validation fails.
 * @throws {StorageUploadError} If the Firebase Storage upload step fails.
 * @throws {ApiError} If the API registration call fails (file is rolled back).
 */
export async function createSong(
  options: CreateSongOptions,
): Promise<CreateSongResult> {
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
    const message = err instanceof Error ? err.message : 'Unknown storage error';
    throw new StorageUploadError(message);
  }

  // 5. Register the song document via the API.
  onPhaseChange?.('registering');
  try {
    const result = await songsApi.uploadSong({ songId, title, author });

    return {
      songId: result.songId,
      title: result.title,
      author: result.author,
    };
  } catch (err) {
    // API registration failed — rollback the Storage upload to avoid orphaned files.
    try {
      await deleteRawSong(userId, songId);
    } catch (rollbackErr) {
      const rollbackMsg =
        rollbackErr instanceof Error ? rollbackErr.message : 'Unknown error';
      console.error(
        `Failed to rollback storage upload for song ${songId}: ${rollbackMsg}`,
      );
    }

    // Re-throw the original API error.
    throw err;
  }
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
