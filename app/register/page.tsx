'use client';

import { type FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuthGuard } from '@/lib/hooks/useAuthGuard';
import { initiateEmailVerification } from '@/lib/firebase';
import { usersApi, ApiError } from '@/lib/api';
import { SingLabLogo } from '@/components/ui/SingLabLogo';
import { WaveformDecoration } from '@/components/ui/WaveformDecoration';
import { SpectrumDecoration } from '@/components/ui/SpectrumDecoration';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.statusCode === 409) {
      return 'This email address is already in use.';
    }
    if (error.statusCode === 400) {
      return error.message;
    }
    return 'An unexpected error occurred. Please try again.';
  }
  return 'An unexpected error occurred. Please try again.';
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function RegisterPage(): React.ReactElement | null {
  const isLoading = useAuthGuard('public');
  const router = useRouter();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const passwordMismatch =
    confirmPassword.length > 0 && password !== confirmPassword;

  const isFormValid =
    name.trim().length > 0 &&
    email.length > 0 &&
    password.length > 0 &&
    password === confirmPassword;

  async function handleSubmit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    if (!isFormValid) return;

    setError(null);
    setSubmitting(true);

    try {
      // 1. Create the user via singlab-api (Firebase Auth + Firestore).
      await usersApi.createUser({ name: name.trim(), email, password });

      // 2. Sign in temporarily to send the verification email, then sign out.
      await initiateEmailVerification(email, password);

      // 3. Store registration flag in sessionStorage so the login page can
      //    display the confirmation toast regardless of auth state timing.
      sessionStorage.setItem('emailVerificationSent', 'true');

      // 4. Redirect to login.
      router.replace('/login');
    } catch (err) {
      setError(getErrorMessage(err));
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
        <div className="absolute left-1/2 top-[-10%] h-[70vh] w-[90vw] max-w-3xl -translate-x-1/2 rounded-full bg-accent-500/10 blur-[120px]" />
        <div className="absolute left-[-5%] top-1/3 h-[40vh] w-[40vw] max-w-sm rounded-full bg-brand-300/8 blur-[100px]" />
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

      {/* ── Register card ────────────────────────────────────────────── */}
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
                Create your account
              </p>
            </div>
          </div>

          {/* Form */}
          <form
            onSubmit={handleSubmit}
            className="flex flex-col gap-4"
            noValidate
          >
            {/* Full Name */}
            <div className="flex flex-col gap-1.5">
              <label
                htmlFor="name"
                className="text-sm font-medium text-brand-100/95"
              >
                Full Name
              </label>
              <input
                id="name"
                type="text"
                autoComplete="name"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={submitting}
                placeholder="Jane Doe"
                className="rounded-lg border border-brand-500/60 bg-brand-800/60 px-3.5 py-2.5 text-sm text-white placeholder-brand-100/25 outline-none transition focus:border-brand-300 focus:ring-2 focus:ring-brand-300/20 disabled:opacity-50"
              />
            </div>

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
              <label
                htmlFor="password"
                className="text-sm font-medium text-brand-100/95"
              >
                Password
              </label>
              <input
                id="password"
                type="password"
                autoComplete="new-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={submitting}
                placeholder="••••••••"
                className="rounded-lg border border-brand-500/60 bg-brand-800/60 px-3.5 py-2.5 text-sm text-white placeholder-brand-100/25 outline-none transition focus:border-brand-300 focus:ring-2 focus:ring-brand-300/20 disabled:opacity-50"
              />
            </div>

            {/* Confirm Password */}
            <div className="flex flex-col gap-1.5">
              <label
                htmlFor="confirm-password"
                className="text-sm font-medium text-brand-100/95"
              >
                Confirm Password
              </label>
              <input
                id="confirm-password"
                type="password"
                autoComplete="new-password"
                required
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                disabled={submitting}
                placeholder="••••••••"
                aria-describedby={
                  passwordMismatch ? 'password-mismatch' : undefined
                }
                className={[
                  'rounded-lg border bg-brand-800/60 px-3.5 py-2.5 text-sm text-white placeholder-brand-100/25 outline-none transition focus:ring-2 disabled:opacity-50',
                  passwordMismatch
                    ? 'border-red-500/60 focus:border-red-400 focus:ring-red-400/20'
                    : 'border-brand-500/60 focus:border-brand-300 focus:ring-brand-300/20',
                ].join(' ')}
              />
              {passwordMismatch && (
                <p
                  id="password-mismatch"
                  role="alert"
                  className="text-xs text-red-400"
                >
                  Passwords do not match.
                </p>
              )}
            </div>

            {/* Firebase error message */}
            {error !== null && (
              <p
                role="alert"
                className="rounded-lg border border-red-500/30 bg-red-500/10 px-3.5 py-2.5 text-sm text-red-400"
              >
                {error}
              </p>
            )}

            {/* Primary action — Create account */}
            <button
              type="submit"
              disabled={submitting || !isFormValid}
              className="mt-2 flex cursor-pointer items-center justify-center rounded-lg bg-gradient-to-r from-accent-500 to-brand-300 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-brand-300/20 transition hover:from-accent-600 hover:to-brand-400 hover:shadow-brand-300/30 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-300/60 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting ? (
                <>
                  <span className="mr-2 inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                  Creating account…
                </>
              ) : (
                'Create account'
              )}
            </button>
          </form>

          {/* Divider */}
          <div className="my-6 flex items-center gap-3" aria-hidden="true">
            <div className="h-px flex-1 bg-gradient-to-r from-transparent via-brand-500/50 to-transparent" />
            <span className="text-xs text-brand-100/55">or</span>
            <div className="h-px flex-1 bg-gradient-to-r from-transparent via-brand-500/50 to-transparent" />
          </div>

          {/* Secondary action — Back to sign in */}
          <Link
            href="/login"
            className="flex w-full cursor-pointer items-center justify-center rounded-lg border border-brand-300/30 bg-transparent px-4 py-2.5 text-sm font-semibold text-brand-100/85 transition hover:border-brand-300/60 hover:bg-brand-300/10 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-300/40"
          >
            Already have an account? Sign in
          </Link>
        </div>
      </div>
    </div>
  );
}
