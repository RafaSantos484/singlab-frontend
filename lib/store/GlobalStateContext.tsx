'use client';

import { createContext, useContext, type Dispatch } from 'react';
import { initialState, type GlobalStateAction } from './reducer';
import type { GlobalState } from './types';

/**
 * React context that holds the application global state.
 *
 * Do not consume this context directly — use the `useGlobalState` hook instead.
 */
export const GlobalStateContext = createContext<GlobalState>(initialState);

/**
 * React context for the dispatch function.
 *
 * Do not consume this context directly — use the `useGlobalStateDispatch` hook instead.
 */
export const GlobalStateDispatchContext = createContext<
  Dispatch<GlobalStateAction>
>(() => {
  throw new Error(
    'useGlobalStateDispatch must be used within GlobalStateProvider',
  );
});

// ---------------------------------------------------------------------------
// Consumer hooks
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

/**
 * Returns the dispatch function for updating global state.
 *
 * Must be called from a component that is a descendant of `GlobalStateProvider`.
 *
 * @example
 * ```tsx
 * const dispatch = useGlobalStateDispatch();
 * dispatch({ type: 'PLAYER_LOAD_SONG', payload: songId });
 * ```
 */
export function useGlobalStateDispatch(): Dispatch<GlobalStateAction> {
  return useContext(GlobalStateDispatchContext);
}
