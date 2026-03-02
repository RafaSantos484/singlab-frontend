import { type ApiClient } from './client';
import {
  type ApiSuccessResponse,
  type ApiMessageSuccessResponse,
  type PoyoSeparationTaskDetails,
  type SeparationProviderName,
} from './types';

/**
 * API client for stem separation operations.
 */
export class SeparationsApi {
  constructor(private readonly client: ApiClient) {}

  /**
   * Submit a separation request for the given song.
   *
   * The backend persists provider-specific task data on the song document.
   * The response echoes the provider payload, but the real source of truth
   * is the Firestore listener which will update `separatedSongInfo` shortly
   * after submission.
   */
  async requestSeparation(
    songId: string,
    provider?: SeparationProviderName,
  ): Promise<PoyoSeparationTaskDetails | null> {
    const query = provider ? `?provider=${provider}` : '';
    const res = await this.client.post<
      ApiSuccessResponse<PoyoSeparationTaskDetails | null>
    >(`/songs/${songId}/separations${query}`, {});

    return res.data;
  }

  /**
   * Refresh the separation status for a song.
   *
   * This triggers the backend to pull the latest provider status and update
   * the song document in Firestore. The returned payload mirrors the provider
   * detail, but callers should rely on the Firestore listener for the
   * canonical state.
   */
  async refreshSeparationStatus(
    songId: string,
    provider?: SeparationProviderName,
  ): Promise<PoyoSeparationTaskDetails | null> {
    const query = provider ? `?provider=${provider}` : '';
    const res = await this.client.get<
      ApiSuccessResponse<PoyoSeparationTaskDetails | null>
    >(`/songs/${songId}/separations/status${query}`);

    return res.data;
  }

  /**
   * Update the stems for a completed separation task.
   *
   * Called after uploading stems to Firebase Storage. Persists the stem
   * storage paths to the song document.
   *
   * @param songId - Song document ID.
   * @param stemPaths - Record of stem names to storage paths.
   * @param provider - Optional provider identifier.
   */
  async updateSeparationStems(
    songId: string,
    stemPaths: Record<string, string>,
    provider?: SeparationProviderName,
  ): Promise<void> {
    const query = provider ? `?provider=${provider}` : '';
    await this.client.patch<ApiMessageSuccessResponse>(
      `/songs/${songId}/separations/stems${query}`,
      { stems: stemPaths },
    );
  }
}
