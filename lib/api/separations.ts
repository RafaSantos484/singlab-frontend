import { type ApiClient } from './client';
import {
  type ApiSuccessResponse,
  type PoyoSeparationTaskDetails,
  type SeparationProviderName,
} from './types';

/**
 * API client for stem separation operations.
 *
 * The backend acts as a stateless mediator between the frontend and
 * external separation providers (e.g. PoYo). It does not persist any
 * data — the frontend is responsible for writing results to Firestore.
 */
export class SeparationsApi {
  constructor(private readonly client: ApiClient) {}

  /**
   * Submit a separation request to the configured provider.
   *
   * The frontend provides the audio URL and song title directly.
   * The backend forwards the request to the provider and returns
   * the raw task metadata (task_id, status, etc.).
   *
   * After receiving the response, the frontend is responsible for
   * persisting the task data to the song's Firestore document.
   *
   * @param audioUrl - Public URL of the audio file to separate.
   * @param title - Song title for provider metadata.
   * @param provider - Optional provider identifier (defaults to 'poyo').
   * @returns Provider-specific task metadata.
   */
  async requestSeparation(
    audioUrl: string,
    title: string,
    provider?: SeparationProviderName,
  ): Promise<PoyoSeparationTaskDetails | null> {
    const res = await this.client.post<
      ApiSuccessResponse<PoyoSeparationTaskDetails | null>
    >('/separations/submit', {
      audioUrl,
      title,
      provider,
    });

    return res.data;
  }

  /**
   * Retrieve the current status of a separation task from the provider.
   *
   * The frontend provides the task ID. The backend fetches the latest
   * detail from the provider and returns it as-is.
   *
   * After receiving the response, the frontend is responsible for
   * updating the song's Firestore document with the new provider data.
   *
   * @param taskId - Provider-specific task identifier.
   * @param provider - Optional provider identifier (defaults to 'poyo').
   * @returns Provider-specific task detail including status and stem URLs.
   */
  async refreshSeparationStatus(
    taskId: string,
    provider?: SeparationProviderName,
  ): Promise<PoyoSeparationTaskDetails | null> {
    const params = new URLSearchParams({ taskId });
    if (provider) params.set('provider', provider);

    const res = await this.client.get<
      ApiSuccessResponse<PoyoSeparationTaskDetails | null>
    >(`/separations/status?${params.toString()}`);

    return res.data;
  }
}
