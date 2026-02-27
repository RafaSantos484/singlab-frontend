'use client';

import { type FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuthGuard } from '@/lib/hooks/useAuthGuard';
import { signIn } from '@/lib/firebase';
import { type FirebaseError } from 'firebase/app';
import { SingLabLogo } from '@/components/ui/SingLabLogo';
import { WaveformDecoration } from '@/components/ui/WaveformDecoration';
import { SpectrumDecoration } from '@/components/ui/SpectrumDecoration';

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
      <div className="flex min-h-screen items-center justify-center bg-brand-950">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-brand-500/40 border-t-brand-200" />
      </div>
    );
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-brand-950 px-4 py-12 sm:px-6 lg:px-8">
      {/* ── Background ambient glows ──────────────────────────────────── */}
      <div
        className="pointer-events-none absolute inset-0 overflow-hidden"
        aria-hidden="true"
      >
        {/* Top-center purple glow */}
        <div className="absolute left-1/2 top-[-10%] h-[70vh] w-[90vw] max-w-3xl -translate-x-1/2 rounded-full bg-accent-500/10 blur-[120px]" />
        {/* Left accent glow */}
        <div className="absolute left-[-5%] top-1/3 h-[40vh] w-[40vw] max-w-sm rounded-full bg-brand-300/8 blur-[100px]" />
        {/* Bottom-right accent glow */}
        <div className="absolute bottom-[-5%] right-[-5%] h-[35vh] w-[35vw] max-w-xs rounded-full bg-brand-200/8 blur-[90px]" />
      </div>

      {/* ── Decorative spectrum bars — top-right (desktop) ───────────── */}
      <div
        className="pointer-events-none absolute right-6 top-6 hidden lg:block"
        aria-hidden="true"
      >
        <SpectrumDecoration className="h-28 w-52 opacity-70" />
      </div>

      {/* ── Decorative spectrum bars — bottom-left (desktop) ─────────── */}
      <div
        className="pointer-events-none absolute bottom-6 left-6 hidden rotate-180 lg:block"
        aria-hidden="true"
      >
        <SpectrumDecoration className="h-20 w-40 opacity-50" />
      </div>

      {/* ── Decorative waveform — bottom edge ────────────────────────── */}
      <div
        className="pointer-events-none absolute bottom-0 left-0 right-0 hidden md:block"
        aria-hidden="true"
      >
        <WaveformDecoration className="w-full" />
      </div>

      {/* ── Login card ───────────────────────────────────────────────── */}
      <div className="relative z-10 w-full max-w-md">
        {/* Glow border layer */}
        <div
          className="absolute -inset-px rounded-2xl bg-gradient-to-br from-accent-500/40 via-brand-300/20 to-brand-200/40 blur-sm"
          aria-hidden="true"
        />

        <div className="relative rounded-2xl border border-brand-500/40 bg-brand-900/75 px-8 py-10 shadow-2xl shadow-brand-300/5 backdrop-blur-2xl sm:px-10">
          {/* Logo + title */}
          <div className="mb-8 flex flex-col items-center gap-4 text-center">
            <SingLabLogo />
            <div>
              <h1 className="bg-gradient-to-r from-accent-300 via-brand-200 to-brand-100 bg-clip-text text-3xl font-bold tracking-tight text-transparent">
                SingLab
              </h1>
              <p className="mt-1.5 text-sm text-brand-100/75">
                Sign in to your account
              </p>
            </div>
          </div>

          {/* Form */}
          <form
            onSubmit={handleSubmit}
            className="flex flex-col gap-4"
            noValidate
          >
            {/* Email */}
            <div className="flex flex-col gap-1.5">
              <label
                htmlFor="email"
                className="text-sm font-medium text-brand-100/95"
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
                className="rounded-lg border border-brand-500/60 bg-brand-800/60 px-3.5 py-2.5 text-sm text-white placeholder-brand-100/25 outline-none transition focus:border-brand-300 focus:ring-2 focus:ring-brand-300/20 disabled:opacity-50"
              />
            </div>

            {/* Password */}
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <label
                  htmlFor="password"
                  className="text-sm font-medium text-brand-100/95"
                >
                  Password
                </label>
                {/* Mock — forgot password */}
                <button
                  type="button"
                  onClick={() => {
                    /* TODO: navigate to /forgot-password */
                  }}
                  className="cursor-pointer text-xs text-accent-300/90 transition hover:text-accent-200 focus:outline-none focus-visible:underline"
                >
                  Forgot password?
                </button>
              </div>
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={submitting}
                placeholder="••••••••"
                className="rounded-lg border border-brand-500/60 bg-brand-800/60 px-3.5 py-2.5 text-sm text-white placeholder-brand-100/25 outline-none transition focus:border-brand-300 focus:ring-2 focus:ring-brand-300/20 disabled:opacity-50"
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

            {/* Primary action — Sign in */}
            <button
              type="submit"
              disabled={submitting || !email || !password}
              className="mt-2 flex cursor-pointer items-center justify-center rounded-lg bg-gradient-to-r from-accent-500 to-brand-300 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-brand-300/20 transition hover:from-accent-600 hover:to-brand-400 hover:shadow-brand-300/30 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-300/60 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting ? (
                <>
                  <span className="mr-2 inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                  Signing in…
                </>
              ) : (
                'Sign in'
              )}
            </button>
          </form>

          {/* Divider */}
          <div className="my-6 flex items-center gap-3" aria-hidden="true">
            <div className="h-px flex-1 bg-gradient-to-r from-transparent via-brand-500/50 to-transparent" />
            <span className="text-xs text-brand-100/55">or</span>
            <div className="h-px flex-1 bg-gradient-to-r from-transparent via-brand-500/50 to-transparent" />
          </div>

          {/* Secondary action — Create new account */}
          <Link
            href="/register"
            className="flex w-full cursor-pointer items-center justify-center rounded-lg border border-brand-300/30 bg-transparent px-4 py-2.5 text-sm font-semibold text-brand-100/85 transition hover:border-brand-300/60 hover:bg-brand-300/10 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-300/40"
          >
            Create new account
          </Link>
        </div>
      </div>
    </div>
  );
}
