'use client';

import { useState, useRef } from 'react';
import { useTranslations } from 'next-intl';
import {
  IconButton,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Snackbar,
  Alert,
  Typography,
  Box,
  CircularProgress,
} from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';

import { songsApi } from '@/lib/api';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface SongDeleteButtonProps {
  /** Unique ID of the song to delete. */
  songId: string;

  /** Title of the song (displayed in confirmation dialog). */
  songTitle: string;

  /** Optional size for the IconButton. Defaults to 'medium'. */
  size?: 'small' | 'medium' | 'large';

  /** Optional callback invoked after successful deletion. */
  onDeleted?: (songId: string) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Reusable button for deleting a song with confirmation.
 *
 * Features:
 * - IconButton with Delete icon
 * - Confirmation Dialog with title, description, and action buttons
 * - Loading state on confirm button during deletion
 * - Snackbar notifications for success and error feedback
 * - Full accessibility: aria-labels, initial focus on Cancel, dialog labeling
 * - Proper error handling for 401, 403, 404, and network failures
 *
 * The component handles the full deletion flow but does not manage the song
 * list state directly — it relies on the Firestore real-time listener to
 * automatically update the UI after successful deletion.
 */
export function SongDeleteButton({
  songId,
  songTitle,
  size = 'medium',
  onDeleted,
}: SongDeleteButtonProps): React.ReactElement {
  const t = useTranslations('SongDelete');

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [snackbar, setSnackbar] = useState<{
    open: boolean;
    message: string;
    severity: 'success' | 'error';
  }>({ open: false, message: '', severity: 'success' });

  const cancelButtonRef = useRef<HTMLButtonElement>(null);

  // IDs for accessibility attributes
  const dialogTitleId = `delete-dialog-title-${songId}`;
  const dialogDescId = `delete-dialog-desc-${songId}`;

  /**
   * Opens the confirmation dialog.
   */
  const handleOpenDialog = (): void => {
    setIsDialogOpen(true);
  };

  /**
   * Closes the confirmation dialog without deleting.
   */
  const handleCloseDialog = (): void => {
    setIsDialogOpen(false);
  };

  /**
   * Closes the snackbar notification.
   */
  const handleCloseSnackbar = (): void => {
    setSnackbar((prev) => ({ ...prev, open: false }));
  };

  /**
   * Performs the deletion via the API, handles success/error, and updates UI.
   */
  const handleConfirmDelete = async (): Promise<void> => {
    setIsDeleting(true);

    try {
      await songsApi.deleteSong(songId);

      // Success: close dialog and show success message
      setIsDialogOpen(false);
      setSnackbar({
        open: true,
        message: t('successMessage', { title: songTitle }),
        severity: 'success',
      });

      // Notify parent component if callback provided
      if (onDeleted) {
        onDeleted(songId);
      }
    } catch (error: unknown) {
      // Error handling based on status code
      let errorMessage = t('errors.default');

      // Type guard for ApiError with statusCode property
      if (error && typeof error === 'object' && 'statusCode' in error) {
        const statusCode = (error as { statusCode: number }).statusCode;

        if (statusCode === 401) {
          errorMessage = t('errors.authExpired');
        } else if (statusCode === 403) {
          errorMessage = t('errors.forbidden');
        } else if (statusCode === 404) {
          errorMessage = t('errors.notFound');
        }
      }

      // Show error snackbar (keep dialog open so user can retry)
      setSnackbar({
        open: true,
        message: errorMessage,
        severity: 'error',
      });
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <>
      {/* Delete IconButton */}
      <IconButton
        aria-label={t('ariaLabel')}
        size={size}
        onClick={handleOpenDialog}
        sx={{
          color: 'text.secondary',
          '&:hover': {
            color: 'error.main',
            bgcolor: 'rgba(211, 47, 47, 0.08)',
          },
        }}
      >
        <DeleteIcon fontSize={size === 'small' ? 'small' : 'medium'} />
      </IconButton>

      {/* Confirmation Dialog */}
      <Dialog
        open={isDialogOpen}
        onClose={isDeleting ? undefined : handleCloseDialog}
        maxWidth="xs"
        fullWidth
        aria-labelledby={dialogTitleId}
        aria-describedby={dialogDescId}
      >
        <DialogTitle id={dialogTitleId}>{t('dialogTitle')}</DialogTitle>

        <DialogContent>
          <Box id={dialogDescId}>
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              {t('dialogDescription', { title: songTitle })}
            </Typography>
          </Box>
        </DialogContent>

        <DialogActions sx={{ px: 3, pb: 3 }}>
          <Button
            ref={cancelButtonRef}
            onClick={handleCloseDialog}
            disabled={isDeleting}
            autoFocus
          >
            {t('cancelButton')}
          </Button>
          <Button
            onClick={handleConfirmDelete}
            disabled={isDeleting}
            variant="contained"
            color="error"
            startIcon={isDeleting ? <CircularProgress size={16} /> : undefined}
          >
            {t('deleteButton')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Success/Error Snackbar */}
      <Snackbar
        open={snackbar.open}
        autoHideDuration={6000}
        onClose={handleCloseSnackbar}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert
          onClose={handleCloseSnackbar}
          severity={snackbar.severity}
          sx={{ width: '100%' }}
        >
          {snackbar.message}
        </Alert>
      </Snackbar>
    </>
  );
}
