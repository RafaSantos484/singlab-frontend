'use client';

import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useMemo,
  useState,
} from 'react';
import {
  Stack,
  Box,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  TextField,
  IconButton,
  Alert,
  LinearProgress,
  FormHelperText,
  Button,
  Typography,
} from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import { useTranslations } from 'next-intl';

import { convertToMp3, Mp3ConversionError } from '@/lib/audio/convertToMp3';
import { validateSongFile, InvalidFileError } from '@/lib/api/song-creation';
import type { SeparationStemName } from '@/lib/api/types';
import { uploadSeparationStem } from '@/lib/storage/uploadSeparationStems';
import { getFirebaseAuth } from '@/lib/firebase/auth';
import { updateSeparatedSongInfo } from '@/lib/firebase/songs';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Stem {
  id: string;
  type: SeparationStemName | '';
  file: File | null;
}

interface StemProgress {
  phase: 'converting' | 'uploading';
  progress: number;
}

/**
 * Imperative API exposed to parent dialogs.
 */
export interface StemUploadFormRef {
  submitStems: () => Promise<void>;
  isLoading: boolean;
}

interface StemUploadFormProps {
  songId: string;
  onSuccess: () => void;
}

const STEM_TYPES: SeparationStemName[] = [
  'vocals',
  'guitar',
  'piano',
  'bass',
  'drums',
  'other',
];

/** Max stems including the fixed vocals row. */
const MAX_STEMS = 6;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Manual stem upload form used by the local separation provider.
 *
 * Requires vocals plus at least one additional stem, validates files,
 * converts to MP3 when needed, uploads to Storage, and persists
 * `separatedSongInfo` with provider `local` in Firestore.
 */
export const StemUploadForm = forwardRef<
  StemUploadFormRef,
  StemUploadFormProps
