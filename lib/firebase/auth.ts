import {
  getAuth,
  getRedirectResult,
  signInWithEmailAndPassword,
  signInWithPopup,
  signInWithRedirect,
  createUserWithEmailAndPassword,
  signOut as firebaseSignOut,
  sendEmailVerification,
  sendPasswordResetEmail,
  GoogleAuthProvider,
  type Auth,
  type User,
} from 'firebase/auth';
import { withPendingActivity } from '@/lib/async/pendingActivity';
import { getFirebaseApp } from './app';
import { storageUrlManager } from '@/lib/storage/StorageUrlManager';

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
  return withPendingActivity(async () => {
    const { currentUser } = getFirebaseAuth();

    if (!currentUser) {
      throw new Error('No authenticated user');
    }

    return currentUser.getIdToken(forceRefresh);
  });
}

/**
 * Error thrown when a user attempts to log in with an unverified email.
 */
export class EmailNotVerifiedError extends Error {
  constructor() {
    super('Email address has not been verified.');
    this.name = 'EmailNotVerifiedError';
  }
}

/**
 * Returns `true` when running in a mobile browser where popup OAuth is
 * less reliable, so redirect-based sign-in should be preferred.
 */
export function shouldUseRedirectForGoogleSignIn(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }

  const nav = navigator as Navigator & {
    userAgentData?: {
      mobile?: boolean;
    };
  };

  if (typeof nav.userAgentData?.mobile === 'boolean') {
    return nav.userAgentData.mobile;
  }

  return /android|iphone|ipad|ipod|iemobile|opera mini|mobile/i.test(
    navigator.userAgent,
  );
}

/**
 * Creates a new Firebase Auth user account.
 *
 * The caller is responsible for persisting the user profile document
 * in Firestore (via `createUserDoc`) and sending a verification email.
 *
 * @param email - User's email address.
 * @param password - User's password.
 * @returns The UID of the newly created user.
 * @throws {FirebaseError} On validation failure or email already in use.
 */
export async function createUserAccount(
  email: string,
  password: string,
): Promise<string> {
  return withPendingActivity(async () => {
    const auth = getFirebaseAuth();
    const { user } = await createUserWithEmailAndPassword(
      auth,
      email,
      password,
    );

    // Send verification email before signing out
    await sendEmailVerification(user);

    // Sign out immediately — user should verify before logging in
    await firebaseSignOut(auth);

    return user.uid;
  });
}

/**
 * Signs in the user with email and password.
 *
 * Throws `EmailNotVerifiedError` if the credentials are valid but the
 * user has not yet confirmed their email address. In that case the
 * session is immediately ended so no authenticated state leaks out.
 *
 * @throws {EmailNotVerifiedError} When the email is not yet verified.
 * @throws {FirebaseError} On invalid credentials or other auth errors.
 */
export async function signIn(email: string, password: string): Promise<void> {
  await withPendingActivity(async () => {
    const { user } = await signInWithEmailAndPassword(
      getFirebaseAuth(),
      email,
      password,
    );

    if (!user.emailVerified) {
      await firebaseSignOut(getFirebaseAuth());
      throw new EmailNotVerifiedError();
    }
  });
}

/**
 * Signs in the user with Google OAuth via popup.
 *
 * Use this for desktop browsers. For mobile, use `signInWithGoogleRedirect`
 * and `resolveGoogleRedirectSignIn` instead.
 *
 * Enforces the same email verification policy used by password sign-in:
 * if the provider user is not verified, the session is immediately cleared
 * and `EmailNotVerifiedError` is thrown.
 *
 * @throws {EmailNotVerifiedError} When the email is not yet verified.
 * @throws {FirebaseError} On popup/auth errors.
 */
export async function signInWithGooglePopup(): Promise<void> {
  await withPendingActivity(async () => {
    const auth = getFirebaseAuth();
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });

    const { user } = await signInWithPopup(auth, provider);

    if (!user.emailVerified) {
      await firebaseSignOut(auth);
      throw new EmailNotVerifiedError();
    }
  });
}

/**
 * Initiates Google OAuth sign-in via redirect flow.
 *
 * The page will navigate to Google's OAuth screen immediately.
 * When the user returns, `getRedirectResult()` is called automatically
 * in `GlobalStateProvider` to complete the sign-in.
 *
 * Use this for mobile browsers where popup is unreliable.
 */
export async function signInWithGoogleRedirect(): Promise<void> {
  const auth = getFirebaseAuth();
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  await signInWithRedirect(auth, provider);
}

/**
 * Sends a verification email to the given Firebase user.
 * Meant to be called right after the account is created, while the
 * caller still holds a reference to the temporary `User` object.
 *
 * @param user - The Firebase `User` whose email should be verified.
 */
export async function sendVerificationEmail(user: User): Promise<void> {
  await withPendingActivity(async () => {
    await sendEmailVerification(user);
  });
}

/**
 * Signs in with email + password **temporarily** to send a verification
 * email, then immediately signs out.
 *
 * Call this right after a new account has been created via the API so the
 * user receives a verification link without being left in a signed-in state.
 *
 * @param email    - The new user's email address.
 * @param password - The new user's password.
 */
export async function initiateEmailVerification(
  email: string,
  password: string,
): Promise<void> {
  await withPendingActivity(async () => {
    const auth = getFirebaseAuth();
    const { user } = await signInWithEmailAndPassword(auth, email, password);
    await sendEmailVerification(user);
    await firebaseSignOut(auth);
  });
}

/**
 * Signs out the currently authenticated user.
 *
 * Clears storage URL cache to prevent cross-session data leaks.
 */
export async function signOut(): Promise<void> {
  await withPendingActivity(async () => {
    await firebaseSignOut(getFirebaseAuth());
    // Clear storage URL cache on session end
    storageUrlManager.clearCache();
  });
}

/**
 * Sends a password reset email to the given address.
 *
 * @param email - Email address that should receive the reset instructions.
 */
export async function sendPasswordReset(email: string): Promise<void> {
  await withPendingActivity(async () => {
    await sendPasswordResetEmail(getFirebaseAuth(), email);
  });
}
