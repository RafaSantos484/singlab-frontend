'use client';

import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  TextField,
  CircularProgress,
  FormHelperText,
  Box,
  Typography,
  Alert,
} from '@mui/material';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import { useRef, useState } from 'react';
import jsmediatags from 'jsmediatags';
import { useTranslations } from 'next-intl';

import {
  createSong,
  validateSongMetadata,
  validateSongFile,
  InvalidFileError,
  InvalidFileTypeError,
  FileSizeExceededError,
  StorageUploadError,
  type SongCreationPhase,
} from '@/lib/api/song-creation';
import { ApiError } from '@/lib/api/types';

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface SongCreateDialogProps {
  open: boolean;
  onClose: () => void;
}

/**
 * Dialog for creating a new song by uploading an audio file.
 *
 * Features:
 * - File picker for audio files (with format validation)
 * - Automatic metadata extraction from audio tags (title, artist)
 * - Text fields for title and author with real-time validation
 * - Loading and error states for file upload and metadata processing
 * - Accessible keyboard navigation (ESC to close, TAB order)
 * - Field auto-fill from extracted metadata, with manual override
 *
 * Workflow: User selects file → metadata automatically extracted → fields
 * auto-fill with extracted data (user can edit) → form submission.
 * After successful upload, the dialog closes automatically and the songs
 * list updates via Firestore real-time listener in the global state.
 */
