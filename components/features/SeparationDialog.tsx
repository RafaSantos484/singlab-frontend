'use client';

import { useRef, useState } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Stack,
  Alert,
  CircularProgress,
} from '@mui/material';
import { useTranslations } from 'next-intl';

import type { Song, SeparationProviderName } from '@/lib/api/types';
import { StemUploadForm, type StemUploadFormRef } from './StemUploadForm';
import { useSeparationStatus } from '@/lib/hooks/useSeparationStatus';
import { getFirebaseAuth } from '@/lib/firebase/auth';
import { useSongRawUrl } from '@/lib/hooks/useSongRawUrl';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SeparationDialogProps {
  open: boolean;
  onClose: () => void;
  onSuccess?: (provider: SeparationProviderName) => void;
  song: Song;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Provider selection dialog for stem separation.
 *
 * Supports two flows:
 * - `poyo`: submits separation request through backend proxy.
 * - `local`: delegates to `StemUploadForm` for manual stem upload.
 *
 * @param open - Whether the dialog is visible.
 * @param onClose - Callback invoked when dialog closes.
 * @param onSuccess - Optional callback after successful provider submission.
 * @param song - Song being processed.
 */
export function SeparationDialog({
  open,
  onClose,
  onSuccess,
  song,
}: SeparationDialogProps): React.ReactElement {
  const t = useTranslations('SeparationDialog');

  // State
  const [provider, setProvider] = useState<SeparationProviderName>('poyo');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Refs
  const stemFormRef = useRef<StemUploadFormRef>(null);

  // Hooks
  const { requestSeparation } = useSeparationStatus(song);
  const { url: rawUrl } = useSongRawUrl(song);
  const auth = getFirebaseAuth();

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  const handleClose = (): void => {
    if (!isSubmitting) {
      setProvider('poyo');
      setError(null);
      onClose();
    }
  };

  const handleSubmit = async (): Promise<void> => {
    setError(null);

    if (provider === 'poyo') {
      await handlePoyoSubmit();
    } else {
      await handleLocalSubmit();
    }
  };

  const handlePoyoSubmit = async (): Promise<void> => {
    if (!rawUrl || !auth.currentUser?.uid) {
      setError('Unable to submit separation request');
      return;
    }

    setError(null);
    setIsSubmitting(true);

    try {
      await requestSeparation('poyo');
      // Call success callback before closing
      onSuccess?.('poyo');
      onClose();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setError(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleLocalSubmit = async (): Promise<void> => {
    setIsSubmitting(true);
    try {
      await stemFormRef.current?.submitStems();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('error.generic'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleLocalSuccess = (): void => {
    setProvider('poyo');
    setError(null);
    onSuccess?.('local');
    onClose();
  };

  if (!open) return <></>;

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      maxWidth="sm"
      fullWidth
      PaperProps={{
        sx: {
          backgroundColor: 'rgb(23, 12, 35)',
          backgroundImage:
            'linear-gradient(135deg, rgba(88, 30, 147, 0.15) 0%, rgba(168, 85, 247, 0.05) 100%)',
        },
      }}
      slotProps={{
        backdrop: {
          sx: {
            backdropFilter: 'blur(4px)',
          },
        },
      }}
    >
      <DialogTitle
        sx={{
          fontSize: '1.5rem',
          fontWeight: 600,
          background: 'linear-gradient(135deg, #a78bfa 0%, #c4b5fd 100%)',
          backgroundClip: 'text',
          textFillColor: 'transparent',
          WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
          color: 'transparent',
          borderBottom: '1px solid rgba(168, 85, 247, 0.2)',
          pb: 2,
        }}
      >
        {t('title')}
      </DialogTitle>

      <DialogContent sx={{ pt: 3 }}>
        <Stack spacing={3}>
          {error && (
            <Alert
              severity="error"
              sx={{
                backgroundColor: 'rgba(239, 68, 68, 0.1)',
                color: '#fca5a5',
                border: '1px solid rgba(239, 68, 68, 0.3)',
                '& .MuiAlert-icon': { color: '#fca5a5' },
              }}
            >
              {error}
            </Alert>
          )}

          <FormControl fullWidth>
            <InputLabel>{t('providerLabel')}</InputLabel>
            <Select
              value={provider}
              label={t('providerLabel')}
              onChange={(e) =>
                setProvider(e.target.value as SeparationProviderName)
              }
              disabled={isSubmitting || stemFormRef.current?.isLoading}
            >
              <MenuItem value="poyo">{t('poyo')}</MenuItem>
              <MenuItem value="local">{t('local')}</MenuItem>
            </Select>
          </FormControl>

          {/* Info message */}
          {provider === 'poyo' && (
            <Alert
              severity="info"
              sx={{
                backgroundColor: 'rgba(129, 140, 248, 0.1)',
                color: '#c7d2fe',
                border: '1px solid rgba(129, 140, 248, 0.3)',
                '& .MuiAlert-icon': { color: '#c7d2fe' },
              }}
            >
              {t('info.poyo')}
            </Alert>
          )}

          {provider === 'local' && (
            <Alert
              severity="info"
              sx={{
                backgroundColor: 'rgba(129, 140, 248, 0.1)',
                color: '#c7d2fe',
                border: '1px solid rgba(129, 140, 248, 0.3)',
                '& .MuiAlert-icon': { color: '#c7d2fe' },
              }}
            >
              {t('info.local')}
            </Alert>
          )}

          {/* Conditional form content */}
          {provider === 'local' && (
            <StemUploadForm
              ref={stemFormRef}
              songId={song.id}
              onSuccess={handleLocalSuccess}
            />
          )}
        </Stack>
      </DialogContent>

      <DialogActions sx={{ p: 2 }}>
        <Button onClick={handleClose} disabled={isSubmitting}>
          {t('cancelButton')}
        </Button>
        <Button
          variant="contained"
          onClick={handleSubmit}
          disabled={isSubmitting}
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1,
          }}
        >
          {isSubmitting && <CircularProgress size={20} />}
          {t('submitButton')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
