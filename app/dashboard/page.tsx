'use client';

import { useAuthGuard } from '@/lib/hooks/useAuthGuard';
import { useGlobalState } from '@/lib/store';
import { signOut } from '@/lib/firebase';
import { useState } from 'react';

export default function DashboardPage(): React.ReactElement | null {
  const isLoading = useAuthGuard('private');
  const { userProfile, songs, songsStatus } = useGlobalState();
  const [signingOut, setSigningOut] = useState(false);

  async function handleSignOut(): Promise<void> {
    setSigningOut(true);
    try {
      await signOut();
    } finally {
      setSigningOut(false);
    }
  }

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-950">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-zinc-600 border-t-white" />
      </div>
    );
  }

  const user = userProfile?.auth;

  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      {/* Top bar */}
      <header className="border-b border-zinc-800 px-6 py-4">
        <div className="mx-auto flex max-w-5xl items-center justify-between">
          <h1 className="text-lg font-bold tracking-tight">SingLab</h1>

          <div className="flex items-center gap-4">
            {/* Avatar / email */}
            <div className="flex items-center gap-2">
              {user?.photoURL ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={user.photoURL}
                  alt={user.displayName ?? 'User avatar'}
                  className="h-8 w-8 rounded-full object-cover"
                />
              ) : (
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-zinc-700 text-xs font-semibold uppercase text-zinc-300">
                  {(user?.displayName ?? user?.email ?? 'U')[0]}
                </div>
              )}
              <span className="hidden text-sm text-zinc-400 sm:block">
                {user?.displayName ?? user?.email}
              </span>
            </div>

            {/* Sign out */}
            <button
              onClick={handleSignOut}
              disabled={signingOut}
              className="rounded-lg border border-zinc-700 px-3 py-1.5 text-sm text-zinc-300 transition hover:border-zinc-500 hover:text-white disabled:opacity-50"
            >
              {signingOut ? 'Signing out…' : 'Sign out'}
            </button>
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="mx-auto max-w-5xl px-6 py-10">
        {/* Welcome card */}
        <div className="mb-8 rounded-2xl border border-zinc-800 bg-zinc-900 p-6">
          <p className="text-sm text-zinc-400">Welcome back,</p>
          <h2 className="mt-1 text-2xl font-bold">
            {user?.displayName ?? user?.email ?? 'User'}
          </h2>
        </div>

        {/* Songs section */}
        <section>
          <h3 className="mb-4 text-lg font-semibold">Your songs</h3>

          {songsStatus === 'loading' && (
            <div className="flex items-center gap-2 text-sm text-zinc-400">
              <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-zinc-600 border-t-zinc-300" />
              Loading songs…
            </div>
          )}

          {songsStatus === 'error' && (
            <p className="text-sm text-red-400">
              Failed to load songs. Please refresh the page.
            </p>
          )}

          {(songsStatus === 'ready' || songsStatus === 'idle') &&
            songs.length === 0 && (
              <div className="rounded-xl border border-dashed border-zinc-700 p-10 text-center">
                <p className="text-sm text-zinc-500">
                  No songs yet. Upload your first track to get started.
                </p>
              </div>
            )}

          {songs.length > 0 && (
            <ul className="flex flex-col gap-3">
              {songs.map((song) => (
                <li
                  key={song.id}
                  className="flex items-center justify-between rounded-xl border border-zinc-800 bg-zinc-900 px-5 py-4"
                >
                  <div>
                    <p className="font-medium">{song.title}</p>
                    <p className="text-sm text-zinc-400">{song.author}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}
