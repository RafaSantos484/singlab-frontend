'use client';

import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  TextField,
  CircularProgress,
  LinearProgress,
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
  AudioNormalizationError,
  normalizeAudioFile,
} from '@/lib/audio/normalizeAudio';

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
 * - File picker + drag-and-drop support for audio files
 * - Format validation (MIME type + extension fallback)
 * - Automatic metadata extraction from audio tags (title, artist)
 * - Client-side canonical audio normalization using FFmpeg WASM
 * - Text fields for title and author with real-time validation
 * - Multi-phase progress tracking (converting → uploading → saving)
 * - Loading and error states with granular error messages
 * - Accessible keyboard navigation (ESC to close, TAB order)
 * - Field auto-fill from extracted metadata, with manual override
 *
 * Workflow:
 * 1. User selects file via picker or drag-and-drop
 * 2. File is validated (format, size)
 * 3. Metadata automatically extracted from audio tags (if present)
 * 4. User fills in/confirms title and author
 * 5. FFmpeg normalizes any format to canonical AAC/M4A (progress shown)
 * 6. Normalized audio uploaded to Storage + metadata sent to API
 * 7. Dialog closes automatically; songs list updates via Firestore listener
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
  const [conversionProgress, setConversionProgress] = useState<number>(0);
  const [isExtractingMetadata, setIsExtractingMetadata] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
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
   * Validates the file and extracts metadata.
   * Shared by both the file-picker change handler and the drag-and-drop handler.
   */
  async function processFile(file: File): Promise<void> {
    try {
      validateSongFile(file);
      setSelectedFile(file);
      setFieldErrors((prev) => ({ ...prev, file: undefined }));
      setError(null);

      // Extract metadata if file is audio
      setIsExtractingMetadata(true);
      const metadata = await extractMetadata(file);

      if (metadata) {
        if (metadata.title && !title) {
          setTitle(metadata.title);
        }
        if (metadata.artist && !author) {
          setAuthor(metadata.artist);
        }
      }

      setIsExtractingMetadata(false);
    } catch (err) {
      const message =
        err instanceof InvalidFileTypeError ||
        err instanceof FileSizeExceededError
          ? (err as InvalidFileError).message
          : 'file.invalid';
      setSelectedFile(null);
      setFieldErrors((prev) => ({ ...prev, file: message }));
      setIsExtractingMetadata(false);
    }
  }

  /**
   * Handles file selection from the file input.
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

    await processFile(file);

    // Reset input so same file can be selected again
    if (inputElement) {
      inputElement.value = '';
    }
  }

  // ---------------------------------------------------------------------------
  // Drag-and-drop handlers
  // ---------------------------------------------------------------------------

  function handleDragOver(e: React.DragEvent<HTMLDivElement>): void {
    e.preventDefault();
    e.stopPropagation();
    if (!isLoading) setIsDragOver(true);
  }

  function handleDragLeave(e: React.DragEvent<HTMLDivElement>): void {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  }

  async function handleDrop(e: React.DragEvent<HTMLDivElement>): Promise<void> {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);

    if (isLoading) return;

    const file = e.dataTransfer.files?.[0];
    if (!file) return;

    await processFile(file);
  }

  /**
   * Handles form submission.
   * Validates all fields, normalizes the file, creates the song via API,
   * and handles the response.
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

    // Attempt conversion + upload
    setIsLoading(true);
    try {
      // Step 1 – Normalize audio in the browser (canonical AAC/M4A)
      setUploadPhase('converting');
      setConversionProgress(0);
      const normalizedFile = await normalizeAudioFile(selectedFile, {
        fileName: selectedFile.name,
        onProgress: (pct) => {
          setConversionProgress(pct);
        },
      });

      // Step 2 – Upload and register
      await createSong({
        title: title.trim(),
        author: author.trim(),
        file: normalizedFile,
        onPhaseChange: (phase) => setUploadPhase(phase),
      });

      // Success — reset form and close dialog
      setTitle('');
      setAuthor('');
      setSelectedFile(null);
      setUploadPhase(null);
      setConversionProgress(0);
      onClose();
    } catch (err) {
      // Handle different error types
      if (err instanceof InvalidFileError) {
        setFieldErrors({ file: err.message });
      } else if (err instanceof AudioNormalizationError) {
        console.error('Audio normalization failed:', err);
        setError(t('errors.conversionFailed', { message: err.message }));
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
        console.error('Unexpected song upload error:', err);
        setError(t('errors.unexpected'));
      }
    } finally {
      setIsLoading(false);
      setUploadPhase(null);
      setConversionProgress(0);
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
      setSelectedFile(null);
      setError(null);
      setFieldErrors({});
      setUploadPhase(null);
      setConversionProgress(0);
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

            {/* File upload section */}
            <Box
              onDragOver={handleDragOver}
              onDragEnter={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              sx={{
                borderRadius: 2,
                border: isDragOver
                  ? '2px dashed rgba(168, 85, 247, 1)'
                  : '2px dashed transparent',
                backgroundColor: isDragOver
                  ? 'rgba(168, 85, 247, 0.08)'
                  : 'transparent',
                transition:
                  'border-color 0.15s ease, background-color 0.15s ease',
                p: isDragOver ? 1 : 0,
              }}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept={[
                  'audio/mpeg',
                  'audio/mp3',
                  'audio/x-mpeg',
                  'audio/wav',
                  'audio/x-wav',
                  'audio/ogg',
                  'audio/webm',
                  'video/webm',
                  'video/mp4',
                  'audio/mp4',
                  'video/quicktime',
                  'audio/flac',
                  'audio/x-flac',
                  'audio/aac',
                  'audio/x-aac',
                  'audio/m4a',
                  'audio/x-m4a',
                  '.mp3',
                  '.wav',
                  '.ogg',
                  '.webm',
                  '.mp4',
                  '.mov',
                  '.flac',
                  '.aac',
                  '.m4a',
                  '.mpeg',
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
                  borderColor: isDragOver
                    ? 'rgba(168, 85, 247, 1)'
                    : 'rgba(168, 85, 247, 0.5)',
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
                {isDragOver ? t('dropFileHere') : t('chooseFileButton')}
              </Button>

              {/* Drag-and-drop hint */}
              {!selectedFile && !fieldErrors.file && !isDragOver && (
                <Typography
                  variant="caption"
                  sx={{
                    display: 'block',
                    mt: 0.75,
                    textAlign: 'center',
                    color: 'rgba(243, 232, 255, 0.45)',
                  }}
                >
                  {t('dragDropHint')}
                </Typography>
              )}

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
            type="submit"
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
                {uploadPhase === 'converting'
                  ? t('convertingButton', {
                      progress: conversionProgress,
                    })
                  : uploadPhase === 'uploading'
                    ? t('uploadingFileButton')
                    : uploadPhase === 'saving'
                      ? t('registeringButton')
                      : t('uploadingButton')}
              </>
            ) : (
              t('uploadButton')
            )}
          </Button>
        </DialogActions>

        {/* Converting progress bar (full-width, below actions) */}
        {isLoading && uploadPhase === 'converting' && (
          <LinearProgress
            variant={conversionProgress > 0 ? 'determinate' : 'indeterminate'}
            value={conversionProgress}
            sx={{
              height: 3,
              borderRadius: '0 0 4px 4px',
              backgroundColor: 'rgba(168, 85, 247, 0.15)',
              '& .MuiLinearProgress-bar': {
                background: 'linear-gradient(90deg, #a78bfa 0%, #c4b5fd 100%)',
              },
            }}
          />
        )}
      </Box>
    </Dialog>
  );
}
