/**
 * @module lib/api/songs
 *
 * Song operations are now handled directly via Firestore (client SDK).
 * This module re-exports the Firestore song functions for backward
 * compatibility with existing consumers.
 *
 * @see lib/firebase/songs.ts
 */

export {
  generateSongId,
  createSongDoc,
  updateSongDoc,
  deleteSongDoc,
  updateSeparatedSongInfo,
  updateSeparationStems,
} from '@/lib/firebase/songs';
