'use client';

import { type FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthGuard } from '@/lib/hooks/useAuthGuard';
import { signIn } from '@/lib/firebase';
import { type FirebaseError } from 'firebase/app';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getFirebaseErrorMessage(error: FirebaseError): string {
  switch (error.code) {
    case 'auth/invalid-credential':
    case 'auth/user-not-found':
    case 'auth/wrong-password':
      return 'Invalid email or password.';
    case 'auth/user-disabled':
      return 'This account has been disabled.';
    case 'auth/too-many-requests':
      return 'Too many failed attempts. Please try again later.';
    case 'auth/network-request-failed':
      return 'Network error. Check your connection and try again.';
    default:
      return 'An unexpected error occurred. Please try again.';
  }
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function LoginPage(): React.ReactElement | null {
  const isLoading = useAuthGuard('public');
  const router = useRouter();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      await signIn(email, password);
      router.replace('/dashboard');
    } catch (err) {
      const firebaseError = err as FirebaseError;
      setError(getFirebaseErrorMessage(firebaseError));
    } finally {
      setSubmitting(false);
    }
  }

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-950">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-zinc-600 border-t-white" />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-950 px-4">
      <div className="w-full max-w-sm rounded-2xl border border-zinc-800 bg-zinc-900 p-8 shadow-xl">
        {/* Header */}
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold tracking-tight text-white">
            SingLab
          </h1>
          <p className="mt-2 text-sm text-zinc-400">
            Sign in to your account
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
          {/* Email */}
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="email"
              className="text-sm font-medium text-zinc-300"
            >
              Email
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={submitting}
              placeholder="you@example.com"
              className="rounded-lg border border-zinc-700 bg-zinc-800 px-3.5 py-2.5 text-sm text-white placeholder-zinc-500 outline-none transition focus:border-white focus:ring-2 focus:ring-white/10 disabled:opacity-50"
            />
          </div>

          {/* Password */}
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="password"
              className="text-sm font-medium text-zinc-300"
            >
              Password
            </label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={submitting}
              placeholder="••••••••"
              className="rounded-lg border border-zinc-700 bg-zinc-800 px-3.5 py-2.5 text-sm text-white placeholder-zinc-500 outline-none transition focus:border-white focus:ring-2 focus:ring-white/10 disabled:opacity-50"
            />
          </div>

          {/* Error message */}
          {error !== null && (
            <p
              role="alert"
              className="rounded-lg border border-red-500/30 bg-red-500/10 px-3.5 py-2.5 text-sm text-red-400"
            >
              {error}
            </p>
          )}

          {/* Submit */}
          <button
            type="submit"
            disabled={submitting || !email || !password}
            className="mt-2 flex items-center justify-center rounded-lg bg-white px-4 py-2.5 text-sm font-semibold text-zinc-900 transition hover:bg-zinc-100 focus:outline-none focus:ring-2 focus:ring-white/50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? (
              <>
                <span className="mr-2 inline-block h-4 w-4 animate-spin rounded-full border-2 border-zinc-400 border-t-zinc-900" />
                Signing in…
              </>
            ) : (
              'Sign in'
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
