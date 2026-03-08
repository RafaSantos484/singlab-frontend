'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormControlLabel,
  InputLabel,
  LinearProgress,
  List,
  ListItem,
  ListItemText,
  MenuItem,
  Select,
  Stack,
  Switch,
  Typography,
} from '@mui/material';
import { useLocale, useTranslations } from 'next-intl';

import { useWhisperTranscriber } from '@/lib/hooks/useWhisperTranscriber';
import {
  getTranscriptionLanguageFromLocale,
  TRANSCRIPTION_SAMPLE_RATE,
  WHISPER_LANGUAGE_OPTIONS,
  WHISPER_MODEL_OPTIONS,
  type WhisperModelOption,
} from '@/lib/transcription/constants';

interface TranscriptionDialogProps {
  open: boolean;
  onClose: () => void;
  songTitle: string;
  vocalsUrl: string | null;
}

function formatTimestamp(seconds: number | null): string {
  if (seconds === null || Number.isNaN(seconds)) {
    return '--:--';
  }

  const totalSeconds = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(totalSeconds / 60);
  const remaining = totalSeconds % 60;

  return `${minutes.toString().padStart(2, '0')}:${remaining
    .toString()
    .padStart(2, '0')}`;
}

function modelLabel(model: WhisperModelOption, quantized: boolean): string {
  const size = quantized ? model.quantizedSizeMb : model.fullPrecisionSizeMb;

  if (!size) {
    return model.id;
  }

  return `${model.id} (${size} MB)`;
}

async function decodeAudioFromUrl(url: string): Promise<AudioBuffer> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const rawData = await response.arrayBuffer();
  const audioContext = new AudioContext({
    sampleRate: TRANSCRIPTION_SAMPLE_RATE,
  });

  try {
    return await audioContext.decodeAudioData(rawData.slice(0));
  } finally {
    await audioContext.close();
  }
}

/**
 * Runs Whisper transcription for a vocals track entirely on the client,
 * including model selection, loading progress and real-time partial text.
 */
