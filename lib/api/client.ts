import { Env } from '@/lib/env';
import { withPendingActivity } from '@/lib/async/pendingActivity';
import { ApiError, type ApiErrorResponse } from './types';

// ---------------------------------------------------------------------------
// Token provider
// ---------------------------------------------------------------------------

/**
 * Function that resolves the current user's bearer token.
 * `forceRefresh` bypasses the local token cache.
 */
export type TokenProvider = (forceRefresh?: boolean) => Promise<string>;

// ---------------------------------------------------------------------------
// ApiClient
// ---------------------------------------------------------------------------

/**
 * Generic HTTP client for the singlab-api.
 *
 * Responsibilities:
 * - Injects `Authorization: Bearer <token>` on every request.
 * - On a `401` response, transparently force-refreshes the token and retries
 *   the request once before propagating the error.
 * - Parses the API response envelope and throws `ApiError` for non-2xx codes.
 */
export class ApiClient {
  private readonly baseUrl: string;
  private readonly getToken: TokenProvider;

  /**
   * @param getToken - Async function that resolves the current bearer token.
   *   Receives a `forceRefresh` flag; should forward it to the auth provider.
   * @param baseUrl  - API base URL. Defaults to `Env.apiUrl`.
   */
  constructor(getToken: TokenProvider, baseUrl: string = Env.apiUrl) {
    this.getToken = getToken;
    this.baseUrl = baseUrl;
  }

  // -------------------------------------------------------------------------
  // Public request methods
  // -------------------------------------------------------------------------

  /** Performs a GET request and returns the full response body. */
  async get<T>(path: string): Promise<T> {
    return this.request<T>('GET', path);
  }

  /** Performs a POST request with a JSON body and returns the full response body. */
  async post<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>('POST', path, body);
  }

  /** Performs a POST request with a `FormData` body and returns the full response body. */
  async postFormData<T>(path: string, formData: FormData): Promise<T> {
    return this.request<T>('POST', path, formData);
  }

  /** Performs a PATCH request with a JSON body and returns the full response body. */
  async patch<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>('PATCH', path, body);
  }

  /** Performs a DELETE request and returns the full response body. */
  async delete<T>(path: string): Promise<T> {
    return this.request<T>('DELETE', path);
  }

  // -------------------------------------------------------------------------
  // Internal implementation
  // -------------------------------------------------------------------------

  private async request<T>(
    method: string,
    path: string,
    body?: unknown | FormData,
  ): Promise<T> {
    return withPendingActivity(async () => {
      let res = await this.doFetch(method, path, body, false);

      // Transparently retry once with a force-refreshed token on 401.
      if (res.status === 401) {
        res = await this.doFetch(method, path, body, true);
      }

      return this.handleResponse<T>(res);
    });
  }

  private async doFetch(
    method: string,
    path: string,
    body: unknown | FormData | undefined,
    forceRefresh: boolean,
  ): Promise<Response> {
    const token = await this.getToken(forceRefresh);
    const headers = new Headers({ Authorization: `Bearer ${token}` });

    let bodyInit: BodyInit | undefined;

    if (body instanceof FormData) {
      // Let the browser set the correct Content-Type (incl. boundary).
      bodyInit = body;
    } else if (body !== undefined) {
      headers.set('Content-Type', 'application/json');
      bodyInit = JSON.stringify(body);
    }

    return fetch(`${this.baseUrl}${path}`, { method, headers, body: bodyInit });
  }

  private async handleResponse<T>(res: Response): Promise<T> {
    let body: unknown;

    try {
      body = await res.json();
    } catch {
      throw new ApiError(
        res.status,
        res.statusText || 'Unknown error',
        new Date().toISOString(),
      );
    }

    if (!res.ok) {
      const errBody = body as ApiErrorResponse;
      const err = errBody?.error;
      throw new ApiError(
        err?.statusCode ?? res.status,
        err?.message ?? 'Unknown error',
        err?.timestamp ?? new Date().toISOString(),
      );
    }

    return body as T;
  }
}
