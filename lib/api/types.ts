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

/** Signed Google Cloud Storage URL with its expiry date. */
export interface RawSongUrlInfo {
  /** Signed GCS URL */
  value: string;
  /** ISO 8601 expiry datetime */
  expiresAt: string;
}

/** Raw audio file metadata stored in Firestore. */
export interface RawSongInfo {
  urlInfo: RawSongUrlInfo;
  /** ISO 8601 datetime when the file was originally uploaded */
  uploadedAt: string;
}

/** A song document as returned by the API. */
export interface Song {
  id: string;
  title: string;
  author: string;
  rawSongInfo: RawSongInfo;
}

/** Response payload for `POST /songs/upload`. */
export interface UploadSongResult {
  songId: string;
  title: string;
  author: string;
  rawSongInfo: RawSongInfo;
}

/** Response payload for `GET /songs/:songId/raw/url`. */
export interface SongRawUrl {
  /** Signed GCS URL */
  value: string;
  /** ISO 8601 expiry datetime */
  expiresAt: string;
  /** True when the URL was refreshed because the previous one was about to expire */
  refreshed: boolean;
}
