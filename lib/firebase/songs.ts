'use client';

import {
  doc,
  setDoc,
  updateDoc,
  deleteDoc,
  collection,
} from 'firebase/firestore';

import { getFirebaseFirestore } from './firestore';
import type {
  RawSongInfo,
  SeparatedSongInfo,
  SeparationStems,
} from '@/lib/api/types';

// ---------------------------------------------------------------------------
// Song document operations — direct Firestore writes
// ---------------------------------------------------------------------------

/**
 * Builds the Firestore document reference path for a song.
 *
 * @param userId - Firebase Auth UID of the song owner.
 * @param songId - Song document ID.
 * @returns DocumentReference for `users/{userId}/songs/{songId}`.
 */
function songDocRef(userId: string, songId: string) {
  const db = getFirebaseFirestore();
  return doc(db, 'users', userId, 'songs', songId);
}

/**
 * Generates a Firestore-compatible document ID for a new song.
 *
 * Uses the Firestore client SDK to produce the same format as
 * server-generated IDs.
 *
 * @param userId - Firebase Auth UID of the song owner.
 * @returns A new unique song document ID.
 */
export function generateSongId(userId: string): string {
  const db = getFirebaseFirestore();
  return doc(collection(db, 'users', userId, 'songs')).id;
}

/**
 * Creates a song document in Firestore after the raw audio file has
 * been uploaded to Cloud Storage.
 *
 * @param userId - Firebase Auth UID of the song owner.
 * @param songId - Pre-generated song document ID.
 * @param title - Song title.
 * @param author - Song author / artist name.
 * @param storagePath - Storage path of the raw audio file.
 */
export async function createSongDoc(
  userId: string,
  songId: string,
  title: string,
  author: string,
  storagePath: string,
): Promise<void> {
  const rawSongInfo: RawSongInfo = {
    path: storagePath,
    uploadedAt: new Date().toISOString(),
  };

  await setDoc(songDocRef(userId, songId), {
    title,
    author,
    rawSongInfo,
    separatedSongInfo: null,
  });
}

/**
 * Updates a song's metadata (title and/or author).
 *
 * @param userId - Firebase Auth UID of the song owner.
 * @param songId - Song document ID.
 * @param updates - Partial metadata with title and/or author.
 */
export async function updateSongDoc(
  userId: string,
  songId: string,
  updates: { title?: string; author?: string },
): Promise<void> {
  const data: Record<string, string> = {};
  if (updates.title !== undefined) data['title'] = updates.title;
  if (updates.author !== undefined) data['author'] = updates.author;

  if (Object.keys(data).length === 0) return;

  await updateDoc(songDocRef(userId, songId), data);
}

/**
 * Deletes a song document from Firestore.
 *
 * Storage cleanup (raw file + stems) must be handled separately by
 * the caller before or after this call.
 *
 * @param userId - Firebase Auth UID of the song owner.
 * @param songId - Song document ID.
 */
export async function deleteSongDoc(
  userId: string,
  songId: string,
): Promise<void> {
  await deleteDoc(songDocRef(userId, songId));
}

/**
 * Writes the separation info (provider data, stems) to the song document.
 *
 * Used after submitting a separation task or after uploading stems.
 *
 * @param userId - Firebase Auth UID of the song owner.
 * @param songId - Song document ID.
 * @param separatedSongInfo - Full separation info to persist.
 */
export async function updateSeparatedSongInfo(
  userId: string,
  songId: string,
  separatedSongInfo: SeparatedSongInfo,
): Promise<void> {
  await updateDoc(songDocRef(userId, songId), { separatedSongInfo });
}

/**
 * Updates only the stem paths on an existing separation.
 *
 * Preserves the existing provider and providerData fields.
 *
 * @param userId - Firebase Auth UID of the song owner.
 * @param songId - Song document ID.
 * @param stems - Stem metadata with upload time and storage paths.
 */
export async function updateSeparationStems(
  userId: string,
  songId: string,
  stems: SeparationStems,
): Promise<void> {
  await updateDoc(songDocRef(userId, songId), {
    'separatedSongInfo.stems': stems,
  });
}

/**
 * Deletes all separation information (provider data and stems) from a song.
 *
 * This allows the user to request separation again from a different provider.
 * Note: Storage cleanup (stem files) must be handled separately.
 *
 * @param userId - Firebase Auth UID of the song owner.
 * @param songId - Song document ID.
 */
export async function deleteSeparatedSongInfo(
  userId: string,
  songId: string,
): Promise<void> {
  await updateDoc(songDocRef(userId, songId), {
    separatedSongInfo: null,
  });
}
