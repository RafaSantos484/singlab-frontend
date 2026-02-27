'use client';

import { createContext, useContext } from 'react';
import { initialState } from './reducer';
import type { GlobalState } from './types';

/**
 * React context that holds the application global state.
 *
 * Do not consume this context directly — use the `useGlobalState` hook instead.
 */
export const GlobalStateContext = createContext<GlobalState>(initialState);

// ---------------------------------------------------------------------------
// Consumer hook
// ---------------------------------------------------------------------------

/**
 * Returns the current application global state.
 *
 * Must be called from a component that is a descendant of `GlobalStateProvider`.
 *
 * @example
 * ```tsx
 * const { authStatus, userProfile, songs, songsStatus } = useGlobalState();
 * ```
 */
export function useGlobalState(): GlobalState {
  return useContext(GlobalStateContext);
}
