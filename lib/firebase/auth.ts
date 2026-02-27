import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  updateProfile,
  type Auth,
} from 'firebase/auth';
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

/**
 * Signs in the user with email and password.
 *
 * @throws {FirebaseError} On invalid credentials or other auth errors.
 */
export async function signIn(email: string, password: string): Promise<void> {
  await signInWithEmailAndPassword(getFirebaseAuth(), email, password);
}

/**
 * Registers a new user with email, password, and display name.
 *
 * @throws {FirebaseError} On auth errors (e.g. email already in use).
 */
export async function signUp(
  email: string,
  password: string,
  name: string,
): Promise<void> {
  const { user } = await createUserWithEmailAndPassword(
    getFirebaseAuth(),
    email,
    password,
  );
  await updateProfile(user, { displayName: name });
}

/**
 * Signs out the currently authenticated user.
 */
export async function signOut(): Promise<void> {
  await firebaseSignOut(getFirebaseAuth());
}
