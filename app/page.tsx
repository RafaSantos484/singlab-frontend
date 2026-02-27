'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useGlobalState } from '@/lib/store';

/**
 * Root route — redirects to `/dashboard` when authenticated,
 * or to `/login` when not authenticated.
 */
export default function RootPage(): React.ReactElement {
  const { authStatus } = useGlobalState();
  const router = useRouter();

  useEffect(() => {
    if (authStatus === 'loading') return;

    if (authStatus === 'authenticated') {
      router.replace('/dashboard');
    } else {
      router.replace('/login');
    }
  }, [authStatus, router]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-950">
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-zinc-600 border-t-white" />
    </div>
  );
}
