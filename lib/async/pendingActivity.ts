/**
 * Pending activity tracker for preventing navigation during critical operations.
 *
 * This module provides a simple subscription-based counter that tracks ongoing
 * async operations (e.g., file uploads). The `usePendingNavigationGuard` hook
 * uses this to warn users before they leave the page during active uploads,
 * preventing accidental data loss.
 *
 * **Usage:**
 * ```ts
 * const finish = startPendingActivity();
 * try {
 *   await uploadFile();
 * } finally {
 *   finish();
 * }
 * ```
 *
 * Or use the helper for promise-based operations:
 * ```ts
 * await withPendingActivity(async () => {
 *   await uploadFile();
 * });
 * ```
 *
 * Components can subscribe to activity changes via `subscribePendingActivity`
 * or access the current count via `getPendingActivityCount`.
 */

'use client';

type Listener = () => void;

let pendingCount = 0;
const listeners = new Set<Listener>();

function notify(): void {
  listeners.forEach((listener) => listener());
}

/**
 * Subscribes to pending activity count changes.
 *
 * @param listener - Callback invoked whenever the pending count changes.
 * @returns Unsubscribe function.
 */
export function subscribePendingActivity(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Returns the current number of pending activities.
 *
 * @returns Number of active operations tracked.
 */
export function getPendingActivityCount(): number {
  return pendingCount;
}

/**
 * Marks the start of a pending activity.
 *
 * @returns A finish function to call when the activity completes.
 *
 * @example
 * ```ts
 * const finish = startPendingActivity();
 * try {
 *   await uploadFile();
 * } finally {
 *   finish(); // Always call finish, even on error
 * }
 * ```
 */
export function startPendingActivity(): () => void {
  pendingCount += 1;
  notify();

  let finished = false;

  return () => {
    if (finished) {
      return;
    }
    finished = true;
    pendingCount = Math.max(0, pendingCount - 1);
    notify();
  };
}

/**
 * Wraps an async operation with automatic pending activity tracking.
 *
 * Increments the pending count at the start and decrements it when the
 * operation completes (success or error). Ensures the counter is always
 * decremented via finally block.
 *
 * @param operation - Async function to execute.
 * @returns Promise resolving to the operation's result.
 *
 * @example
 * ```ts
 * await withPendingActivity(async () => {
 *   await uploadFile();
 * });
 * ```
 */
export async function withPendingActivity<T>(
  operation: () => Promise<T>,
): Promise<T> {
  const finish = startPendingActivity();
  try {
    return await operation();
  } finally {
    finish();
  }
}