export function SongCreateDialog({
  open,
  onClose,
}: SongCreateDialogProps): React.ReactElement {
  const t = useTranslations('SongCreate');
  const tV = useTranslations('Validation');

  // Form state
  const [title, setTitle] = useState('');
  const [author, setAuthor] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  // UI state
  const [isLoading, setIsLoading] = useState(false);
  const [uploadPhase, setUploadPhase] = useState<SongCreationPhase | null>(
    null,
  );
  const [isExtractingMetadata, setIsExtractingMetadata] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{
    title?: string;
    author?: string;
    file?: string;
  }>({});

  // Refs
  const fileInputRef = useRef<HTMLInputElement>(null);

  // -------------------------------------------------------------------------
  // Event handlers
  // -------------------------------------------------------------------------

  /**
   * Extracts metadata from audio file using jsmediatags.
   * Returns extracted title and artist, or null if extraction fails.
   */
  function extractMetadata(
    file: File,
  ): Promise<{ title: string; artist: string } | null> {
    return new Promise((resolve) => {
      jsmediatags.read(file, {
        onSuccess: (tag) => {
          const title = tag.tags.title?.trim() || '';
          const artist = tag.tags.artist?.trim() || '';

          if (title || artist) {
            resolve({ title, artist });
          } else {
            resolve(null);
          }
        },
        onError: () => {
          resolve(null);
        },
      });
    });
  }

  /**
   * Handles file selection from the file input.
   *
   * Process:
   * 1. Validates file type and size
   * 2. Shows metadata extraction loading state
   * 3. Attempts to extract title and artist from audio tags
   * 4. Auto-fills empty title/author fields with extracted data
   * 5. Disables title/author fields during extraction to signal async operation
   *
   * @param e - Change event from file input element
   */
  async function handleFileSelect(
    e: React.ChangeEvent<HTMLInputElement>,
  ): Promise<void> {
    const file = e.currentTarget.files?.[0];
    const inputElement = e.currentTarget;

    if (!file) {
      setSelectedFile(null);
      setFieldErrors((prev) => ({ ...prev, file: undefined }));
      return;
    }

    try {
      validateSongFile(file);
      setSelectedFile(file);
      setFieldErrors((prev) => ({ ...prev, file: undefined }));
      setError(null);

      // Extract metadata if file is audio
      setIsExtractingMetadata(true);
      const metadata = await extractMetadata(file);

      if (metadata) {
        // Auto-fill fields with extracted metadata
        if (metadata.title && !title) {
          setTitle(metadata.title);
        }
        if (metadata.artist && !author) {
          setAuthor(metadata.artist);
        }
      }

      setIsExtractingMetadata(false);
    } catch (err) {
      // File validation errors carry i18n keys as their message
      const message =
        err instanceof InvalidFileTypeError || err instanceof FileSizeExceededError
          ? (err as InvalidFileError).message
          : 'file.invalid';
      setSelectedFile(null);
      setFieldErrors((prev) => ({ ...prev, file: message }));
      setIsExtractingMetadata(false);
    }

    // Reset input so same file can be selected again
    if (inputElement) {
      inputElement.value = '';
    }
  }

  /**
   * Handles form submission.
   * Validates all fields, creates the song via API, and handles the response.
   */
  async function handleSubmit(): Promise<void> {
    // Clear previous errors
    setError(null);
    setFieldErrors({});

    // Validate metadata
    const metadataErrors = validateSongMetadata(title, author);
    if (metadataErrors) {
      setFieldErrors(metadataErrors);
      return;
    }

    // Validate file was selected
    if (!selectedFile) {
      setFieldErrors({ file: 'file.required' });
      return;
    }

    // Attempt upload
    setIsLoading(true);
    try {
      await createSong({
        title: title.trim(),
        author: author.trim(),
        file: selectedFile,
        onPhaseChange: (phase) => setUploadPhase(phase),
      });

      // Success — reset form and close dialog
      setTitle('');
      setAuthor('');
      setSelectedFile(null);
      setUploadPhase(null);
      onClose();
    } catch (err) {
      // Handle different error types
      if (err instanceof InvalidFileError) {
        setFieldErrors({ file: err.message });
      } else if (err instanceof StorageUploadError) {
        setError(t('errors.storageUploadFailed', { message: err.message }));
      } else if (err instanceof ApiError) {
        setError(
          t('errors.uploadFailed', {
            message: err.message,
            statusCode: err.statusCode,
          }),
        );
      } else {
        setError(t('errors.unexpected'));
      }
    } finally {
      setIsLoading(false);
      setUploadPhase(null);
    }
  }

  /**
   * Handles dialog close.
   * Resets form state for the next open.
   */
  function handleDialogClose(): void {
    if (!isLoading) {
      setTitle('');
      setAuthor('');
      setSelectedFile(null);
      setError(null);
      setFieldErrors({});
      setUploadPhase(null);
      onClose();
    }
  }

  /**
   * Opens the native file picker.
   */
  function handleOpenFilePicker(): void {
    fileInputRef.current?.click();
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

          {/* File upload section */}
          <Box>
            <input
              ref={fileInputRef}
              type="file"
              accept={[
                'audio/mpeg',
                'audio/wav',
                'audio/ogg',
                'audio/webm',
                'video/mp4',
                'video/quicktime',
                'audio/flac',
              ].join(',')}
              onChange={handleFileSelect}
              disabled={isLoading}
              style={{ display: 'none' }}
            />

            <Button
              variant="outlined"
              onClick={handleOpenFilePicker}
              disabled={isLoading}
              startIcon={<CloudUploadIcon />}
              fullWidth
              sx={{
                borderColor: 'rgba(168, 85, 247, 0.5)',
                color: 'rgb(243, 232, 255)',
                textTransform: 'none',
                fontSize: '0.95rem',
                py: 1.5,
                '&:hover': {
                  borderColor: 'rgba(168, 85, 247, 1)',
                  backgroundColor: 'rgba(168, 85, 247, 0.1)',
                },
                '&.Mui-disabled': {
                  borderColor: 'rgba(168, 85, 247, 0.2)',
                  color: 'rgba(243, 232, 255, 0.5)',
                },
              }}
            >
              {t('chooseFileButton')}
            </Button>

            {/* Metadata extraction loading state */}
            {isExtractingMetadata && (
              <Typography
                variant="body2"
                sx={{
                  mt: 1.5,
                  p: 1.5,
                  backgroundColor: 'rgba(129, 140, 248, 0.1)',
                  borderRadius: 1,
                  border: '1px solid rgba(129, 140, 248, 0.3)',
                  color: 'rgb(199, 210, 254)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1,
                }}
              >
                <CircularProgress
                  size={16}
                  sx={{ color: 'rgb(199, 210, 254)' }}
                />
                {t('extractingMetadata')}
              </Typography>
            )}

            {/* File name display */}
            {selectedFile && !isExtractingMetadata && (
              <Typography
                variant="body2"
                sx={{
                  mt: 1.5,
                  p: 1.5,
                  backgroundColor: 'rgba(34, 197, 94, 0.1)',
                  borderRadius: 1,
                  border: '1px solid rgba(34, 197, 94, 0.3)',
                  color: 'rgb(134, 239, 172)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1,
                }}
              >
                ✓ {selectedFile.name} (
                {(selectedFile.size / 1024 / 1024).toFixed(1)} MB)
              </Typography>
            )}

            {/* File error / helper text */}
            {fieldErrors.file && (
              <FormHelperText
                error
                sx={{
                  mt: 1.5,
                  color: 'rgba(252, 165, 165, 1)',
                }}
              >
                {tV(fieldErrors.file as Parameters<typeof tV>[0])}
              </FormHelperText>
            )}

            {!selectedFile && !fieldErrors.file && (
              <FormHelperText
                sx={{
                  mt: 1.5,
                  color: 'rgba(243, 232, 255, 0.6)',
                }}
              >
                {t('supportedFormats')}
              </FormHelperText>
            )}
          </Box>

          {/* Title field */}
          <TextField
            label={t('titleLabel')}
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
              if (fieldErrors.title) {
                setFieldErrors((prev) => ({ ...prev, title: undefined }));
              }
            }}
            error={!!fieldErrors.title}
            helperText={
              fieldErrors.title
                ? tV(fieldErrors.title as Parameters<typeof tV>[0])
                : selectedFile && isExtractingMetadata
                  ? t('detectingMetadata')
                  : ''
            }
            fullWidth
            disabled={isLoading || !selectedFile || isExtractingMetadata}
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
                : selectedFile && isExtractingMetadata
                  ? t('detectingMetadata')
                  : ''
            }
            fullWidth
            disabled={isLoading || !selectedFile || isExtractingMetadata}
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
          onClick={handleSubmit}
          disabled={
            isLoading || !title.trim() || !author.trim() || !selectedFile
          }
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
              {uploadPhase === 'uploading'
                ? t('uploadingFileButton')
                : uploadPhase === 'registering'
                  ? t('registeringButton')
                  : t('uploadingButton')}
            </>
          ) : (
            t('uploadButton')
          )}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
