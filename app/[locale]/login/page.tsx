'use client';

import { type FormEvent, useEffect, useState } from 'react';
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
import { useTranslations } from 'next-intl';
import { useAuthGuard } from '@/lib/hooks/useAuthGuard';
import { signIn, EmailNotVerifiedError } from '@/lib/firebase';
import { type FirebaseError } from 'firebase/app';
import { AuthLayout } from '@/components/layout';
import { validateSignIn } from '@/lib/validation/sign-in';
import { useRouter } from '@/lib/i18n/navigation';
import { usePendingNavigationGuard } from '@/lib/hooks/usePendingNavigationGuard';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getErrorKey(error: unknown): string {
  if (error instanceof EmailNotVerifiedError) {
    return 'errors.emailNotVerified';
  }
  const firebaseError = error as FirebaseError;
  switch (firebaseError.code) {
    case 'auth/invalid-credential':
    case 'auth/user-not-found':
    case 'auth/wrong-password':
      return 'errors.invalidCredentials';
    case 'auth/user-disabled':
      return 'errors.accountDisabled';
    case 'auth/too-many-requests':
      return 'errors.tooManyRequests';
    case 'auth/network-request-failed':
      return 'errors.networkError';
    default:
      return 'errors.unexpected';
  }
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function LoginPage(): React.ReactElement | null {
  const t = useTranslations('Auth.signIn');
  const tV = useTranslations('Validation');
  const isLoading = useAuthGuard('public');
  const router = useRouter();
  const { confirmNavigationIfPending } = usePendingNavigationGuard();

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

    setError(null);
    setFieldErrors({});

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
      setError(getErrorKey(err));
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
    <AuthLayout title="SingLab" subtitle={t('subtitle')}>
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
          {t('emailVerifiedSuccess')}
        </Alert>
      </Snackbar>

      {/* Form */}
      <Box component="form" onSubmit={handleSubmit} noValidate>
        <Stack spacing={3}>
          {/* Email */}
          <TextField
            id="email"
            label={t('emailLabel')}
            type="email"
            autoComplete="email"
            required
            fullWidth
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              if (fieldErrors.email) {
                setFieldErrors((prev) => {
                  const next = { ...prev };
                  delete next.email;
                  return next;
                });
              }
            }}
            disabled={submitting}
            placeholder={t('emailPlaceholder')}
            error={!!fieldErrors.email}
            helperText={
              fieldErrors.email
                ? tV(fieldErrors.email as Parameters<typeof tV>[0])
                : undefined
            }
            inputProps={{
              'aria-label': t('emailAriaLabel'),
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
                {t('passwordLabel')}
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
                {t('forgotPassword')}
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
                if (fieldErrors.password) {
                  setFieldErrors((prev) => {
                    const next = { ...prev };
                    delete next.password;
                    return next;
                  });
                }
              }}
              disabled={submitting}
              placeholder={t('passwordPlaceholder')}
              error={!!fieldErrors.password}
              helperText={
                fieldErrors.password
                  ? tV(fieldErrors.password as Parameters<typeof tV>[0])
                  : undefined
              }
              inputProps={{
                'aria-label': t('passwordAriaLabel'),
              }}
            />
          </Box>

          {/* Error message */}
          {error !== null && (
            <Alert severity="error" role="alert">
              {t(error as Parameters<typeof t>[0])}
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
            {submitting ? t('submittingButton') : t('submitButton')}
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

        {/* Secondary action */}
        <Button
          component={Link}
          href="/register"
          variant="outlined"
          fullWidth
          size="large"
          onClick={(event) => {
            if (!confirmNavigationIfPending()) {
              event.preventDefault();
            }
          }}
        >
          {t('createAccount')}
        </Button>
      </Box>
    </AuthLayout>
  );
}
