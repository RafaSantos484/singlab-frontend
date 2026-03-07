'use client';

import { useEffect } from 'react';
import { useRouter } from '@/lib/i18n/navigation';
import { useGlobalState } from '@/lib/store';

/**
 * Target audience for a route.
 * - `'public'`  — only for unauthenticated users (e.g. login).
 * - `'private'` — only for authenticated users with profile doc (e.g. dashboard).
 * - `'profile-setup'` — only for authenticated users missing profile doc.
 */
export type RouteTarget = 'public' | 'private' | 'profile-setup';

/**
 * Protects a route based on the current auth status.
 *
 * - `target: 'private'` — redirects unauthenticated users to `/login` and
 *   users without profile doc to `/complete-profile`.
 * - `target: 'public'`  — redirects authenticated users to either
 *   `/dashboard` or `/complete-profile`.
 * - `target: 'profile-setup'` — redirects unauthenticated users to `/login`
 *   and users with profile doc to `/dashboard`.
 *
 * @returns `true` while access is still being resolved (Auth status and
 *   user profile document existence), so pages can render a loading state and
 *   avoid showing protected content prematurely.
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
  const { authStatus, userDocStatus } = useGlobalState();
  const router = useRouter();

  const isAuthenticated = authStatus === 'authenticated';
  const isUnauthenticated = authStatus === 'unauthenticated';
  const isUserDocKnown =
    userDocStatus === 'exists' || userDocStatus === 'missing';

  const shouldRedirectToLogin =
    (target === 'private' || target === 'profile-setup') && isUnauthenticated;

  const shouldRedirectToDashboard =
    (target === 'public' || target === 'profile-setup') &&
    isAuthenticated &&
    userDocStatus === 'exists';

  const shouldRedirectToProfileSetup =
    (target === 'public' || target === 'private') &&
    isAuthenticated &&
    userDocStatus === 'missing';

  const isResolvingAccess =
    authStatus === 'loading' ||
    (isAuthenticated && !isUserDocKnown) ||
    shouldRedirectToLogin ||
    shouldRedirectToDashboard ||
    shouldRedirectToProfileSetup;

  useEffect(() => {
    if (authStatus === 'loading') return;
    if (isAuthenticated && !isUserDocKnown) return;

    if (shouldRedirectToLogin) {
      router.replace('/login');
    } else if (shouldRedirectToProfileSetup) {
      router.replace('/complete-profile');
    } else if (shouldRedirectToDashboard) {
      router.replace('/dashboard');
    }
  }, [
    authStatus,
    isAuthenticated,
    isUserDocKnown,
    shouldRedirectToDashboard,
    shouldRedirectToLogin,
    shouldRedirectToProfileSetup,
    router,
  ]);

  return isResolvingAccess;
}
