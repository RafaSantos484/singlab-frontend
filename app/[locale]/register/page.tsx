'use client';

import { type FormEvent, useState } from 'react';
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
import { useTranslations } from 'next-intl';
import { useAuthGuard } from '@/lib/hooks/useAuthGuard';
import { initiateEmailVerification } from '@/lib/firebase';
import { usersApi, ApiError } from '@/lib/api';
import { validateCreateUser } from '@/lib/validation/create-user';
import { AuthLayout } from '@/components/layout';
import { useRouter } from '@/lib/i18n/navigation';
import { usePendingNavigationGuard } from '@/lib/hooks/usePendingNavigationGuard';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getErrorKey(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.statusCode === 409) {
      return 'errors.emailAlreadyInUse';
    }
    if (error.statusCode === 400) {
      return 'errors.unexpected';
    }
    return 'errors.unexpected';
  }
  return 'errors.unexpected';
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function RegisterPage(): React.ReactElement | null {
  const t = useTranslations('Auth.register');
  const tV = useTranslations('Validation');
  const isLoading = useAuthGuard('public');
  const router = useRouter();
  const { confirmNavigationIfPending } = usePendingNavigationGuard();

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

    setError(null);
    setFieldErrors({});

    const validation = validateCreateUser({
      name: name.trim(),
      email,
      password,
    });

    if (!validation.success) {
      setFieldErrors(validation.errors);
      return;
    }

    if (password !== confirmPassword) {
      setError('passwordMismatch');
      return;
    }

    if (!isFormValid) return;

    setSubmitting(true);

    try {
      await usersApi.createUser({ name: name.trim(), email, password });
      await initiateEmailVerification(email, password);
      sessionStorage.setItem('emailVerificationSent', 'true');
      router.replace('/login');
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
      <Box component="form" onSubmit={handleSubmit} noValidate>
        <Stack spacing={3}>
          {/* Full Name */}
          <TextField
            id="name"
            label={t('nameLabel')}
            type="text"
            autoComplete="name"
            required
            fullWidth
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (fieldErrors.name) {
                setFieldErrors((prev) => {
                  const next = { ...prev };
                  delete next.name;
                  return next;
                });
              }
            }}
            disabled={submitting}
            placeholder={t('namePlaceholder')}
            error={!!fieldErrors.name}
            helperText={
              fieldErrors.name ? tV(fieldErrors.name as Parameters<typeof tV>[0]) : undefined
            }
            inputProps={{
              'aria-label': t('nameAriaLabel'),
            }}
          />

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
              fieldErrors.email ? tV(fieldErrors.email as Parameters<typeof tV>[0]) : undefined
            }
            inputProps={{
              'aria-label': t('emailAriaLabel'),
            }}
          />

          {/* Password */}
          <TextField
            id="password"
            label={t('passwordLabel')}
            type="password"
            autoComplete="new-password"
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

          {/* Confirm Password */}
          <TextField
            id="confirm-password"
            label={t('confirmPasswordLabel')}
            type="password"
            autoComplete="new-password"
            required
            fullWidth
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            disabled={submitting}
            placeholder={t('confirmPasswordPlaceholder')}
            error={passwordMismatch}
            helperText={passwordMismatch ? t('passwordMismatch') : ''}
            inputProps={{
              'aria-label': t('confirmPasswordAriaLabel'),
            }}
          />

          {/* API Error message */}
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

        {/* Back to sign in */}
        <Button
          component={Link}
          href="/login"
          variant="outlined"
          fullWidth
          size="large"
          onClick={(event) => {
            if (!confirmNavigationIfPending()) {
              event.preventDefault();
            }
          }}
        >
          {t('backToSignIn')}
        </Button>
      </Box>
    </AuthLayout>
  );
}
