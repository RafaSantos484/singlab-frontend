/**
 * @module lib/api
 *
 * Pre-wired API client singletons for all singlab-api resources.
 *
 * Usage (client components / hooks only):
 * ```ts
 * import { songsApi } from '@/lib/api';
 *
 * const created = await songsApi.uploadSong(file, { title, author });
 * ```
 *
 * The underlying `ApiClient` automatically:
 * - attaches the Firebase ID token as `Authorization: Bearer <token>`
 * - force-refreshes the token and retries on `401` responses
 * - throws `ApiError` for all non-2xx responses
 */

import { getCurrentUserIdToken } from '@/lib/firebase/auth';
import { ApiClient } from './client';
import { SongsApi } from './songs';
import { UsersApi } from './users';
import { SeparationsApi } from './separations';

// ---------------------------------------------------------------------------
// Shared client instance
// ---------------------------------------------------------------------------

const apiClient = new ApiClient(getCurrentUserIdToken);

// ---------------------------------------------------------------------------
// Resource APIs
// ---------------------------------------------------------------------------

export const songsApi = new SongsApi(apiClient);
export const separationsApi = new SeparationsApi(apiClient);

/** Public API instance — user creation does not require authentication. */
export const usersApi = new UsersApi();

// ---------------------------------------------------------------------------
// Re-exports for consumers
// ---------------------------------------------------------------------------

export { ApiClient } from './client';
export type { TokenProvider } from './client';

export { SongsApi } from './songs';
export type { UploadSongInput } from './songs';

export { UsersApi } from './users';
export { SeparationsApi } from './separations';

export { ApiError } from './types';
export type {
  Song,
  UploadSongResult,
  RawSongInfo,
  SeparatedSongInfo,
  NormalizedSeparationInfo,
  SeparationJobStatus,
  SeparationProviderName,
  SeparationStemName,
  SeparationStems,
  PoyoSeparationTaskDetails,
  PoyoSeparationStatus,
  PoyoSeparatedSongInfo,
  CreateUserInput,
  CreateUserResult,
  ApiSuccessResponse,
  ApiListSuccessResponse,
  ApiMessageSuccessResponse,
  ApiErrorResponse,
} from './types';
