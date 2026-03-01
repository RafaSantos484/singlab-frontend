'use client';

import { type FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Box,
  TextField,
  Button,
  Stack,
  Snackbar,
  Alert,
  CircularProgress,
  Typography,
} from '@mui/material';
import { useAuthGuard } from '@/lib/hooks/useAuthGuard';
import { signIn, EmailNotVerifiedError } from '@/lib/firebase';
import { type FirebaseError } from 'firebase/app';
import { AuthLayout } from '@/components/layout';
import { validateSignIn } from '@/lib/validation/sign-in';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getErrorMessage(error: unknown): string {
  if (error instanceof EmailNotVerifiedError) {
    return 'Please verify your email before signing in. Check your inbox for the verification link.';
  }
  const firebaseError = error as FirebaseError;
  switch (firebaseError.code) {
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
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [showRegisteredToast, setShowRegisteredToast] = useState(false);

  const isFormValid =
    email.length > 0 &&
    password.length > 0 &&
    Object.keys(fieldErrors).length === 0;

  // Read the registration flag after mount to avoid SSR/hydration mismatches
  // and to be immune to auth-state timing issues.
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const flag = sessionStorage.getItem('emailVerificationSent');
      if (flag === 'true') {
        sessionStorage.removeItem('emailVerificationSent');
        setShowRegisteredToast(true);
      }
    }
  }, []);

  async function handleSubmit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();

    // Clear previous errors
    setError(null);
    setFieldErrors({});

    // Validate form data
    const validation = validateSignIn({ email, password });

    if (!validation.success) {
      setFieldErrors(validation.errors);
      return;
    }

    if (!isFormValid) return;

    setSubmitting(true);

    try {
      await signIn(email, password);
      router.replace('/dashboard');
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  if (isLoading) {
    return (
      <Box
        sx={{
          display: 'flex',
          minHeight: '100vh',
          alignItems: 'center',
          justifyContent: 'center',
          bgcolor: 'background.default',
        }}
      >
        <CircularProgress size={32} />
      </Box>
    );
  }

  return (
    <AuthLayout title="SingLab" subtitle="Sign in to your account">
      {/* Registration success snackbar */}
      <Snackbar
        open={showRegisteredToast}
        autoHideDuration={10000}
        onClose={() => setShowRegisteredToast(false)}
        anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
      >
        <Alert
          onClose={() => setShowRegisteredToast(false)}
          severity="info"
          variant="filled"
          sx={{ width: '100%' }}
        >
          Account created! Check your inbox and verify your email address before
          signing in.
        </Alert>
      </Snackbar>

      {/* Form */}
      <Box component="form" onSubmit={handleSubmit} noValidate>
        <Stack spacing={3}>
          {/* Email */}
          <TextField
            id="email"
            label="Email"
            type="email"
            autoComplete="email"
            required
            fullWidth
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              // Clear field error when user starts typing
              if (fieldErrors.email) {
                setFieldErrors((prev) => {
                  const next = { ...prev };
                  delete next.email;
                  return next;
                });
              }
            }}
            disabled={submitting}
            placeholder="you@example.com"
            error={!!fieldErrors.email}
            helperText={fieldErrors.email}
            inputProps={{
              'aria-label': 'Email address',
            }}
          />

          {/* Password */}
          <Box>
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                mb: 1,
              }}
            >
              <Typography
                component="label"
                htmlFor="password"
                variant="body2"
                sx={{
                  fontWeight: 600,
                  color: 'text.primary',
                }}
              >
                Password
              </Typography>
              <Button
                component="button"
                type="button"
                onClick={() => {
                  /* TODO: navigate to /forgot-password */
                }}
                sx={{
                  fontSize: '0.75rem',
                  color: 'secondary.light',
                  textTransform: 'none',
                  p: 0,
                  minWidth: 'auto',
                  '&:hover': {
                    backgroundColor: 'transparent',
                    color: 'secondary.main',
                    textDecoration: 'underline',
                  },
                }}
              >
                Forgot password?
              </Button>
            </Box>
            <TextField
              id="password"
              type="password"
              autoComplete="current-password"
              required
              fullWidth
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                // Clear field error when user starts typing
                if (fieldErrors.password) {
                  setFieldErrors((prev) => {
                    const next = { ...prev };
                    delete next.password;
                    return next;
                  });
                }
              }}
              disabled={submitting}
              placeholder="••••••••"
              error={!!fieldErrors.password}
              helperText={fieldErrors.password}
              inputProps={{
                'aria-label': 'Password',
              }}
            />
          </Box>

          {/* Error message */}
          {error !== null && (
            <Alert severity="error" role="alert">
              {error}
            </Alert>
          )}

          {/* Submit button */}
          <Button
            type="submit"
            variant="contained"
            fullWidth
            disabled={submitting || !isFormValid}
            size="large"
            sx={{ mt: 1 }}
            startIcon={
              submitting ? <CircularProgress size={16} color="inherit" /> : null
            }
          >
            {submitting ? 'Signing in…' : 'Sign in'}
          </Button>
        </Stack>

        {/* Divider */}
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 2,
            my: 4,
          }}
          aria-hidden="true"
        >
          <Box
            sx={{
              flex: 1,
              height: '1px',
              background:
                'linear-gradient(to right, transparent, rgba(124, 58, 237, 0.5), transparent)',
            }}
          />
          <Typography variant="body2" sx={{ color: 'text.disabled' }}>
            or
          </Typography>
          <Box
            sx={{
              flex: 1,
              height: '1px',
              background:
                'linear-gradient(to right, transparent, rgba(124, 58, 237, 0.5), transparent)',
            }}
          />
        </Box>

        {/* Secondary action — Create new account */}
        <Button
          component={Link}
          href="/register"
          variant="outlined"
          fullWidth
          size="large"
        >
          Create new account
        </Button>
      </Box>
    </AuthLayout>
  );
}
