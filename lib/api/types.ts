// ---------------------------------------------------------------------------
// API response envelope shapes (mirrors singlab-api GlobalExceptionFilter)
// ---------------------------------------------------------------------------

export interface ApiSuccessResponse<T> {
  success: true;
  data: T;
}

export interface ApiListSuccessResponse<T> {
  success: true;
  data: T[];
  total: number;
}

export interface ApiMessageSuccessResponse {
  success: true;
  message: string;
}

export interface ApiErrorResponse {
  success: false;
  error: {
    message: string;
    statusCode: number;
    timestamp: string;
  };
}

// ---------------------------------------------------------------------------
// Error class
// ---------------------------------------------------------------------------

/**
 * Thrown whenever the API returns a non-2xx HTTP status.
 * Carries the structured error body returned by the backend.
 */
export class ApiError extends Error {
  public readonly statusCode: number;
  public readonly timestamp: string;

  /**
   * @param statusCode - HTTP status code returned by the server.
   * @param message    - Human-readable error description.
   * @param timestamp  - ISO 8601 datetime when the error occurred on the server.
   */
  constructor(statusCode: number, message: string, timestamp: string) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.timestamp = timestamp;
  }
}

// ---------------------------------------------------------------------------
// User domain types
// ---------------------------------------------------------------------------

/**
 * Input payload for creating a new user account (`POST /users`).
 * Mirrors `CreateUserDto` from singlab-api.
 */
export interface CreateUserInput {
  /** Full display name (3–255 chars). */
  name: string;
  /** Email address (max 255 chars). */
  email: string;
  /** Password (6–255 printable chars, no spaces). */
  password: string;
}

/**
 * Response payload returned by `POST /users` on success.
 * Mirrors `CreateUserResult` from singlab-api.
 */
export interface CreateUserResult {
  uid: string;
  name: string;
  email: string;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Song domain types
// ---------------------------------------------------------------------------

/**
 * Raw audio metadata stored in Firestore.
 *
 * Note: The `path` field was removed. Storage paths are now computed
 * dynamically from userId + songId (convention-based approach).
 * This simplifies the data model and eliminates path redundancy.
 */
export interface RawSongInfo {
  /** ISO 8601 datetime when the song was uploaded. */
  uploadedAt: string;
}

/** A song document as returned by the API. */
export interface Song {
  id: string;
  title: string;
  author: string;
  rawSongInfo: RawSongInfo;
  separatedSongInfo: SeparatedSongInfo | null;
}

/** Response payload for `POST /songs/upload`. */
export interface UploadSongResult {
  songId: string;
  title: string;
  author: string;
  rawSongInfo: RawSongInfo;
}

// ---------------------------------------------------------------------------
// Separation domain types
// ---------------------------------------------------------------------------

/** Supported stem separation providers. */
export type SeparationProviderName = 'poyo' | 'local';

/** High-level status of a separation task. */
export type SeparationJobStatus = 'processing' | 'finished' | 'failed';

/** Canonical stem keys supported across providers. */
export type SeparationStemName =
  | 'vocals'
  | 'bass'
  | 'drums'
  | 'piano'
  | 'guitar'
  | 'other';

/** Stems as returned directly by a provider (raw URLs). */
export type SeparationProviderStemOutputs = Record<
  SeparationStemName,
  string | null
>;

/**
 * Stems persisted in Firestore as available stem names only.
 *
 * Migration note: Previously stored as `{ uploadedAt, paths }` object.
 * Now simplified to array of stem names. Storage paths are computed
 * dynamically using `buildStemStoragePath(userId, songId, stemName)`.
 */
export type SeparationStems = SeparationStemName[];

/** Provider-agnostic view of a separation task. */
export interface NormalizedSeparationInfo<TProviderData = unknown> {
  provider: SeparationProviderName;
  status: SeparationJobStatus;
  taskId: string | null;
  errorMessage: string | null;
  requestedAt: string | null;
  finishedAt: string | null;
  stems: SeparationStems | null;
  /** Raw provider payload retained for debugging and future providers. */
  providerData: TProviderData;
  /** Additional metadata such as timestamps or provider-specific flags. */
  metadata: Record<string, unknown>;
}

/** Stored separation info on the song document. */
export interface SeparatedSongInfo<TData = unknown> {
  provider: SeparationProviderName;
  providerData: TData;
  stems: SeparationStems | null;
}

// ---------------------------------------------------------------------------
// Provider-specific models (PoYo)
// ---------------------------------------------------------------------------

export type PoyoSeparationStatus =
  | 'not_started'
  | 'running'
  | 'finished'
  | 'failed';

interface PoyoSeparationTaskDetailsBase {
  task_id: string;
  status: PoyoSeparationStatus;
  created_time: string;
  error_message?: string | null;
}

export type PoyoNotStartedSeparationTaskDetails =
  PoyoSeparationTaskDetailsBase & {
    status: 'not_started';
  };

export type PoyoRunningSeparationTaskDetails = PoyoSeparationTaskDetailsBase & {
  status: 'running';
  error_message: null;
  files: [];
};

export type PoyoFinishedSeparationTaskDetails =
  PoyoSeparationTaskDetailsBase & {
    status: 'finished';
    error_message: null;
    files: {
      vocal_removal: SeparationProviderStemOutputs;
    };
  };

export type PoyoFailedSeparationTaskDetails = PoyoSeparationTaskDetailsBase & {
  status: 'failed';
  error_message: string;
  files: [];
};

export type PoyoSeparationTaskDetails =
  | PoyoNotStartedSeparationTaskDetails
  | PoyoRunningSeparationTaskDetails
  | PoyoFinishedSeparationTaskDetails
  | PoyoFailedSeparationTaskDetails;

export type PoyoSeparatedSongInfo =
  SeparatedSongInfo<PoyoSeparationTaskDetails>;
// ---------------------------------------------------------------------------
// Provider-specific models (Local)
// ---------------------------------------------------------------------------

/**
 * Local provider has no provider-specific task payload.
 * Available stems live in `separatedSongInfo.stems`.
 *
 * Migration note: Previously stored `{ uploadedAt }`. Now null because
 * upload timestamp is tracked at the song document level (`updatedAt`),
 * not per-provider.
 */
export type LocalSeparationProviderData = null;

export type LocalSeparatedSongInfo =
  SeparatedSongInfo<LocalSeparationProviderData>;
