import { Env } from '@/lib/env';
import {
  ApiError,
  type ApiErrorResponse,
  type ApiSuccessResponse,
} from './types';
import type { CreateUserInput, CreateUserResult } from './types';

/**
 * API client module for the `/users` resource.
 *
 * User creation is a **public** endpoint — no auth token is required.
 * That is why this module does not depend on `ApiClient`.
 */
export class UsersApi {
  private readonly baseUrl: string;

  constructor(baseUrl: string = Env.apiUrl) {
    this.baseUrl = baseUrl;
  }

  // -------------------------------------------------------------------------
  // POST /users
  // -------------------------------------------------------------------------

  /**
   * Creates a new user account.
   *
   * The backend (singlab-api) will:
   * 1. Validate the input.
   * 2. Create a Firebase Auth account.
   * 3. Persist the user profile document in Firestore.
   *
   * @param input - Name, email and password for the new account.
   * @returns Created user data (uid, name, email, createdAt).
   * @throws {ApiError} If the email is already in use (409) or validation fails (400).
   */
  async createUser(input: CreateUserInput): Promise<CreateUserResult> {
    const res = await fetch(`${this.baseUrl}/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });

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

    return (body as ApiSuccessResponse<CreateUserResult>).data;
  }
}
