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
import { useTranslations } from 'next-intl';

import { AuthLayout } from '@/components/layout';
import { createUserDoc } from '@/lib/firebase/users';
import { useAuthGuard } from '@/lib/hooks/useAuthGuard';
import { useGlobalState } from '@/lib/store';
import { validateCompleteProfile } from '@/lib/validation/complete-profile';

export default function CompleteProfilePage(): React.ReactElement {
  const t = useTranslations('Auth.completeProfile');
  const tV = useTranslations('Validation');
  const isLoading = useAuthGuard('profile-setup');
  const { userProfile } = useGlobalState();

  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  const email = userProfile?.email ?? '';
  const uid = userProfile?.uid ?? '';

  const isFormValid =
    name.trim().length > 0 &&
    email.length > 0 &&
    uid.length > 0 &&
    Object.keys(fieldErrors).length === 0;

  async function handleSubmit(
    event: FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();

    setError(null);
    setFieldErrors({});

    const validation = validateCompleteProfile({
      email,
      name: name.trim(),
    });

    if (!validation.success) {
      setFieldErrors(validation.errors);
      return;
    }

    if (!isFormValid) {
      return;
    }

    setSubmitting(true);

    try {
      await createUserDoc(uid, name.trim(), email);
    } catch {
      setError('errors.unexpected');
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
            fullWidth
            value={email}
            disabled
            InputProps={{ readOnly: true }}
            inputProps={{ 'aria-label': t('emailAriaLabel') }}
          />

          <TextField
            id="name"
            label={t('nameLabel')}
            type="text"
            autoComplete="name"
            required
            fullWidth
            value={name}
            onChange={(event) => {
              setName(event.target.value);
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
              fieldErrors.name
                ? tV(fieldErrors.name as Parameters<typeof tV>[0])
                : undefined
            }
            inputProps={{ 'aria-label': t('nameAriaLabel') }}
          />

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
        </Stack>
      </Box>
    </AuthLayout>
  );
}
