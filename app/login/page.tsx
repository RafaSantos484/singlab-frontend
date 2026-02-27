'use client';

import { type FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
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
// Decorative components
// ---------------------------------------------------------------------------

/** App logo — microphone + waveform + spectrum bars in brand gradient. */
function SingLabLogo(): React.ReactElement {
  return (
    <svg
      viewBox="0 0 80 80"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="h-16 w-16"
      aria-hidden="true"
    >
      {/* Outer circle */}
      <circle
        cx="40"
        cy="40"
        r="37"
        stroke="url(#logoGrad)"
        strokeWidth="2.5"
      />

      {/* Waveform — left side */}
      <path
        d="M7 40 Q11 29 15 40 Q19 51 23 40 Q27 29 31 40"
        stroke="url(#logoGrad)"
        strokeWidth="2"
        strokeLinecap="round"
        fill="none"
      />

      {/* Microphone body */}
      <rect
        x="35"
        y="24"
        width="10"
        height="15"
        rx="5"
        stroke="url(#logoGrad)"
        strokeWidth="2"
        fill="none"
      />
      {/* Microphone stand arc */}
      <path
        d="M30 37c0 5.5 4.5 10 10 10s10-4.5 10-10"
        stroke="url(#logoGrad)"
        strokeWidth="2"
        strokeLinecap="round"
        fill="none"
      />
      {/* Stand pole */}
      <line
        x1="40"
        y1="47"
        x2="40"
        y2="54"
        stroke="url(#logoGrad)"
        strokeWidth="2"
        strokeLinecap="round"
      />
      {/* Stand base */}
      <line
        x1="35"
        y1="54"
        x2="45"
        y2="54"
        stroke="url(#logoGrad)"
        strokeWidth="2"
        strokeLinecap="round"
      />

      {/* Spectrum bars — right side */}
      <rect x="54" y="33" width="3" height="11" rx="1.5" fill="url(#logoGrad)" opacity="0.9" />
      <rect x="59" y="27" width="3" height="17" rx="1.5" fill="url(#logoGrad)" opacity="0.8" />
      <rect x="64" y="36" width="3" height="8"  rx="1.5" fill="url(#logoGrad)" opacity="0.7" />
      <rect x="69" y="30" width="3" height="14" rx="1.5" fill="url(#logoGrad)" opacity="0.6" />

      {/* Music note accent */}
      <circle cx="50" cy="50" r="2.5" fill="url(#noteGrad)" />
      <line x1="52.5" y1="50" x2="52.5" y2="44" stroke="url(#noteGrad)" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="52.5" y1="44" x2="56"   y2="45.5" stroke="url(#noteGrad)" strokeWidth="1.5" strokeLinecap="round" />

      <defs>
        <linearGradient
          id="logoGrad"
          x1="0" y1="0" x2="80" y2="80"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0%"   stopColor="#4F46E5" />
          <stop offset="100%" stopColor="#A855F7" />
        </linearGradient>
        <linearGradient
          id="noteGrad"
          x1="0" y1="0" x2="80" y2="80"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0%"   stopColor="#A855F7" />
          <stop offset="100%" stopColor="#EC4899" />
        </linearGradient>
      </defs>
    </svg>
  );
}

/** Continuous audio waveform used as a background decoration. */
function WaveformDecoration({
  className,
}: {
  className?: string;
}): React.ReactElement {
  return (
    <svg
      viewBox="0 0 800 80"
      className={className}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      preserveAspectRatio="none"
    >
      {/* Primary wave */}
      <path
        d="M0 40 Q50 10 100 40 Q150 70 200 40 Q250 10 300 40 Q350 70 400 40
           Q450 10 500 40 Q550 70 600 40 Q650 10 700 40 Q750 70 800 40"
        stroke="url(#waveGrad)"
        strokeWidth="2"
        strokeLinecap="round"
      />
      {/* Secondary wave (offset) */}
      <path
        d="M0 40 Q40 25 80 40 Q120 55 160 40 Q200 25 240 40 Q280 55 320 40
           Q360 25 400 40 Q440 55 480 40 Q520 25 560 40 Q600 55 640 40
           Q680 25 720 40 Q760 55 800 40"
        stroke="url(#waveGrad)"
        strokeWidth="1"
        strokeLinecap="round"
        opacity="0.5"
      />
      <defs>
        <linearGradient
          id="waveGrad"
          x1="0" y1="0" x2="800" y2="0"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0%"   stopColor="#4F46E5" stopOpacity="0.1" />
          <stop offset="50%"  stopColor="#7C3AED" stopOpacity="0.5" />
          <stop offset="100%" stopColor="#A855F7" stopOpacity="0.1" />
        </linearGradient>
      </defs>
    </svg>
  );
}

/** Vertical spectrum bars used as a background decoration. */
function SpectrumDecoration({
  className,
}: {
  className?: string;
}): React.ReactElement {
  const bars = [55, 80, 40, 95, 65, 50, 85, 35, 70, 60, 75, 45] as const;

  return (
    <svg
      viewBox="0 0 204 100"
      className={className}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      {bars.map((h, i) => (
        <rect
          key={i}
          x={i * 17 + 1}
          y={100 - h}
          width={12}
          height={h}
          rx="3"
          fill={`url(#specGrad${i % 3})`}
          opacity={0.15 + (i % 4) * 0.07}
        />
      ))}
      <defs>
        <linearGradient id="specGrad0" x1="0" y1="0" x2="0" y2="100" gradientUnits="userSpaceOnUse">
          <stop offset="0%"   stopColor="#7C3AED" />
          <stop offset="100%" stopColor="#4F46E5" />
        </linearGradient>
        <linearGradient id="specGrad1" x1="0" y1="0" x2="0" y2="100" gradientUnits="userSpaceOnUse">
          <stop offset="0%"   stopColor="#A855F7" />
          <stop offset="100%" stopColor="#7C3AED" />
        </linearGradient>
        <linearGradient id="specGrad2" x1="0" y1="0" x2="0" y2="100" gradientUnits="userSpaceOnUse">
          <stop offset="0%"   stopColor="#60A5FA" />
          <stop offset="100%" stopColor="#4F46E5" />
        </linearGradient>
      </defs>
    </svg>
  );
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
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
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



