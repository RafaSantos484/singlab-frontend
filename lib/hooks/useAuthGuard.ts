'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useGlobalState } from '@/lib/store';

/**
 * Target audience for a route.
 * - `'public'`  — only for unauthenticated users (e.g. login).
 * - `'private'` — only for authenticated users (e.g. dashboard).
 */
export type RouteTarget = 'public' | 'private';

/**
 * Protects a route based on the current auth status.
 *
 * - `target: 'private'` — redirects unauthenticated users to `/login`.
 * - `target: 'public'`  — redirects authenticated users to `/dashboard`.
 *
 * @returns `true` while Firebase Auth is still initialising (use to show a
 *   loading indicator and avoid rendering protected content prematurely).
 *
 * @example
 * ```tsx
 * export default function DashboardPage() {
 *   const isLoading = useAuthGuard('private');
 *   if (isLoading) return <LoadingSpinner />;
 *   // ...
 * }
 * ```
 */
export function useAuthGuard(target: RouteTarget): boolean {
  const { authStatus } = useGlobalState();
  const router = useRouter();

  useEffect(() => {
    if (authStatus === 'loading') return;

    if (target === 'private' && authStatus === 'unauthenticated') {
      router.replace('/login');
    } else if (target === 'public' && authStatus === 'authenticated') {
      router.replace('/dashboard');
    }
  }, [authStatus, target, router]);

  return authStatus === 'loading';
}
