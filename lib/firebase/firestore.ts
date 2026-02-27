import { getFirestore, type Firestore } from 'firebase/firestore';
import { getFirebaseApp } from './app';

/**
 * Returns the singleton Firestore instance for the singlab app.
 */
export function getFirebaseFirestore(): Firestore {
  return getFirestore(getFirebaseApp());
}
