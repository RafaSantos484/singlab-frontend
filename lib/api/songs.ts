import { type ApiClient } from './client';
import {
  type ApiMessageSuccessResponse,
  type ApiSuccessResponse,
  type Song,
  type UploadSongResult,
} from './types';

/** Metadata required when registering a new song after the client has uploaded the raw file to Storage. */
export interface UploadSongInput {
  /** Pre-generated stable ID that matches the file already uploaded to Storage. */
  songId: string;
  title: string;
  author: string;
}

/**
 * API client module for the `/songs` resource.
 *
 * All methods require an authenticated user — the underlying `ApiClient`
 * handles token injection and refresh automatically.
 */
export class SongsApi {
  /**
   * @param client - Authenticated `ApiClient` instance used to make requests.
   */
  constructor(private readonly client: ApiClient) {}

  // -------------------------------------------------------------------------
  // POST /songs/upload
  // -------------------------------------------------------------------------

  /**
   * Registers a new song document after the client has uploaded the raw audio
   * file to Cloud Storage at `users/:userId/songs/:songId/raw.mp3`.
   *
   * The API validates that the storage file exists, then persists the Firestore
   * document. This method only sends JSON metadata — the file upload is the
   * caller's responsibility.
   *
   * @param metadata - Song ID, title and author.
   * @returns The created song payload including rawSongInfo.
   */
  async uploadSong(metadata: UploadSongInput): Promise<UploadSongResult> {
    const res = await this.client.post<ApiSuccessResponse<UploadSongResult>>(
      '/songs/upload',
      metadata,
    );

    return res.data;
  }
  // -------------------------------------------------------------------------
  // PATCH /songs/:songId
  // -------------------------------------------------------------------------

  /**
   * Updates a song's metadata (title and/or author).
   * Only the provided fields are updated.
   *
   * @param songId - Song document ID.
   * @param updates - Partial song metadata with title and/or author.
   * @returns Updated song with id, title, and author.
   * @throws {ApiError} With status 404 when the song does not exist.
   */
  async updateSong(
    songId: string,
    updates: Partial<UploadSongInput>,
  ): Promise<Song> {
    const res = await this.client.patch<ApiSuccessResponse<Song>>(
      `/songs/${songId}`,
      updates,
    );

    return res.data;
  }

  // -------------------------------------------------------------------------
  // DELETE /songs/:songId
  // -------------------------------------------------------------------------

  /**
   * Deletes a song and its associated audio file from storage.
   *
   * @returns The confirmation message from the server.
   * @throws {ApiError} With status 404 when the song does not exist.
   */
  async deleteSong(songId: string): Promise<string> {
    const res = await this.client.delete<ApiMessageSuccessResponse>(
      `/songs/${songId}`,
    );

    return res.message;
  }
}
