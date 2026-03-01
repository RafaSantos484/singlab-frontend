'use client';

import { type FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Box,
  TextField,
  Button,
  Stack,
  Alert,
  CircularProgress,
  Typography,
} from '@mui/material';
import { useAuthGuard } from '@/lib/hooks/useAuthGuard';
import { initiateEmailVerification } from '@/lib/firebase';
import { usersApi, ApiError } from '@/lib/api';
import { validateCreateUser } from '@/lib/validation/create-user';
import { AuthLayout } from '@/components/layout';

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
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  const passwordMismatch =
    confirmPassword.length > 0 && password !== confirmPassword;

  const isFormValid =
    name.trim().length > 0 &&
    email.length > 0 &&
    password.length > 0 &&
    confirmPassword.length > 0 &&
    password === confirmPassword &&
    Object.keys(fieldErrors).length === 0;

  async function handleSubmit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();

    // Clear previous errors
    setError(null);
    setFieldErrors({});

    // Validate form data
    const validation = validateCreateUser({
      name: name.trim(),
      email,
      password,
    });

    if (!validation.success) {
      setFieldErrors(validation.errors);
      return;
    }

    // Check password match
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    if (!isFormValid) return;

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
    <AuthLayout title="SingLab" subtitle="Create your account">
      {/* Form */}
      <Box component="form" onSubmit={handleSubmit} noValidate>
        <Stack spacing={3}>
          {/* Full Name */}
          <TextField
            id="name"
            label="Full Name"
            type="text"
            autoComplete="name"
            required
            fullWidth
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              // Clear field error when user starts typing
              if (fieldErrors.name) {
                setFieldErrors((prev) => {
                  const next = { ...prev };
                  delete next.name;
                  return next;
                });
              }
            }}
            disabled={submitting}
            placeholder="Jane Doe"
            error={!!fieldErrors.name}
            helperText={fieldErrors.name}
            inputProps={{
              'aria-label': 'Full name',
            }}
          />

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
          <TextField
            id="password"
            label="Password"
            type="password"
            autoComplete="new-password"
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

          {/* Confirm Password */}
          <TextField
            id="confirm-password"
            label="Confirm Password"
            type="password"
            autoComplete="new-password"
            required
            fullWidth
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            disabled={submitting}
            placeholder="••••••••"
            error={passwordMismatch}
            helperText={passwordMismatch ? 'Passwords do not match.' : ''}
            inputProps={{
              'aria-label': 'Confirm password',
            }}
          />

          {/* API Error message */}
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
            {submitting ? 'Creating account…' : 'Create account'}
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

        {/* Secondary action — Back to sign in */}
        <Button
          component={Link}
          href="/login"
          variant="outlined"
          fullWidth
          size="large"
        >
          Already have an account? Sign in
        </Button>
      </Box>
    </AuthLayout>
  );
}
