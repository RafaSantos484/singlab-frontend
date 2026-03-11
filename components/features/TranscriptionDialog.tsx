'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Collapse,
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

import { removeSilencesFromVocals } from '@/lib/audio/ffmpegVocals';
import { useWhisperTranscriber } from '@/lib/hooks/useWhisperTranscriber';
import { requestGlobalPlayerPause } from '@/lib/player/practiceSync';
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
    return '--:--.--';
  }

  const totalSeconds = Math.max(0, seconds);
  const minutes = Math.floor(totalSeconds / 60);
  const remaining = totalSeconds % 60;

  return `${minutes.toString().padStart(2, '0')}:${remaining
    .toFixed(2)
    .padStart(5, '0')}`;
}

function modelLabel(model: WhisperModelOption, quantized: boolean): string {
  const size = quantized ? model.quantizedSizeMb : model.fullPrecisionSizeMb;

  if (!size) {
    return model.id;
  }

  return `${model.id} (${size} MB)`;
}

/**
 * Decodes a WAV blob (already 16 kHz mono from FFmpeg) to a Float32Array
 * for direct transfer to the transcription worker.
 */
async function decodeProcessedAudio(wavBlob: Blob): Promise<Float32Array> {
  const arrayBuffer = await wavBlob.arrayBuffer();
  const audioContext = new AudioContext({
    sampleRate: TRANSCRIPTION_SAMPLE_RATE,
  });
  try {
    const buffer = await audioContext.decodeAudioData(arrayBuffer.slice(0));
    return buffer.getChannelData(0).slice();
  } finally {
    await audioContext.close();
  }
}

/**
 * Runs Whisper transcription for a vocals track entirely on the client,
 * including silence removal, model selection, loading progress, and
 * word-level output aligned to the original audio timeline.
 *
 * **Pipeline:**
 * 1. Fetch vocals stem as a Blob
 * 2. FFmpeg WASM detects silences and removes them; a cut map is built
 * 3. Processed 16 kHz mono WAV is decoded to Float32Array
 * 4. Whisper worker transcribes with word-level timestamps
 * 5. Timestamps are remapped from processed → original audio via cut map
 * 6. Word list with original-audio timestamps is displayed
 *
 * **Features:**
 * - Model size selection (tiny, base, small, medium, large)
 * - Quantization toggle (8-bit vs. full precision)
 * - Multilingual support with configurable language and task
 * - Automatic locale-based language defaults
 * - Real-time transcript streaming during inference
 * - Collapsible silence cut map for debugging/inspection
 *
 * @param open — Dialog visibility
 * @param onClose — Called when user closes dialog (must not be busy)
 * @param songTitle — Song title for dialog header
 * @param vocalsUrl — URL to the vocals stem audio file
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
  const hasAppliedLocaleDefaultsRef = useRef(false);

  type PreparingStage = 'detecting' | 'removing' | 'decoding' | null;
  const [preparingStage, setPreparingStage] = useState<PreparingStage>(null);
  const [audioError, setAudioError] = useState<string | null>(null);
  const [cutMapLines, setCutMapLines] = useState<string[]>([]);
  const [showCutMap, setShowCutMap] = useState(false);

  const isPreparingAudio = preparingStage !== null;
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

  // Pause GlobalPlayer when the dialog opens.
  useEffect(() => {
    if (open) {
      requestGlobalPlayerPause();
    }
  }, [open]);

  // Revoke the processed audio object URL when the dialog closes.
  useEffect(() => {
    if (!open) {
      if (processedAudioUrlRef.current) {
        URL.revokeObjectURL(processedAudioUrlRef.current);
        processedAudioUrlRef.current = null;
      }
      setProcessedAudioUrl(null);
    }
  }, [open]);

  useEffect(() => {
    if (!open) {
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

    if (hasAppliedLocaleDefaultsRef.current) {
      return;
    }

    if (isEnglishLocale) {
      hasAppliedLocaleDefaultsRef.current = true;
      return;
    }

    const autoLanguage = getTranscriptionLanguageFromLocale(locale);
    if (!transcriber.settings.multilingual) {
      transcriber.setMultilingual(true);
    }

    if (transcriber.settings.language !== autoLanguage) {
      transcriber.setLanguage(autoLanguage);
    }

    hasAppliedLocaleDefaultsRef.current = true;
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

    try {
      // Step 1: Fetch vocals audio as a Blob.
      setPreparingStage('detecting');
      const response = await fetch(vocalsUrl);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const audioBlob = await response.blob();

      // Step 2: Detect silences, cut audio, and build cut map via FFmpeg WASM.
      setPreparingStage('removing');
      const {
        processedBlob,
        speechSegments,
        cutMapLines: newCutMap,
      } = await removeSilencesFromVocals(audioBlob);
      setCutMapLines(newCutMap);

      // Step 3: Decode processed WAV to Float32Array for the transcription worker.
      setPreparingStage('decoding');
      const processedAudio = await decodeProcessedAudio(processedBlob);

      // Step 4: Start transcription. The hook remaps word timestamps after completion.
      transcriber.start(processedAudio, speechSegments);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : t('errors.unknown');
      setAudioError(t('errors.audioProcess', { message }));
    } finally {
      setPreparingStage(null);
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
    setPreparingStage(null);
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

          {!canClose && <Alert severity="warning">{t('stopToClose')}</Alert>}

          {isPreparingAudio && (
            <Alert severity="info" icon={<CircularProgress size={16} />}>
              {preparingStage === 'detecting'
                ? t('preparingDetecting')
                : preparingStage === 'removing'
                  ? t('preparingRemoving')
                  : t('preparingDecoding')}
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

          {cutMapLines.length > 0 && (
            <Box>
              <Button
                size="small"
                variant="text"
                onClick={() => setShowCutMap((prev) => !prev)}
                sx={{ mb: 0.5, textTransform: 'none', p: 0 }}
              >
                {showCutMap ? t('cutMapHide') : t('cutMapShow')}
              </Button>
              <Collapse in={showCutMap}>
                <Box
                  component="pre"
                  sx={{
                    fontFamily: 'monospace',
                    fontSize: '0.7rem',
                    lineHeight: 1.6,
                    border: '1px solid',
                    borderColor: 'divider',
                    borderRadius: 1,
                    px: 1.5,
                    py: 1,
                    maxHeight: 160,
                    overflowY: 'auto',
                    whiteSpace: 'pre',
                    m: 0,
                  }}
                >
                  {cutMapLines.join('\n')}
                </Box>
              </Collapse>
            </Box>
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

          <Box>
            <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
              {t('wordListLabel')}
            </Typography>
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
                <List dense disablePadding>
                  {transcriber.output.chunks.map((chunk, index) => (
                    <ListItem
                      key={`${index}-${chunk.timestamp[0]}`}
                      disableGutters
                      sx={{ py: 0.25 }}
                    >
                      <ListItemText
                        primary={chunk.text.trim() || t('emptyChunk')}
                        secondary={`${formatTimestamp(chunk.timestamp[0])} — ${formatTimestamp(chunk.timestamp[1])}`}
                        primaryTypographyProps={{ variant: 'body2' }}
                        secondaryTypographyProps={{
                          variant: 'caption',
                          sx: { fontFamily: 'monospace' },
                        }}
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
