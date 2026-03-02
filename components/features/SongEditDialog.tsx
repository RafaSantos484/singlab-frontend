'use client';

import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  TextField,
  CircularProgress,
  Box,
  Alert,
} from '@mui/material';
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';

import { type Song } from '@/lib/api/types';
import { type UploadSongInput } from '@/lib/api/songs';
import { songsApi } from '@/lib/api';
import { ApiError } from '@/lib/api/types';
import { validateSongMetadata } from '@/lib/api/song-creation';

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface SongEditDialogProps {
  open: boolean;
  onClose: () => void;
  song: Song;
}

/**
 * Dialog for editing an existing song's metadata.
 *
 * Features:
 * - Pre-filled text fields for title and author from existing song data
 * - Real-time validation for title and author
 * - Loading and error states for updates
 * - Accessible keyboard navigation (ESC to close, TAB order)
 * - No file input (audio files cannot be modified)
 *
 * Workflow: Dialog opens with pre-filled data → user edits title/author →
 * form submission → success closes dialog and updates are reflected via
 * Firestore real-time listener in the global state.
 */
export function SongEditDialog({
  open,
  onClose,
  song,
}: SongEditDialogProps): React.ReactElement {
  const t = useTranslations('SongEdit');
  const tV = useTranslations('Validation');

  // Form state
  const [title, setTitle] = useState('');
  const [author, setAuthor] = useState('');

  // UI state
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{
    title?: string;
    author?: string;
  }>({});

  // Pre-fill form with existing song data when dialog opens
  useEffect(() => {
    if (open) {
      setTitle(song.title);
      setAuthor(song.author);
      setError(null);
      setFieldErrors({});
    }
  }, [open, song.title, song.author]);

  // -------------------------------------------------------------------------
  // Event handlers
  // -------------------------------------------------------------------------

  /**
   * Handles form submission.
   * Validates all fields, updates the song via API, and handles the response.
   */
  async function handleSubmit(): Promise<void> {
    // Clear previous errors
    setError(null);
    setFieldErrors({});

    const trimmedTitle = title.trim();
    const trimmedAuthor = author.trim();

    // Validate metadata using shared rules to keep create/edit consistent
    const validationErrors = validateSongMetadata(trimmedTitle, trimmedAuthor);
    if (validationErrors) {
      setFieldErrors(validationErrors);
      return;
    }

    // Check if anything actually changed
    if (trimmedTitle === song.title && trimmedAuthor === song.author) {
      // No changes made, just close the dialog
      onClose();
      return;
    }

    // Prepare update payload (only include changed fields)
    const updates: Partial<UploadSongInput> = {};
    if (trimmedTitle !== song.title) {
      updates.title = trimmedTitle;
    }
    if (trimmedAuthor !== song.author) {
      updates.author = trimmedAuthor;
    }

    // Attempt update
    setIsLoading(true);
    try {
      await songsApi.updateSong(song.id, updates);

      // Success — close dialog (global state will update via Firestore listener)
      onClose();
    } catch (err) {
      // Handle different error types
      if (err instanceof ApiError) {
        setError(
          t('errors.updateFailed', {
            message: err.message,
            statusCode: err.statusCode,
          }),
        );
      } else {
        setError(t('errors.unexpected'));
      }
    } finally {
      setIsLoading(false);
    }
  }

  /**
   * Wraps handleSubmit as a form onSubmit handler (prevents page reload).
   */
  function handleFormSubmit(e: React.FormEvent<HTMLFormElement>): void {
    e.preventDefault();
    void handleSubmit();
  }

  /**
   * Handles dialog close.
   * Resets form state for the next open.
   */
  function handleDialogClose(): void {
    if (!isLoading) {
      setTitle('');
      setAuthor('');
      setError(null);
      setFieldErrors({});
      onClose();
    }
  }

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <Dialog
      open={open}
      onClose={handleDialogClose}
      maxWidth="sm"
      fullWidth
      PaperProps={{
        sx: {
          backgroundColor: 'rgb(23, 12, 35)', // brand-950
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
      <Box component="form" onSubmit={handleFormSubmit}>
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

      <DialogContent sx={{ pt: 3, pb: 2 }}>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          {/* Error alert */}
          {error && (
            <Alert
              severity="error"
              sx={{
                backgroundColor: 'rgba(239, 68, 68, 0.1)',
                color: '#fca5a5',
                border: '1px solid rgba(239, 68, 68, 0.3)',
                '& .MuiAlert-icon': {
                  color: '#fca5a5',
                },
              }}
            >
              {error}
            </Alert>
          )}

          {/* Helper text */}
          <Alert
            severity="info"
            sx={{
              backgroundColor: 'rgba(129, 140, 248, 0.1)',
              color: '#c7d2fe',
              border: '1px solid rgba(129, 140, 248, 0.3)',
              '& .MuiAlert-icon': {
                color: '#c7d2fe',
              },
            }}
          >
            {t('infoMessage')}
          </Alert>

          {/* Title field */}
          <TextField
            label={t('titleLabel')}
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
              // Clear error when user starts typing
              if (fieldErrors.title) {
                setFieldErrors((prev) => ({ ...prev, title: undefined }));
              }
            }}
            error={!!fieldErrors.title}
            helperText={
              fieldErrors.title
                ? tV(fieldErrors.title as Parameters<typeof tV>[0])
                : undefined
            }
            fullWidth
            disabled={isLoading}
            placeholder={t('titlePlaceholder')}
            inputProps={{
              maxLength: 255,
            }}
            sx={{
              '& .MuiOutlinedInput-root': {
                color: 'rgb(243, 232, 255)',
                borderColor: 'rgba(168, 85, 247, 0.3)',
                '&:hover fieldset': {
                  borderColor: 'rgba(168, 85, 247, 0.6)',
                },
                '&.Mui-focused fieldset': {
                  borderColor: 'rgba(168, 85, 247, 1)',
                },
              },
              '& .MuiInputBase-input::placeholder': {
                color: 'rgba(243, 232, 255, 0.5)',
                opacity: 1,
              },
              '& .MuiInputLabel-root': {
                color: 'rgba(243, 232, 255, 0.7)',
                '&.Mui-focused': {
                  color: 'rgba(168, 85, 247, 1)',
                },
              },
              '& .MuiFormHelperText-root': {
                color: 'rgba(252, 165, 165, 1)',
              },
            }}
          />

          {/* Author field */}
          <TextField
            label={t('authorLabel')}
            value={author}
            onChange={(e) => {
              setAuthor(e.target.value);
              if (fieldErrors.author) {
                setFieldErrors((prev) => ({ ...prev, author: undefined }));
              }
            }}
            error={!!fieldErrors.author}
            helperText={
              fieldErrors.author
                ? tV(fieldErrors.author as Parameters<typeof tV>[0])
                : undefined
            }
            fullWidth
            disabled={isLoading}
            placeholder={t('authorPlaceholder')}
            inputProps={{
              maxLength: 255,
            }}
            sx={{
              '& .MuiOutlinedInput-root': {
                color: 'rgb(243, 232, 255)',
                borderColor: 'rgba(168, 85, 247, 0.3)',
                '&:hover fieldset': {
                  borderColor: 'rgba(168, 85, 247, 0.6)',
                },
                '&.Mui-focused fieldset': {
                  borderColor: 'rgba(168, 85, 247, 1)',
                },
              },
              '& .MuiInputBase-input::placeholder': {
                color: 'rgba(243, 232, 255, 0.5)',
                opacity: 1,
              },
              '& .MuiInputLabel-root': {
                color: 'rgba(243, 232, 255, 0.7)',
                '&.Mui-focused': {
                  color: 'rgba(168, 85, 247, 1)',
                },
              },
              '& .MuiFormHelperText-root': {
                color: 'rgba(252, 165, 165, 1)',
              },
            }}
          />
        </Box>
      </DialogContent>

      <DialogActions
        sx={{
          gap: 1,
          p: 2,
          borderTop: '1px solid rgba(168, 85, 247, 0.2)',
        }}
      >
        <Button
          onClick={handleDialogClose}
          disabled={isLoading}
          sx={{
            color: 'rgba(243, 232, 255, 0.7)',
            '&:hover': {
              backgroundColor: 'rgba(168, 85, 247, 0.1)',
            },
          }}
        >
          {t('cancelButton')}
        </Button>

        <Button
          type="submit"
          disabled={isLoading || !title.trim() || !author.trim()}
          variant="contained"
          sx={{
            background: 'linear-gradient(135deg, #a78bfa 0%, #c4b5fd 100%)',
            color: '#1a0e2e',
            fontWeight: 600,
            textTransform: 'none',
            fontSize: '0.95rem',
            '&:hover': {
              background: 'linear-gradient(135deg, #b8a3e0 0%, #d4c4ff 100%)',
            },
            '&.Mui-disabled': {
              background: 'rgba(168, 85, 247, 0.3)',
              color: 'rgba(243, 232, 255, 0.5)',
            },
          }}
        >
          {isLoading ? (
            <>
              <CircularProgress size={20} sx={{ mr: 1, color: '#1a0e2e' }} />
              {t('savingButton')}
            </>
          ) : (
            t('saveButton')
          )}
        </Button>
      </DialogActions>
      </Box>
    </Dialog>
  );
}