>(function StemUploadForm({ songId, onSuccess }, ref) {
  const t = useTranslations('StemUploadForm');
  const tPlayer = useTranslations('Player');

  // State
  const [stems, setStems] = useState<Stem[]>([
    { id: 'vocals-default', type: 'vocals', file: null },
  ]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stemProgress, setStemProgress] = useState<Record<string, StemProgress>>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  // Get selected types
  const selectedTypes = useMemo(
    () =>
      new Set(
        stems
          .map((s) => s.type)
          .filter((t): t is SeparationStemName => t !== ''),
      ),
    [stems],
  );

  // Get available types (not yet selected)
  const availableTypes = useMemo(
    () => STEM_TYPES.filter((t) => !selectedTypes.has(t)),
    [selectedTypes],
  );

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  const addStem = (): void => {
    setStems((prev) => [
      ...prev,
      { id: `stem-${Date.now()}`, type: '', file: null },
    ]);
  };

  const removeStem = (id: string): void => {
    if (id === 'vocals-default') return; // Cannot remove vocals
    setStems((prev) => prev.filter((s) => s.id !== id));
  };

  const updateStemType = (id: string, type: SeparationStemName | ''): void => {
    setStems((prev) => prev.map((s) => (s.id === id ? { ...s, type } : s)));
  };

  const updateStemFile = (id: string, file: File | null): void => {
    setStems((prev) => prev.map((s) => (s.id === id ? { ...s, file } : s)));
  };

  const validate = useCallback((): boolean => {
    const errors: Record<string, string> = {};

    // Every row must have both type and file
    stems.forEach((stem) => {
      if (!stem.type && !stem.file) {
        errors[stem.id] = t('validation.bothMissing');
      } else if (stem.type && !stem.file) {
        errors[stem.id] = t('validation.fileMissing');
      } else if (stem.file && !stem.type) {
        errors[stem.id] = t('validation.typeMissing');
      }

      if (stem.file && !errors[stem.id]) {
        try {
          validateSongFile(stem.file);
        } catch (err) {
          errors[stem.id] = (err as InvalidFileError).message;
        }
      }
    });

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return false;
    }

    // Check minimum 2 stems (vocals + at least one more)
    if (stems.length < 2) {
      setError(t('validation.minStems'));
      return false;
    }

    // Check vocals has a file
    const vocalsRow = stems.find((s) => s.id === 'vocals-default');
    if (!vocalsRow?.file) {
      setError(t('validation.vocalsRequired'));
      return false;
    }

    return true;
  }, [stems, t]);

  const handleSubmit = useCallback(async (): Promise<void> => {
    setError(null);
    setFieldErrors({});

    if (!validate()) return;

    setIsLoading(true);

    try {
      const user = getFirebaseAuth().currentUser;
      if (!user?.uid) throw new Error('User not authenticated');

      const stemsToUpload = stems.filter(
        (s): s is { id: string; type: SeparationStemName; file: File } =>
          s.type !== '' && s.file !== null,
      );

      // Convert all stems to MP3 in parallel (with per-stem progress)
      const conversionPromises = stemsToUpload.map(async (stem) => {
        setStemProgress((prev) => ({
          ...prev,
          [stem.id]: { phase: 'converting', progress: 0 },
        }));

        try {
          const mp3File = await convertToMp3(stem.file, (pct) => {
            setStemProgress((prev) => ({
              ...prev,
              [stem.id]: { phase: 'converting', progress: pct },
            }));
          });
          return { id: stem.id, type: stem.type, file: mp3File };
        } catch (err) {
          const message =
            err instanceof Mp3ConversionError ? err.message : 'file.invalid';
          throw new Error(`${message} [${stem.type}]`);
        }
      });

      let convertedStems: Array<{
        id: string;
        type: SeparationStemName;
        file: File;
      }> = [];

      try {
        convertedStems = await Promise.all(conversionPromises);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'file.invalid';
        setError(t('validation.conversionFailed', { message }));
        setStemProgress({});
        return;
      }

      // Upload all stems to storage in parallel (with per-stem progress)
      const uploadPromises = convertedStems.map(async (stem) => {
        setStemProgress((prev) => ({
          ...prev,
          [stem.id]: { phase: 'uploading', progress: 0 },
        }));

        const storagePath = await uploadSeparationStem(
          user.uid,
          songId,
          stem.type,
          stem.file,
        );

        setStemProgress((prev) => ({
          ...prev,
          [stem.id]: { phase: 'uploading', progress: 100 },
        }));

        return { type: stem.type, path: storagePath };
      });

      const uploadResults = await Promise.all(uploadPromises);

      const stemPaths: Partial<Record<SeparationStemName, string>> = {};
      uploadResults.forEach(({ type, path }) => {
        stemPaths[type] = path;
      });

      // Update Firestore with stems
      await updateSeparatedSongInfo(user.uid, songId, {
        provider: 'local',
        providerData: {
          uploadedAt: new Date().toISOString(),
        },
        stems: {
          uploadedAt: new Date().toISOString(),
          paths: stemPaths,
        },
      });

      onSuccess();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setError(t('validation.uploadFailed', { message }));
    } finally {
      setIsLoading(false);
      setStemProgress({});
    }
  }, [validate, stems, songId, onSuccess, t]);

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Expose submit function and loading state to parent
  useImperativeHandle(
    ref,
    () => ({
      submitStems: handleSubmit,
      isLoading,
    }),
    [handleSubmit, isLoading],
  );

  return (
    <Stack spacing={3}>
      {/* Header */}
      <Box>
        <div style={{ fontSize: '1.125rem', fontWeight: 600 }}>
          {t('title')}
        </div>
        <div style={{ fontSize: '0.875rem', color: '#999' }}>
          {t('description')}
        </div>
      </Box>

      {/* Error alert */}
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

      {/* Stems list */}
      <Stack spacing={2}>
        {stems.map((stem) => {
          const isVocalsDefault = stem.id === 'vocals-default';
          const canRemove = !isVocalsDefault && !isLoading;
          const stemError = fieldErrors[stem.id];
          const progress = stemProgress[stem.id];

          return (
            <Box key={stem.id}>
            <Box
              sx={{
                display: 'flex',
                gap: 2,
                alignItems: 'flex-start',
                p: 2,
                border: `1px solid ${
                  progress ? 'rgba(168, 85, 247, 0.5)' : 'rgba(168, 85, 247, 0.2)'
                }`,
                borderRadius: '8px',
                bgcolor: 'rgba(30, 27, 75, 0.5)',
              }}
            >
              {/* Type select */}
              <FormControl
                sx={{ flex: 1, minWidth: '150px' }}
                size="small"
                error={!!stemError && !stem.type}
              >
                <InputLabel>{t('typeLabel')}</InputLabel>
                <Select
                  value={stem.type}
                  label={t('typeLabel')}
                  onChange={(e) =>
                    updateStemType(
                      stem.id,
                      e.target.value as SeparationStemName | '',
                    )
                  }
                  disabled={isVocalsDefault || isLoading}
                >
                  {isVocalsDefault ? (
                    <MenuItem value="vocals">
                      {tPlayer('stems.vocals')} ({t('requiredLabel')})
                    </MenuItem>
                  ) : (
                    [
                      <MenuItem key="empty" value="">
                        <em>{t('selectTypeLabel')}</em>
                      </MenuItem>,
                      ...availableTypes
                        .concat(stem.type ? [stem.type] : [])
                        .map((type) => (
                          <MenuItem key={type} value={type}>
                            {tPlayer(
                              `stems.${type}` as Parameters<typeof tPlayer>[0],
                            )}
                          </MenuItem>
                        )),
                    ]
                  )}
                </Select>
                {stemError && !stem.type && (
                  <FormHelperText>{stemError}</FormHelperText>
                )}
              </FormControl>

              {/* File input */}
              <TextField
                type="file"
                inputProps={{ accept: 'audio/*' }}
                onChange={(e) => {
                  const file =
                    (e.target as HTMLInputElement).files?.[0] ?? null;
                  updateStemFile(stem.id, file);
                }}
                disabled={isLoading}
                error={!!stemError && !stem.file}
                helperText={
                  stemError && !stem.file
                    ? stemError
                    : stem.file
                      ? stem.file.name
                      : undefined
                }
                sx={{ flex: 1, minWidth: '200px' }}
                size="small"
              />

              {/* Remove button */}
              <IconButton
                onClick={() => removeStem(stem.id)}
                disabled={!canRemove}
                size="small"
                aria-label={t('removeButton')}
              >
                <DeleteIcon fontSize="small" />
              </IconButton>
            </Box>

            {/* Per-stem progress bar */}
            {progress && (
              <Box sx={{ mt: 0.5, px: 0.5 }}>
                <Typography
                  variant="caption"
                  sx={{ color: 'text.secondary', mb: 0.5, display: 'block' }}
                >
                  {progress.phase === 'converting'
                    ? t('stemConverting', { progress: Math.round(progress.progress) })
                    : t('stemUploading')}
                </Typography>
                <LinearProgress
                  variant={progress.phase === 'uploading' && progress.progress === 0 ? 'indeterminate' : 'determinate'}
                  value={progress.progress}
                  sx={{ borderRadius: 1 }}
                />
              </Box>
            )}
            </Box>
          );
        })}
      </Stack>

      {/* Add stem button */}
      {stems.length < MAX_STEMS && (
        <Button
          variant="outlined"
          onClick={addStem}
          disabled={isLoading || availableTypes.length === 0}
          fullWidth
        >
          {t('addStemButton')}
        </Button>
      )}
    </Stack>
  );
});
