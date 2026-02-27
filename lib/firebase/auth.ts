import { getAuth, type Auth } from 'firebase/auth';
import { getFirebaseApp } from './app';

/**
 * Returns the singleton Firebase Auth instance.
 */
export function getFirebaseAuth(): Auth {
  return getAuth(getFirebaseApp());
}

/**
 * Returns the current user's Firebase ID token.
 * Pass `forceRefresh = true` to bypass the local cache and fetch a new token.
 *
 * @throws {Error} When there is no currently authenticated user.
 */
export async function getCurrentUserIdToken(
  forceRefresh = false,
): Promise<string> {
  const { currentUser } = getFirebaseAuth();

  if (!currentUser) {
    throw new Error('No authenticated user');
  }

  return currentUser.getIdToken(forceRefresh);
}
