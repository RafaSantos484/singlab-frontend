/**
 * @module lib/api
 *
 * Pre-wired API client singletons for singlab-api resources.
 *
 * The backend now acts solely as a stateless mediator between the
 * frontend and external APIs (e.g. PoYo stem separation). All Firebase
 * data and file operations are handled directly by the frontend.
 *
 * Usage (client components / hooks only):
 * ```ts
 * import { separationsApi } from '@/lib/api';
 *
 * const task = await separationsApi.requestSeparation(audioUrl, title);
 * ```
 *
 * The underlying `ApiClient` automatically:
 * - attaches the Firebase ID token as `Authorization: Bearer <token>`
 * - force-refreshes the token and retries on `401` responses
 * - throws `ApiError` for all non-2xx responses
 */

import { getCurrentUserIdToken } from '@/lib/firebase/auth';
import { ApiClient } from './client';
import { SeparationsApi } from './separations';

// ---------------------------------------------------------------------------
// Shared client instance
// ---------------------------------------------------------------------------

const apiClient = new ApiClient(getCurrentUserIdToken);

// ---------------------------------------------------------------------------
// Resource APIs
// ---------------------------------------------------------------------------

export const separationsApi = new SeparationsApi(apiClient);

// ---------------------------------------------------------------------------
// Re-exports for consumers
// ---------------------------------------------------------------------------

export { ApiClient } from './client';
export type { TokenProvider } from './client';

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
