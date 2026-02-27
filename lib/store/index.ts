/**
 * @module lib/store
 *
 * Application global state — Firebase Auth + Firestore real-time listeners.
 *
 * ### Setup
 * Wrap the root layout with `GlobalStateProvider`:
 * ```tsx
 * import { GlobalStateProvider } from '@/lib/store';
 *
 * export default function RootLayout({ children }) {
 *   return <GlobalStateProvider>{children}</GlobalStateProvider>;
 * }
 * ```
 *
 * ### Consuming state
 * ```tsx
 * 'use client';
 * import { useGlobalState } from '@/lib/store';
 *
 * export function SongList() {
 *   const { songs, songsStatus, authStatus } = useGlobalState();
 *   // ...
 * }
 * ```
 */

export { GlobalStateProvider } from './GlobalStateProvider';
export { useGlobalState } from './GlobalStateContext';

export type {
  GlobalState,
  AuthStatus,
  LoadStatus,
  AuthUser,
  UserProfile,
  Song,
} from './types';
