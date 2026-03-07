'use client';

import {
  type User as FirebaseUser,
  onAuthStateChanged,
  signOut as firebaseSignOut,
} from 'firebase/auth';
import {
  collection,
  doc,
  onSnapshot,
  type DocumentData,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';
import { useEffect, useReducer } from 'react';

import { getFirebaseAuth } from '@/lib/firebase/auth';
import { getFirebaseFirestore } from '@/lib/firebase/firestore';
import type { RawSongInfo, SeparatedSongInfo } from '@/lib/api/types';
import { useStemAutoProcessor } from '@/lib/hooks/useStemAutoProcessor';

import {
  GlobalStateContext,
  GlobalStateDispatchContext,
} from './GlobalStateContext';
import { globalStateReducer, initialState } from './reducer';
import type { AuthUser, Song } from './types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Extracts a plain, serialisable `AuthUser` from a Firebase `User` object. */
function toAuthUser(user: FirebaseUser): AuthUser {
  return {
    uid: user.uid,
    email: user.email!,
    // Name is sourced from Firestore (/users/{uid}.name), never from Auth displayName.
    name: user.email ?? '',
    photoURL: user.photoURL,
    emailVerified: user.emailVerified,
  };
}

/** Maps a Firestore song document to the `Song` domain type. */
function docToSong(snap: QueryDocumentSnapshot<DocumentData>): Song {
  const d = snap.data();
  return {
    id: snap.id,
    title: d['title'] as string,
    author: d['author'] as string,
    rawSongInfo: d['rawSongInfo'] as RawSongInfo,
    separatedSongInfo: (d['separatedSongInfo'] as SeparatedSongInfo) ?? null,
  };
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

interface GlobalStateProviderProps {
  children: React.ReactNode;
}

/**
 * Application-wide state provider.
 *
 * Responsibilities:
 * - Subscribes to **Firebase Auth** state changes to track the signed-in user.
 *   Identity comes from Auth and display name comes from Firestore profile.
 * - When a user is authenticated, subscribes to a **Firestore real-time
 *   listener** for `/users/{uid}/songs` — the user's song library.
 * - Tears down Firestore listeners automatically on sign-out or unmount.
 *
 * Wrap the root layout (or the highest client boundary) with this component
 * so that all descendants can access state via `useGlobalState()`.
 */
export function GlobalStateProvider({ children }: GlobalStateProviderProps) {
  const [state, dispatch] = useReducer(globalStateReducer, initialState);

  // Automatically process stems when separation finishes
  useStemAutoProcessor({
    songs: state.songs,
    songsStemUploading: state.songsStemUploading,
    dispatch,
  });

  // -------------------------------------------------------------------------
  // 1. Firebase Auth listener
  // -------------------------------------------------------------------------

  useEffect(() => {
    const auth = getFirebaseAuth();
    let unsubscribe: (() => void) | null = null;

    const init = async (): Promise<void> => {
      // Process redirect result BEFORE registering onAuthStateChanged
      // to prevent Firebase from clearing the redirect state
      try {
        const { getRedirectResult } = await import('firebase/auth');
        const result = await getRedirectResult(auth);

        if (result && !result.user.emailVerified) {
          await firebaseSignOut(auth);
        }
      } catch (error) {
        // Redirect errors are handled silently; user stays on login page
      }

      // Register the auth state listener
      unsubscribe = onAuthStateChanged(auth, (user) => {
        if (user) {
          if (!user.emailVerified) {
            void firebaseSignOut(auth);
            dispatch({ type: 'AUTH_UNAUTHENTICATED' });
            return;
          }
          dispatch({ type: 'AUTH_AUTHENTICATED', payload: toAuthUser(user) });
        } else {
          dispatch({ type: 'AUTH_UNAUTHENTICATED' });
        }
      });
    };

    void init();

    return () => {
      if (unsubscribe) {
        unsubscribe();
      }
    };
  }, []);

  // -------------------------------------------------------------------------
  // 2. Firestore listener for user profile — keeps `/users/{uid}.name` in sync
  // -------------------------------------------------------------------------

  useEffect(() => {
    const uid = state.userProfile?.uid;

    if (!uid) return;

    const db = getFirebaseFirestore();

    dispatch({ type: 'USER_DOC_LOADING' });

    const unsubUserProfile = onSnapshot(
      doc(db, 'users', uid),
      (snap) => {
        if (!snap.exists()) {
          dispatch({ type: 'USER_DOC_MISSING' });
          return;
        }

        const data = snap.data();
        const firestoreName = data['name'];
        const firestoreEmail = data['email'];

        if (typeof firestoreEmail === 'string' && firestoreEmail.trim()) {
          dispatch({
            type: 'AUTH_PROFILE_UPDATED',
            payload: { email: firestoreEmail.trim() },
          });
        }

        if (typeof firestoreName === 'string' && firestoreName.trim()) {
          dispatch({
            type: 'AUTH_PROFILE_UPDATED',
            payload: { name: firestoreName.trim() },
          });
        }

        dispatch({ type: 'USER_DOC_EXISTS' });
      },
      () => {
        // Fail closed for route gating: if read fails, treat as missing profile.
        dispatch({ type: 'USER_DOC_MISSING' });
      },
    );

    return () => {
      unsubUserProfile();
    };
  }, [state.userProfile?.uid]);

  // -------------------------------------------------------------------------
  // 3. Firestore listener for songs — activated only while a user is authenticated
  // -------------------------------------------------------------------------

  useEffect(() => {
    // uid is the stable key; derived from the auth state set above.
    const uid = state.userProfile?.uid;

    if (!uid || state.userDocStatus !== 'exists') return;

    const db = getFirebaseFirestore();

    // --- Songs: /users/{uid}/songs ---
    dispatch({ type: 'SONGS_LOADING' });

    const unsubSongs = onSnapshot(
      collection(db, 'users', uid, 'songs'),
      (snap) => {
        dispatch({
          type: 'SONGS_READY',
          payload: snap.docs.map(docToSong),
        });
      },
      () => {
        dispatch({ type: 'SONGS_ERROR' });
      },
    );

    return () => {
      unsubSongs();
    };
    // Re-run only when the authenticated UID changes (login / logout).
  }, [state.userProfile?.uid, state.userDocStatus]);

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <GlobalStateContext.Provider value={state}>
      <GlobalStateDispatchContext.Provider value={dispatch}>
        {children}
      </GlobalStateDispatchContext.Provider>
    </GlobalStateContext.Provider>
  );
}