export function TranscriptionDialog({
  open,
  onClose,
  songTitle,
  vocalsUrl,
}: TranscriptionDialogProps): React.ReactElement {
  const locale = useLocale();
  const t = useTranslations('Transcription');
  const transcriber = useWhisperTranscriber();
  const [isPreparingAudio, setIsPreparingAudio] = useState(false);
  const [audioError, setAudioError] = useState<string | null>(null);
  const isEnglishLocale = locale.toLowerCase().startsWith('en');

  const availableModels = useMemo(() => {
    return WHISPER_MODEL_OPTIONS.filter((model) => {
      if (!transcriber.settings.quantized && !model.fullPrecisionSizeMb) {
        return false;
      }

      if (transcriber.settings.multilingual && !model.supportsMultilingual) {
        return false;
      }

      return true;
    });
  }, [transcriber.settings.multilingual, transcriber.settings.quantized]);

  useEffect(() => {
    if (!open) {
      transcriber.reset();
      setAudioError(null);
      setIsPreparingAudio(false);
      return;
    }

    const selectedModelExists = availableModels.some(
      (model) => model.id === transcriber.settings.model,
    );

    if (!selectedModelExists && availableModels.length > 0) {
      transcriber.setModel(availableModels[0].id);
    }
  }, [
    availableModels,
    open,
    transcriber,
    transcriber.settings.model,
    transcriber.setModel,
  ]);

  useEffect(() => {
    if (!open) {
      return;
    }

    if (isEnglishLocale) {
      return;
    }

    const autoLanguage = getTranscriptionLanguageFromLocale(locale);
    if (!transcriber.settings.multilingual) {
      transcriber.setMultilingual(true);
    }

    if (transcriber.settings.language !== autoLanguage) {
      transcriber.setLanguage(autoLanguage);
    }
  }, [
    isEnglishLocale,
    locale,
    open,
    transcriber,
    transcriber.settings.language,
    transcriber.settings.multilingual,
  ]);

  const handleStart = useCallback(async (): Promise<void> => {
    if (!vocalsUrl) {
      setAudioError(t('errors.noVocals'));
      return;
    }

    setAudioError(null);
    setIsPreparingAudio(true);

    try {
      const decoded = await decodeAudioFromUrl(vocalsUrl);
      transcriber.start(decoded);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : t('errors.unknown');
      setAudioError(t('errors.audioDecode', { message }));
    } finally {
      setIsPreparingAudio(false);
    }
  }, [t, transcriber, vocalsUrl]);

  const canStart =
    Boolean(vocalsUrl) &&
    !isPreparingAudio &&
    !transcriber.isBusy &&
    !transcriber.isModelLoading;

  const canStop =
    transcriber.isBusy || transcriber.isModelLoading || transcriber.isStopping;
  const canClose = !canStop && !isPreparingAudio;

  const handleStop = useCallback(async (): Promise<void> => {
    await transcriber.stop();
    setIsPreparingAudio(false);
  }, [transcriber]);

  const handleClose = useCallback((): void => {
    if (!canClose) {
      return;
    }

    onClose();
  }, [canClose, onClose]);

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="md" fullWidth>
      <DialogTitle>{t('title', { songTitle })}</DialogTitle>

      <DialogContent>
        <Stack spacing={2.5} sx={{ pt: 1 }}>
          <Typography variant="body2" color="text.secondary">
            {t('description')}
          </Typography>

          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            spacing={2}
            alignItems={{ xs: 'stretch', sm: 'center' }}
          >
            <FormControl fullWidth>
              <InputLabel>{t('modelLabel')}</InputLabel>
              <Select
                value={transcriber.settings.model}
                label={t('modelLabel')}
                onChange={(event) => transcriber.setModel(event.target.value)}
              >
                {availableModels.map((model) => (
                  <MenuItem key={model.id} value={model.id}>
                    {modelLabel(model, transcriber.settings.quantized)}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            <FormControlLabel
              control={
                <Switch
                  checked={transcriber.settings.quantized}
                  onChange={(event) =>
                    transcriber.setQuantized(event.target.checked)
                  }
                />
              }
              label={t('quantizedLabel')}
            />

            <FormControlLabel
              control={
                <Switch
                  checked={transcriber.settings.multilingual}
                  onChange={(event) =>
                    transcriber.setMultilingual(event.target.checked)
                  }
                />
              }
              label={t('multilingualLabel')}
            />
          </Stack>

          {transcriber.settings.multilingual && (
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <FormControl fullWidth>
                <InputLabel>{t('languageLabel')}</InputLabel>
                <Select
                  value={transcriber.settings.language}
                  label={t('languageLabel')}
                  onChange={(event) =>
                    transcriber.setLanguage(event.target.value)
                  }
                >
                  {WHISPER_LANGUAGE_OPTIONS.map((option) => (
                    <MenuItem key={option.code} value={option.code}>
                      {t(`languages.${option.code}` as Parameters<typeof t>[0])}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>

              <FormControl fullWidth>
                <InputLabel>{t('taskLabel')}</InputLabel>
                <Select
                  value={transcriber.settings.subtask}
                  label={t('taskLabel')}
                  onChange={(event) =>
                    transcriber.setSubtask(
                      event.target.value as 'transcribe' | 'translate',
                    )
                  }
                >
                  <MenuItem value="transcribe">
                    {t('tasks.transcribe')}
                  </MenuItem>
                  <MenuItem value="translate">{t('tasks.translate')}</MenuItem>
                </Select>
              </FormControl>
            </Stack>
          )}

          {!canClose && (
            <Alert severity="warning">{t('stopToClose')}</Alert>
          )}

          {isPreparingAudio && (
            <Alert severity="info" icon={<CircularProgress size={16} />}>
              {t('preparingAudio')}
            </Alert>
          )}

          {audioError && <Alert severity="error">{audioError}</Alert>}

          {transcriber.error && (
            <Alert severity="error">
              {t('errors.transcription', {
                message: transcriber.error || t('errors.unknown'),
              })}
            </Alert>
          )}

          {transcriber.progressItems.length > 0 && (
            <Stack spacing={1.25}>
              <Typography variant="subtitle2">
                {t('loadingProgress')}
              </Typography>
              {transcriber.progressItems.map((item) => (
                <Box key={item.file}>
                  <Typography
                    variant="caption"
                    sx={{ display: 'block', mb: 0.5, color: 'text.secondary' }}
                  >
                    {item.file}
                  </Typography>
                  <LinearProgress
                    variant="determinate"
                    value={Math.min(100, Math.max(0, item.progress * 100))}
                  />
                </Box>
              ))}
            </Stack>
          )}

          <Box
            sx={{
              border: '1px solid',
              borderColor: 'divider',
              borderRadius: 1,
              minHeight: 200,
              maxHeight: 260,
              overflowY: 'auto',
              px: 1,
              py: 0.5,
            }}
          >
            {transcriber.output?.chunks.length ? (
              <List dense>
                {transcriber.output.chunks.map((chunk, index) => (
                  <ListItem key={`${index}-${chunk.timestamp[0]}`}>
                    <ListItemText
                      primary={chunk.text.trim() || t('emptyChunk')}
                      secondary={formatTimestamp(chunk.timestamp[0])}
                    />
                  </ListItem>
                ))}
              </List>
            ) : (
              <Typography
                variant="body2"
                sx={{ color: 'text.secondary', px: 1, py: 1.5 }}
              >
                {t('emptyState')}
              </Typography>
            )}
          </Box>

          <Box>
            <Typography variant="subtitle2" sx={{ mb: 0.75 }}>
              {t('fullTranscriptLabel')}
            </Typography>
            <Typography
              variant="body2"
              sx={{
                border: '1px solid',
                borderColor: 'divider',
                borderRadius: 1,
                minHeight: 80,
                px: 1.25,
                py: 1,
                whiteSpace: 'pre-wrap',
              }}
            >
              {transcriber.output?.text?.trim() || t('noTranscriptYet')}
            </Typography>
          </Box>
        </Stack>
      </DialogContent>

      <DialogActions>
        <Button onClick={handleClose} disabled={!canClose}>
          {t('closeButton')}
        </Button>
        <Button
          variant="outlined"
          color="warning"
          onClick={() => {
            void handleStop();
          }}
          disabled={!canStop || transcriber.isStopping}
        >
          {t('stopButton')}
        </Button>
        <Button
          variant="contained"
          onClick={() => {
            void handleStart();
          }}
          disabled={!canStart}
        >
          {transcriber.isBusy ? t('transcribingButton') : t('startButton')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
