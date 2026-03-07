'use client';

import { type FormEvent, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Stack,
  TextField,
} from '@mui/material';
import { type FirebaseError } from 'firebase/app';
import { useTranslations } from 'next-intl';

import { AuthLayout } from '@/components/layout';
import { sendPasswordReset } from '@/lib/firebase';
import { useAuthGuard } from '@/lib/hooks/useAuthGuard';
import { Link } from '@/lib/i18n/navigation';
import { validateForgotPassword } from '@/lib/validation/forgot-password';

function getErrorKey(error: unknown): string {
  const firebaseError = error as FirebaseError;

  switch (firebaseError.code) {
    case 'auth/invalid-email':
      return 'errors.invalidEmail';
    case 'auth/too-many-requests':
      return 'errors.tooManyRequests';
    case 'auth/network-request-failed':
      return 'errors.networkError';
    default:
      return 'errors.unexpected';
  }
}

export default function ForgotPasswordPage(): React.ReactElement | null {
  const t = useTranslations('Auth.forgotPassword');
  const tV = useTranslations('Validation');
  const isLoading = useAuthGuard('public');

  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [isSuccess, setIsSuccess] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const isFormValid =
    email.length > 0 && Object.keys(fieldErrors).length === 0;

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    setError(null);
    setFieldErrors({});

    const validation = validateForgotPassword({ email });

    if (!validation.success) {
      setFieldErrors(validation.errors);
      return;
    }

    if (!isFormValid) {
      return;
    }

    setSubmitting(true);

    try {
      await sendPasswordReset(email);
      setIsSuccess(true);
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
          <TextField
            id="email"
            label={t('emailLabel')}
            type="email"
            autoComplete="email"
            required
            fullWidth
            value={email}
            onChange={(event) => {
              setEmail(event.target.value);
              if (isSuccess) {
                setIsSuccess(false);
              }
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
            inputProps={{ 'aria-label': t('emailAriaLabel') }}
          />

          {isSuccess && <Alert severity="success">{t('successMessage')}</Alert>}

          {error !== null && (
            <Alert severity="error" role="alert">
              {t(error as Parameters<typeof t>[0])}
            </Alert>
          )}

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

          <Button
            component={Link}
            href="/login"
            variant="outlined"
            fullWidth
            size="large"
          >
            {t('backToSignIn')}
          </Button>
        </Stack>
      </Box>
    </AuthLayout>
  );
}
