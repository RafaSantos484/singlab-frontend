import { type ApiClient } from './client';
import {
  type ApiListSuccessResponse,
  type ApiMessageSuccessResponse,
  type ApiSuccessResponse,
  type Song,
  type SongRawUrl,
  type UploadSongResult,
} from './types';

/** Metadata required when uploading a new song. */
export interface UploadSongInput {
  title: string;
  author: string;
}

/** Paginated list result for `listSongs`. */
export interface SongList {
  songs: Song[];
  total: number;
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
   * Uploads an audio file and creates a new song.
   *
   * @param file - The audio/video file to upload (max 100 MB).
   * @param metadata - The song title and author.
   * @returns The created song payload including the raw signed URL.
   */
  async uploadSong(
    file: File,
    metadata: UploadSongInput,
  ): Promise<UploadSongResult> {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('metadata', JSON.stringify(metadata));

    const res = await this.client.postFormData<
      ApiSuccessResponse<UploadSongResult>
    >('/songs/upload', formData);

    return res.data;
  }

  // -------------------------------------------------------------------------
  // GET /songs
  // -------------------------------------------------------------------------

  /**
   * Returns the authenticated user's song library.
   */
  async listSongs(): Promise<SongList> {
    const res = await this.client.get<ApiListSuccessResponse<Song>>('/songs');

    return { songs: res.data, total: res.total };
  }

  // -------------------------------------------------------------------------
  // GET /songs/:songId
  // -------------------------------------------------------------------------

  /**
   * Returns a single song by ID.
   *
   * @throws {ApiError} With status 404 when the song does not exist.
   */
  async getSong(songId: string): Promise<Song> {
    const res = await this.client.get<ApiSuccessResponse<Song>>(
      `/songs/${songId}`,
    );

    return res.data;
  }

  // -------------------------------------------------------------------------
  // GET /songs/:songId/raw/url
  // -------------------------------------------------------------------------

  /**
   * Returns a valid signed URL for the raw audio file.
   * The backend automatically refreshes the URL if it is about to expire.
   *
   * @throws {ApiError} With status 404 when the song does not exist.
   */
  async getSongRawUrl(songId: string): Promise<SongRawUrl> {
    const res = await this.client.get<ApiSuccessResponse<SongRawUrl>>(
      `/songs/${songId}/raw/url`,
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
