/**
 * @module lib/api/song-creation
 *
 * Service layer for song creation operations.
 *
 * Encapsulates file validation, API calls, and error handling for uploading
 * new songs to the backend.
 */

import { songsApi } from './index';
import type { UploadSongInput } from './songs';

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
// Validation errors
// ---------------------------------------------------------------------------

export class InvalidFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidFileError';
  }
}

export class FileSizeExceededError extends InvalidFileError {
  constructor(fileName: string, sizeMB: number) {
    super(
      `File "${fileName}" exceeds maximum size of ${MAX_FILE_SIZE_MB}MB (current: ${sizeMB.toFixed(1)}MB)`,
    );
    this.name = 'FileSizeExceededError';
  }
}

export class InvalidFileTypeError extends InvalidFileError {
  constructor(fileName: string) {
    super(
      `File "${fileName}" has unsupported format. Supported formats: MP3, WAV, OGG, WebM, MP4, MOV, FLAC.`,
    );
    this.name = 'InvalidFileTypeError';
  }
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
}

export interface CreateSongResult {
  songId: string;
  title: string;
  author: string;
}

/**
 * Creates a new song by uploading an audio file and metadata.
 *
 * Validates the file before uploading and returns the created song.
 *
 * @param options - Options including file and metadata (title, author).
 * @returns The created song result.
 * @throws {InvalidFileError} If file validation fails.
 * @throws {ApiError} If the API call fails.
 */
export async function createSong(
  options: CreateSongOptions,
): Promise<CreateSongResult> {
  const { title, author, file } = options;

  // Validate file before upload
  validateSongFile(file);

  // Prepare metadata
  const metadata: UploadSongInput = {
    title,
    author,
  };

  // Upload to API
  const result = await songsApi.uploadSong(file, metadata);

  return {
    songId: result.songId,
    title: result.title,
    author: result.author,
  };
}

/**
 * Validates and formats metadata fields for song creation.
 *
 * @param title - Song title (will be trimmed).
 * @param author - Song author (will be trimmed).
 * @returns Validation errors or null if valid.
 */
export function validateSongMetadata(
  title: string,
  author: string,
): { title?: string; author?: string } | null {
  const errors: { title?: string; author?: string } = {};

  const trimmedTitle = title.trim();
  const trimmedAuthor = author.trim();

  if (!trimmedTitle) {
    errors.title = 'Song title is required';
  } else if (trimmedTitle.length > 255) {
    errors.title = 'Song title must be 255 characters or less';
  }

  if (!trimmedAuthor) {
    errors.author = 'Artist/Author name is required';
  } else if (trimmedAuthor.length > 255) {
    errors.author = 'Artist/Author name must be 255 characters or less';
  }

  return Object.keys(errors).length > 0 ? errors : null;
}
