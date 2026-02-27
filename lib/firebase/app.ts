import { initializeApp, getApps, getApp, type FirebaseApp } from 'firebase/app';
import { Env } from '@/lib/env';

/**
 * Returns the singleton Firebase app instance.
 * Initializes it on first call using environment variables.
 */
export function getFirebaseApp(): FirebaseApp {
  if (getApps().length === 0) {
    return initializeApp(Env.firebase);
  }
  return getApp();
}
