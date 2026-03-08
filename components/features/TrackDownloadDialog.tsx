'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  Stack,
  Typography,
} from '@mui/material';
import { useTranslations } from 'next-intl';

import type { SeparationStemName } from '@/lib/api/types';
import { getFirebaseAuth } from '@/lib/firebase/auth';
import { getStorageDownloadUrl } from '@/lib/storage/getStorageDownloadUrl';
import { buildRawSongStoragePath } from '@/lib/storage/uploadRawSong';

interface TrackDownloadDialogProps {
  open: boolean;
  onClose: () => void;
  songId: string;
  songTitle: string;
  availableStems: SeparationStemName[];
  stemUrls: Partial<Record<SeparationStemName, string>>;
  isResolvingStemUrls: boolean;
}

type DownloadTrackKey = 'raw' | SeparationStemName;

interface DownloadTrackOption {
  key: DownloadTrackKey;
  label: string;
  url: string | null;
  isDisabled: boolean;
}

function sanitizeFileName(value: string): string {
  return value
    .trim()
    .replace(/[^a-zA-Z0-9\-_ ]/g, '')
    .replace(/\s+/g, '_')
    .slice(0, 80);
}

async function downloadFile(url: string, fileName: string): Promise<void> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);

  try {
    const anchor = document.createElement('a');
    anchor.href = objectUrl;
    anchor.download = fileName;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

/**
 * Dialog for downloading raw and/or separated stem tracks for a song.
 *
 * **Features:**
 * - Allows selection of raw original audio and individual stems (vocals, bass, drums, etc.)
 * - Resolves download URLs from Firebase Storage (with auth, error handling)
 * - Sanitizes file names to safe alphanumeric + underscore format
 * - Generates browser download without opening new tabs
 * - Shows loading state while resolving stem URLs
 * - Clear error messages for auth failures or URL resolution issues
 *
 * **File Naming:**
 * Downloads are saved as: `{songTitle}_{stemType}.m4a`
 * (e.g., `My Song_vocals.m4a`, `My Song_raw.m4a`)
 *
 * @param open — Dialog visibility
 * @param onClose — Called when user closes dialog
 * @param songId — Firestore song document ID (needed for raw audio path)
 * @param songTitle — Song title used for file name generation
 * @param availableStems — Array of stem types available for this song (vocals, bass, drums, etc.)
 * @param stemUrls — Map of stem URLs indexed by stem type
 * @param isResolvingStemUrls — Loading state; true while fetching stem URLs from Storage
 */
export function TrackDownloadDialog({
  open,
  onClose,
  songId,
  songTitle,
  availableStems,
  stemUrls,
  isResolvingStemUrls,
}: TrackDownloadDialogProps): React.ReactElement {
  const tDashboard = useTranslations('Dashboard');
  const tPlayer = useTranslations('Player');

  const [rawUrl, setRawUrl] = useState<string | null>(null);
  const [rawUrlError, setRawUrlError] = useState<string | null>(null);
  const [isResolvingRawUrl, setIsResolvingRawUrl] = useState(false);
  const [selection, setSelection] = useState<Record<string, boolean>>({});
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    let cancelled = false;

    const resolveRawUrl = async (): Promise<void> => {
      const userId = getFirebaseAuth().currentUser?.uid;
      if (!userId) {
        setRawUrlError(tDashboard('downloadTracksAuthError'));
        return;
      }

      setIsResolvingRawUrl(true);
      setRawUrlError(null);

      try {
        const rawStoragePath = buildRawSongStoragePath(userId, songId);
        const url = await getStorageDownloadUrl(rawStoragePath);
        if (!cancelled) {
          setRawUrl(url);
        }
      } catch (error) {
        if (!cancelled) {
          const message =
            error instanceof Error
              ? error.message
              : tDashboard('downloadTracksUnknownError');
          setRawUrl(null);
          setRawUrlError(message);
        }
      } finally {
        if (!cancelled) {
          setIsResolvingRawUrl(false);
        }
      }
    };

    void resolveRawUrl();

    return () => {
      cancelled = true;
    };
  }, [open, songId, tDashboard]);

  const options = useMemo<DownloadTrackOption[]>(() => {
    const stemOptions = availableStems.map((stem) => ({
      key: stem,
      label: tPlayer(('stems.' + stem) as Parameters<typeof tPlayer>[0]),
      url: stemUrls[stem] ?? null,
      isDisabled: !stemUrls[stem],
    }));

    return [
      {
        key: 'raw',
        label: tPlayer('rawLabel'),
        url: rawUrl,
        isDisabled: !rawUrl,
      },
      ...stemOptions,
    ];
  }, [availableStems, rawUrl, stemUrls, tPlayer]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const initialSelection = options.reduce<Record<string, boolean>>(
      (accumulator, option) => {
        accumulator[option.key] = !option.isDisabled;
        return accumulator;
      },
      {},
    );

    setSelection(initialSelection);
    setDownloadError(null);
  }, [open, options]);

  const selectedOptions = options.filter(
    (option) => selection[option.key] && !option.isDisabled && option.url,
  );

  const handleToggleTrack = useCallback((key: DownloadTrackKey): void => {
    setSelection((previous) => ({
      ...previous,
      [key]: !previous[key],
    }));
  }, []);

  const handleDownload = useCallback(async (): Promise<void> => {
    if (selectedOptions.length === 0) {
      setDownloadError(tDashboard('downloadTracksNoSelection'));
      return;
    }

    setIsDownloading(true);
    setDownloadError(null);

    try {
      const safeTitle = sanitizeFileName(songTitle) || 'song';

      for (const option of selectedOptions) {
        const extension = '.m4a';
        const suffix = option.key === 'raw' ? 'raw' : option.key;
        const fileName = `${safeTitle}_${suffix}${extension}`;
        await downloadFile(option.url as string, fileName);
      }

      onClose();
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : tDashboard('downloadTracksUnknownError');
      setDownloadError(
        tDashboard('downloadTracksFailedMessage', {
          message,
        }),
      );
    } finally {
      setIsDownloading(false);
    }
  }, [onClose, selectedOptions, songTitle, tDashboard]);

  const isBusy = isResolvingRawUrl || isResolvingStemUrls || isDownloading;

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{tDashboard('downloadTracksTitle')}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <Typography variant="body2" color="text.secondary">
            {tDashboard('downloadTracksDescription', { songTitle })}
          </Typography>

          {(isResolvingRawUrl || isResolvingStemUrls) && (
            <Alert severity="info" icon={<CircularProgress size={16} />}>
              {tDashboard('downloadTracksResolving')}
            </Alert>
          )}

          {rawUrlError && (
            <Alert severity="error">
              {tDashboard('downloadTracksRawErrorMessage', {
                message: rawUrlError,
              })}
            </Alert>
          )}

          {downloadError && <Alert severity="error">{downloadError}</Alert>}

          <Box
            sx={{
              border: '1px solid',
              borderColor: 'divider',
              borderRadius: 1,
              px: 1,
              py: 0.5,
            }}
          >
            <Stack spacing={0.25}>
              {options.map((option) => (
                <FormControlLabel
                  key={option.key}
                  control={
                    <Checkbox
                      checked={Boolean(selection[option.key])}
                      onChange={() => handleToggleTrack(option.key)}
                      disabled={option.isDisabled || isBusy}
                    />
                  }
                  label={option.label}
                />
              ))}
            </Stack>
          </Box>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={isDownloading}>
          {tDashboard('cancelButton')}
        </Button>
        <Button
          variant="contained"
          onClick={() => {
            void handleDownload();
          }}
          disabled={isBusy}
        >
          {isDownloading
            ? tDashboard('downloadTracksDownloadingButton')
            : tDashboard('downloadTracksConfirmButton')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
