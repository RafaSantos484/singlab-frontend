'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Collapse,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControl,
  FormControlLabel,
  IconButton,
  InputLabel,
  LinearProgress,
  List,
  ListItem,
  ListItemText,
  MenuItem,
  Select,
  Stack,
  Switch,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import HelpOutlineIcon from '@mui/icons-material/HelpOutline';
import EditIcon from '@mui/icons-material/Edit';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import CheckIcon from '@mui/icons-material/Check';
import CloseIcon from '@mui/icons-material/Close';
import { useLocale, useTranslations } from 'next-intl';
import {
  removeSilencesFromVocals,
  type SpeechSegment,
} from '@/lib/audio/ffmpegVocals';
import sliceWavBlob from '@/lib/audio/sliceWav';
import { SegmentPlayers } from '@/components/features/SegmentPlayers';
import { useLyricsAdaptation } from '@/lib/hooks/useLyricsAdaptation';
import { useWhisperTranscriber } from '@/lib/hooks/useWhisperTranscriber';
import type { AdaptedChunk } from '@/lib/transcription/lyricsAdapter';
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

function adaptationStatusColor(
  status: AdaptedChunk['status'],
): 'success' | 'warning' | 'default' {
  if (status === 'matched') return 'success';
  if (status === 'corrected') return 'warning';
  return 'default';
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
 * - Model size selection (tiny, base, small, medium)
 * - Quantization toggle (8-bit vs. full precision)
 * - Multilingual support with configurable language
 * - Automatic locale-based language defaults
 * - Real-time transcript streaming during inference
 * - Collapsible silence cut map for debugging/inspection
 * - Inline audio players for original and silence-removed vocals
 * - Lyrics Adaptation panel: deterministic lyric correlation per chunk
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
  const lyricsAdaptation = useLyricsAdaptation();
  const lyricsAdaptationReset = lyricsAdaptation.reset;
  const hasAppliedLocaleDefaultsRef = useRef(false);

  type PreparingStage = 'detecting' | 'removing' | 'decoding' | null;
  const [preparingStage, setPreparingStage] = useState<PreparingStage>(null);
  const [audioError, setAudioError] = useState<string | null>(null);
  const [cutMapLines, setCutMapLines] = useState<string[]>([]);
  const [showCutMap, setShowCutMap] = useState(false);

  const processedAudioUrlRef = useRef<string | null>(null);
  const processedBlobRef = useRef<Blob | null>(null);
  const [processedAudioUrl, setProcessedAudioUrl] = useState<string | null>(
    null,
  );
  const [speechSegments, setSpeechSegments] = useState<SpeechSegment[]>([]);
  const [segmentUrls, setSegmentUrls] = useState<Record<number, string>>({});
  const segmentUrlsRef = useRef<Record<number, string>>({});
  const [showSegmentPlayers, setShowSegmentPlayers] = useState<boolean>(false);

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

  const currentModelPresent = useMemo(() => {
    return availableModels.some((m) => m.id === transcriber.settings.model);
  }, [availableModels, transcriber.settings.model]);

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
      processedBlobRef.current = null;
      // Revoke any per-segment URLs
      Object.values(segmentUrlsRef.current).forEach((u) =>
        URL.revokeObjectURL(u),
      );
      segmentUrlsRef.current = {};
      setSegmentUrls({});
      // clear any internal references
      lyricsAdaptationReset();
    }
  }, [open, lyricsAdaptationReset]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const selectedModelExists = availableModels.some(
      (model) => model.id === transcriber.settings.model,
    );
    if (!selectedModelExists && availableModels.length > 0) {
      // Prefer `whisper-small` as the default when using the full-precision
      // (non-quantized) models. Otherwise fall back to the first available
      // model (quantized default ordering).
      if (!transcriber.settings.quantized) {
        const preferred = availableModels.find(
          (m) => m.id === 'Xenova/whisper-small',
        );
        transcriber.setModel(preferred ? preferred.id : availableModels[0].id);
      } else {
        transcriber.setModel(availableModels[0].id);
      }
    }
  }, [
    availableModels,
    open,
    transcriber,
    transcriber.settings.model,
    transcriber.settings.quantized,
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
      let processedBlob: Blob | null = null;
      let speechOnly: SpeechSegment[] = [];

      // If we already have a processed blob (from a previous run in this
      // dialog session), reuse it instead of running FFmpeg again.
      if (processedBlobRef.current && speechSegments.length > 0) {
        processedBlob = processedBlobRef.current;
        speechOnly = speechSegments.filter((s) => s.type === 'speech');
      } else {
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
          processedBlob: newProcessedBlob,
          speechSegments,
          cutMapLines: newCutMap,
        } = await removeSilencesFromVocals(audioBlob);
        setCutMapLines(newCutMap);

        // Update the processed vocals player URL and the speech segments list.
        if (processedAudioUrlRef.current) {
          URL.revokeObjectURL(processedAudioUrlRef.current);
        }
        const newProcessedUrl = URL.createObjectURL(newProcessedBlob);
        processedAudioUrlRef.current = newProcessedUrl;
        setProcessedAudioUrl(newProcessedUrl);
        // Only expose true speech segments to the UI players.
        speechOnly = speechSegments.filter((s) => s.type === 'speech');
        setSpeechSegments(speechOnly);

        // Store processed blob for potential reuse in this dialog session.
        processedBlobRef.current = newProcessedBlob;
        processedBlob = newProcessedBlob;

        // Create per-segment sliced audio Blobs and object URLs so each
        // rendered player has its own bounded audio file representing the
        // exact segment duration.
        // Revoke any existing segment URLs first.
        Object.values(segmentUrlsRef.current).forEach((u) =>
          URL.revokeObjectURL(u),
        );
        segmentUrlsRef.current = {};
        const urls: Record<number, string> = {};
        await Promise.all(
          speechOnly.map(async (seg, idx) => {
            try {
              const blob = await sliceWavBlob(
                newProcessedBlob,
                seg.processedStart,
                seg.processedEnd,
              );
              const url = URL.createObjectURL(blob);
              urls[idx] = url;
              segmentUrlsRef.current[idx] = url;
            } catch {
              // If slicing fails, silently fall back to using the full processed audio URL.
            }
          }),
        );
        setSegmentUrls(urls);
      }

      if (!processedBlob) {
        throw new Error('Processed audio not available');
      }

      // Step 3: Decode processed WAV to Float32Array for the transcription worker.
      setPreparingStage('decoding');
      const processedAudio = await decodeProcessedAudio(processedBlob);

      // Step 4: Start transcription. The hook remaps word timestamps after completion.
      // Pass the filtered `speechOnly` array (don't rely on state being
      // synchronously updated via setSpeechSegments).
      transcriber.start(processedAudio, speechOnly);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : t('errors.unknown');
      setAudioError(t('errors.audioProcess', { message }));
    } finally {
      setPreparingStage(null);
    }
  }, [t, transcriber, vocalsUrl, speechSegments]);

  const canStart =
    Boolean(vocalsUrl) &&
    !isPreparingAudio &&
    !transcriber.isBusy &&
    !transcriber.isModelLoading;

  const canStop =
    transcriber.isBusy || transcriber.isModelLoading || transcriber.isStopping;

  const hasTranscriptChunks = (transcriber.output?.chunks.length ?? 0) > 0;

  const isAdaptationBusy = lyricsAdaptation.state.phase === 'adapting';

  const canClose = !canStop && !isPreparingAudio;

  // ---- Inline chunk edit state ----
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editingDraft, setEditingDraft] = useState('');
  const isEditing = editingIndex !== null;

  const handleEditConfirm = useCallback((): void => {
    if (editingIndex === null) return;
    const trimmed = editingDraft.trim();
    if (!trimmed) return;
    lyricsAdaptation.editChunk(editingIndex, trimmed);
    setEditingIndex(null);
    setEditingDraft('');
  }, [editingIndex, editingDraft, lyricsAdaptation]);

  const handleEditCancel = useCallback((): void => {
    setEditingIndex(null);
    setEditingDraft('');
  }, []);

  const handleDeleteChunk = useCallback(
    (index: number): void => {
      if (editingIndex === index) {
        setEditingIndex(null);
        setEditingDraft('');
      }
      lyricsAdaptation.deleteChunk(index);
    },
    [editingIndex, lyricsAdaptation],
  );

  /**
   * All interactive controls in the adaptation panel are disabled when:
   * - an adaptation batch is running, OR
   * - a retry is in progress, OR
   * - a transcription is running, OR
   * - a chunk edit is in progress.
   */
  const adaptationControlsDisabled =
    isAdaptationBusy || transcriber.isBusy || isEditing;

  const canAdapt =
    hasTranscriptChunks &&
    lyricsAdaptation.lyrics.trim().length > 0 &&
    !adaptationControlsDisabled;

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

          {/* Model / settings row */}
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
                {/* If the current model isn't in the filtered availableModels,
                    render a fallback MenuItem so the Select value is valid
                    for MUI and no warning is emitted. */}
                {!currentModelPresent && transcriber.settings.model && (
                  <MenuItem value={transcriber.settings.model}>
                    {transcriber.settings.model}
                  </MenuItem>
                )}
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
          )}

          {vocalsUrl && (
            <Box>
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ display: 'block', mb: 0.5 }}
              >
                {t('vocalsPlayerLabel')}
              </Typography>
              <Box
                component="audio"
                controls
                src={vocalsUrl}
                sx={{ width: '100%', display: 'block' }}
              />
            </Box>
          )}

          {processedAudioUrl && (
            <Box>
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ display: 'block', mb: 0.5 }}
              >
                {t('processedVocalsPlayerLabel')}
              </Typography>
              <Stack spacing={1}>
                <Button
                  size="small"
                  variant="text"
                  onClick={() => setShowSegmentPlayers((s) => !s)}
                  sx={{ mb: 0.5, textTransform: 'none', p: 0 }}
                >
                  {showSegmentPlayers ? t('hideSegments') : t('showSegments')}
                </Button>

                <SegmentPlayers
                  speechSegments={speechSegments}
                  segmentUrls={segmentUrls}
                  processedAudioUrl={processedAudioUrl}
                  show={showSegmentPlayers}
                  t={
                    t as unknown as (
                      key: string,
                      params?: Record<string, unknown>,
                    ) => string
                  }
                />
              </Stack>
            </Box>
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
                    value={Math.min(100, Math.max(0, item.progress))}
                  />
                </Box>
              ))}
            </Stack>
          )}

          {/* Raw transcript segments */}
          <Box>
            <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
              {t('segmentListLabel')}
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
                      key={`${index}-${chunk.processedTimestamp[0]}`}
                      disableGutters
                      sx={{ py: 0.25 }}
                    >
                      <ListItemText
                        primary={chunk.text.trim() || t('emptyChunk')}
                        secondary={
                          <>
                            <Typography
                              component="span"
                              variant="caption"
                              sx={{
                                fontFamily: 'monospace',
                                display: 'block',
                              }}
                            >
                              {t('timestampProcessedLabel')}:{' '}
                              {formatTimestamp(chunk.processedTimestamp[0])} —{' '}
                              {formatTimestamp(chunk.processedTimestamp[1])}
                            </Typography>
                            <Typography
                              component="span"
                              variant="caption"
                              sx={{
                                fontFamily: 'monospace',
                                display: 'block',
                                color: 'text.secondary',
                              }}
                            >
                              {t('timestampOriginalLabel')}:{' '}
                              {formatTimestamp(chunk.timestamp[0])} —{' '}
                              {formatTimestamp(chunk.timestamp[1])}
                            </Typography>
                          </>
                        }
                        primaryTypographyProps={{ variant: 'body2' }}
                        secondaryTypographyProps={{
                          variant: 'caption',
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

          {/* Full transcript */}
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

          {/* ---- Lyrics Adaptation Panel ---- */}
          <Divider />
          <Box>
            <Stack direction="row" alignItems="center" sx={{ mb: 1.5 }}>
              <Typography variant="subtitle2">
                {t('lyricsAdaptation.panelTitle')}
              </Typography>
              <Tooltip title={t('lyricsAdaptation.panelHelper')}>
                <HelpOutlineIcon
                  sx={{
                    fontSize: 15,
                    color: 'text.secondary',
                    ml: 0.75,
                    cursor: 'help',
                  }}
                />
              </Tooltip>
            </Stack>

            <Stack spacing={1.5}>
              <TextField
                label={t('lyricsAdaptation.lyricsInputLabel')}
                placeholder={t('lyricsAdaptation.lyricsInputPlaceholder')}
                multiline
                minRows={4}
                maxRows={10}
                fullWidth
                value={lyricsAdaptation.lyrics}
                onChange={(e) => lyricsAdaptation.setLyrics(e.target.value)}
                disabled={lyricsAdaptation.state.phase === 'adapting'}
                inputProps={{
                  'aria-label': t('lyricsAdaptation.lyricsInputLabel'),
                }}
              />

              <Stack direction="row" spacing={1} alignItems="center">
                <Tooltip
                  title={
                    !hasTranscriptChunks
                      ? t('lyricsAdaptation.adaptDisabledNoTranscript')
                      : !lyricsAdaptation.lyrics.trim()
                        ? t('lyricsAdaptation.adaptDisabledNoLyrics')
                        : ''
                  }
                >
                  <span>
                    <Button
                      variant="outlined"
                      size="small"
                      disabled={!canAdapt}
                      onClick={() => {
                        lyricsAdaptation.adapt(
                          transcriber.output?.chunks ?? [],
                        );
                      }}
                      startIcon={
                        isAdaptationBusy ? (
                          <CircularProgress size={14} color="inherit" />
                        ) : undefined
                      }
                    >
                      {isAdaptationBusy
                        ? t('lyricsAdaptation.adaptingButton')
                        : t('lyricsAdaptation.adaptButton')}
                    </Button>
                  </span>
                </Tooltip>

                {isAdaptationBusy && (
                  <Button
                    size="small"
                    variant="text"
                    color="warning"
                    onClick={lyricsAdaptation.cancel}
                  >
                    {t('lyricsAdaptation.cancelButton')}
                  </Button>
                )}

                {lyricsAdaptation.state.phase === 'done' && (
                  <Button
                    size="small"
                    variant="text"
                    onClick={lyricsAdaptation.reset}
                    disabled={isEditing}
                  >
                    {t('lyricsAdaptation.resetButton')}
                  </Button>
                )}
              </Stack>

              {/* Adaptation progress */}
              {lyricsAdaptation.state.phase === 'adapting' && (
                <Box>
                  <LinearProgress
                    variant={
                      lyricsAdaptation.state.total > 0
                        ? 'determinate'
                        : 'indeterminate'
                    }
                    value={
                      lyricsAdaptation.state.total > 0
                        ? (lyricsAdaptation.state.done /
                            lyricsAdaptation.state.total) *
                          100
                        : undefined
                    }
                  />
                </Box>
              )}

              {/* Error */}
              {lyricsAdaptation.state.phase === 'error' && (
                <Alert severity="error">
                  {t('lyricsAdaptation.adaptError', {
                    message: lyricsAdaptation.state.message,
                  })}
                </Alert>
              )}

              {/* Results */}
              {lyricsAdaptation.state.phase === 'done' && (
                <>
                  <Box
                    sx={{
                      border: '1px solid',
                      borderColor: 'divider',
                      borderRadius: 1,
                      maxHeight: 300,
                      overflowY: 'auto',
                      px: 1,
                      py: 0.5,
                    }}
                  >
                    <List dense disablePadding>
                      {lyricsAdaptation.state.results.map((item) => {
                        const isThisEditing = editingIndex === item.index;
                        return (
                          <ListItem
                            key={item.index}
                            disableGutters
                            sx={{ py: 0.5, alignItems: 'flex-start' }}
                            secondaryAction={
                              <Stack
                                direction="row"
                                spacing={0.5}
                                alignItems="center"
                              >
                                {isThisEditing ? (
                                  <>
                                    {/* Confirm edit */}
                                    <Tooltip
                                      title={t(
                                        'lyricsAdaptation.editConfirmTooltip',
                                      )}
                                    >
                                      <span>
                                        <IconButton
                                          size="small"
                                          aria-label={t(
                                            'lyricsAdaptation.editConfirmAriaLabel',
                                          )}
                                          disabled={!editingDraft.trim()}
                                          onClick={handleEditConfirm}
                                          sx={{
                                            color: 'success.main',
                                            '&:hover': {
                                              color: 'success.dark',
                                            },
                                          }}
                                        >
                                          <CheckIcon sx={{ fontSize: 16 }} />
                                        </IconButton>
                                      </span>
                                    </Tooltip>
                                    {/* Cancel edit */}
                                    <Tooltip
                                      title={t(
                                        'lyricsAdaptation.editCancelTooltip',
                                      )}
                                    >
                                      <span>
                                        <IconButton
                                          size="small"
                                          aria-label={t(
                                            'lyricsAdaptation.editCancelAriaLabel',
                                          )}
                                          onClick={handleEditCancel}
                                          sx={{
                                            color: 'text.secondary',
                                            '&:hover': { color: 'error.main' },
                                          }}
                                        >
                                          <CloseIcon sx={{ fontSize: 16 }} />
                                        </IconButton>
                                      </span>
                                    </Tooltip>
                                  </>
                                ) : (
                                  <>
                                    {/* Status chip */}
                                    <Chip
                                      size="small"
                                      label={t(
                                        `lyricsAdaptation.status.${item.status}` as Parameters<
                                          typeof t
                                        >[0],
                                      )}
                                      color={adaptationStatusColor(item.status)}
                                      sx={{ fontSize: '0.65rem', height: 20 }}
                                    />
                                    {/* Edit button */}
                                    <Tooltip
                                      title={t(
                                        'lyricsAdaptation.editChunkTooltip',
                                      )}
                                    >
                                      <span>
                                        <IconButton
                                          size="small"
                                          aria-label={t(
                                            'lyricsAdaptation.editChunkAriaLabel',
                                          )}
                                          disabled={adaptationControlsDisabled}
                                          onClick={() => {
                                            setEditingIndex(item.index);
                                            setEditingDraft(
                                              item.adaptedText || item.rawText,
                                            );
                                          }}
                                          sx={{
                                            color: 'text.secondary',
                                            '&:hover': {
                                              color: 'primary.main',
                                            },
                                          }}
                                        >
                                          <EditIcon sx={{ fontSize: 16 }} />
                                        </IconButton>
                                      </span>
                                    </Tooltip>
                                    {/* Delete button */}
                                    <Tooltip
                                      title={t(
                                        'lyricsAdaptation.deleteChunkTooltip',
                                      )}
                                    >
                                      <span>
                                        <IconButton
                                          size="small"
                                          aria-label={t(
                                            'lyricsAdaptation.deleteChunkAriaLabel',
                                          )}
                                          disabled={adaptationControlsDisabled}
                                          onClick={() =>
                                            handleDeleteChunk(item.index)
                                          }
                                          sx={{
                                            color: 'text.secondary',
                                            '&:hover': {
                                              color: 'error.main',
                                            },
                                          }}
                                        >
                                          <DeleteOutlineIcon
                                            sx={{ fontSize: 16 }}
                                          />
                                        </IconButton>
                                      </span>
                                    </Tooltip>
                                  </>
                                )}
                              </Stack>
                            }
                          >
                            <ListItemText
                              primary={
                                isThisEditing ? (
                                  <TextField
                                    size="small"
                                    fullWidth
                                    value={editingDraft}
                                    onChange={(e) =>
                                      setEditingDraft(e.target.value)
                                    }
                                    onKeyDown={(e) => {
                                      if (
                                        e.key === 'Enter' &&
                                        editingDraft.trim()
                                      ) {
                                        handleEditConfirm();
                                      }
                                      if (e.key === 'Escape') {
                                        handleEditCancel();
                                      }
                                    }}
                                    autoFocus
                                    inputProps={{
                                      'aria-label': t(
                                        'lyricsAdaptation.editChunkAriaLabel',
                                      ),
                                    }}
                                    sx={{ pr: 9 }}
                                  />
                                ) : (
                                  item.adaptedText || item.rawText
                                )
                              }
                              secondary={
                                <>
                                  <Typography
                                    component="span"
                                    variant="caption"
                                    sx={{
                                      fontFamily: 'monospace',
                                      display: 'block',
                                    }}
                                  >
                                    {formatTimestamp(item.timestamp[0])} —{' '}
                                    {formatTimestamp(item.timestamp[1])}
                                  </Typography>
                                  {item.status !== 'unmatched' &&
                                    item.rawText !== item.adaptedText && (
                                      <Typography
                                        component="span"
                                        variant="caption"
                                        sx={{
                                          color: 'text.disabled',
                                          display: 'block',
                                          fontStyle: 'italic',
                                        }}
                                      >
                                        {t('lyricsAdaptation.rawLabel')}:{' '}
                                        {item.rawText}
                                      </Typography>
                                    )}
                                </>
                              }
                              primaryTypographyProps={{
                                variant: 'body2',
                                component: 'div' as React.ElementType,
                              }}
                            />
                          </ListItem>
                        );
                      })}
                    </List>
                  </Box>
                </>
              )}
            </Stack>
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
