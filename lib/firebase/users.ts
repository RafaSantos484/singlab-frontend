'use client';

import { doc, setDoc } from 'firebase/firestore';

import { getFirebaseFirestore } from './firestore';

// ---------------------------------------------------------------------------
// User document operations — direct Firestore writes
// ---------------------------------------------------------------------------

/**
 * Creates a user profile document in Firestore.
 *
 * Should be called after a verified user signs in and completes the
 * profile setup form.
 *
 * @param uid - Firebase Auth UID returned by `createUserAccount`.
 * @param name - User's display name.
 * @param email - User's email address.
 */
export async function createUserDoc(
  uid: string,
  name: string,
  email: string,
): Promise<void> {
  const db = getFirebaseFirestore();
  const userRef = doc(db, 'users', uid);

  await setDoc(userRef, {
    name,
    email,
    createdAt: new Date().toISOString(),
  });
}
