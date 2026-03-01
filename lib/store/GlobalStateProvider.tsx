'use client';

import {
  type User as FirebaseUser,
  onAuthStateChanged,
  signOut as firebaseSignOut,
} from 'firebase/auth';
import {
  collection,
  onSnapshot,
  type DocumentData,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';
import { useEffect, useReducer } from 'react';

import { getFirebaseAuth } from '@/lib/firebase/auth';
import { getFirebaseFirestore } from '@/lib/firebase/firestore';
import type { RawSongInfo, SeparatedSongInfo } from '@/lib/api/types';

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
    displayName: user.displayName!,
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
    createdAt: snap.createTime?.toDate().toISOString() ?? null,
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
 *   User profile data (name, email) comes directly from Auth, not Firestore.
 * - When a user is authenticated, subscribes to a **Firestore real-time
 *   listener** for `/users/{uid}/songs` — the user's song library.
 * - Tears down Firestore listeners automatically on sign-out or unmount.
 *
 * Wrap the root layout (or the highest client boundary) with this component
 * so that all descendants can access state via `useGlobalState()`.
 */
export function GlobalStateProvider({ children }: GlobalStateProviderProps) {
  const [state, dispatch] = useReducer(globalStateReducer, initialState);

  // -------------------------------------------------------------------------
  // 1. Firebase Auth listener
  // -------------------------------------------------------------------------

  useEffect(() => {
    const auth = getFirebaseAuth();

    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (user) {
        if (!user.emailVerified) {
          // Never surface unverified users as authenticated.
          // Sign out silently — the UI will stay (or land) on the public pages.
          void firebaseSignOut(auth);
          dispatch({ type: 'AUTH_UNAUTHENTICATED' });
          return;
        }
        dispatch({ type: 'AUTH_AUTHENTICATED', payload: toAuthUser(user) });
      } else {
        dispatch({ type: 'AUTH_UNAUTHENTICATED' });
      }
    });

    return unsubscribe;
  }, []);

  // -------------------------------------------------------------------------
  // 2. Firestore listener for songs — activated only while a user is authenticated
  // -------------------------------------------------------------------------

  useEffect(() => {
    // uid is the stable key; derived from the auth state set above.
    const uid = state.userProfile?.uid;

    if (!uid) return;

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
  }, [state.userProfile?.uid]);

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
