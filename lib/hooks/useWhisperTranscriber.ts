'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import enUSMessages from '@/messages/en-US.json';

import { DEFAULT_TRANSCRIPTION_SETTINGS } from '@/lib/transcription/constants';
import { TRANSCRIPTION_SAMPLE_RATE } from '@/lib/transcription/constants';
import { startPendingActivity } from '@/lib/async/pendingActivity';
import type { SpeechSegment } from '@/lib/audio/ffmpegVocals';
import { remapWordTimestamps } from '@/lib/audio/timestampRemap';
import type {
  TranscriptChunk,
  TranscriptionOutput,
  TranscriptionProgressItem,
  WorkerRequest,
  TranscriptionSettings,
  WorkerMessage,
  WorkerTranscriptionCompleteMessage,
  WorkerErrorMessage,
} from '@/lib/transcription/types';

/**
 * Removes chunks whose start timestamp regresses below the highest end time
 * seen so far. This eliminates duplicate/repeated segments produced when
 * Whisper backtracks over already-transcribed audio.
 */
// Backtracking filter removed (unused in current flow).

interface UseWhisperTranscriberResult {
  isBusy: boolean;
  isModelLoading: boolean;
  isStopping: boolean;
  progressItems: TranscriptionProgressItem[];
  output: TranscriptionOutput | undefined;
  error: string | null;
  settings: TranscriptionSettings;
  setModel: (model: string) => void;
  setMultilingual: (value: boolean) => void;
  setQuantized: (value: boolean) => void;
  // `subtask` removed — transcription always uses 'transcribe'
  setLanguage: (language: string) => void;
  start: (
    processedAudio: Float32Array,
    speechSegments: SpeechSegment[],
  ) => void;
  stop: () => Promise<void>;
  reset: () => void;
}

function createWorker(): Worker {
  return new Worker(
    new URL('../transcription/loader.worker.ts', import.meta.url),
    {
      type: 'module',
    },
  );
}

/**
 * Hook that manages OpenAI Whisper transcription via a Web Worker.
 *
 * Handles model loading (quantized or full precision), inference on
 * silence-removed audio, streaming progress updates, and incremental
 * transcript chunks. Supports multilingual transcription with configurable
 * language.
 *
 * Notes:
 * - This hook implements a per-segment transcription flow: the caller
 *   provides processed (silence-removed) audio and an array of speech
 *   segments. Each segment is sent to the worker independently and the
 *   hook assembles the final transcript from per-segment completions.
 * - The previous `subtask`/translate option has been removed; the app
 *   performs transcription-only per segment.
 */
export function useWhisperTranscriber(): UseWhisperTranscriberResult {
  const t = useTranslations('Transcription');

  // Safe translation helper: attempt to translate via `t`, otherwise fall
  // back to the English messages bundle and finally to a simple fallback
  // string. This prevents exceptions when a locale is missing a key.
  const safeT = useCallback(
    (key: string, params?: Record<string, unknown>): string => {
      try {
        const translated = t(key as unknown as Parameters<typeof t>[0], params as unknown as Parameters<typeof t>[1]);
        if (typeof translated === 'string' && translated !== key) {
          return translated;
        }
      } catch {
        // ignore and fallback
      }

      // Fallback to English messages bundle
      try {
        const parts = key.split('.');
        let cur: unknown = (enUSMessages as unknown as Record<string, unknown>)['Transcription'];
        for (const p of parts) {
          if (!cur || typeof cur !== 'object') break;
          cur = (cur as Record<string, unknown>)[p];
        }
        if (typeof cur === 'string') {
          if (params && typeof params === 'object') {
            return Object.keys(params).reduce((acc, k) => {
              const v = (params as Record<string, unknown>)[k];
              return acc.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
            }, cur);
          }
          return cur;
        }
      } catch {
        // ignore
      }

      // Final generic fallback
      const suggestion = params && (params as Record<string, unknown>)['suggestion'];
      if (suggestion) {
        return `The model failed to run due to insufficient memory. Try a lighter model (e.g., ${String(suggestion)}) or enable quantized mode.`;
      }
      return 'The model failed to run due to insufficient memory. Try a lighter model or enable quantized mode.';
    },
    [t],
  );
  const workerRef = useRef<Worker | null>(null);
  const speechSegmentsRef = useRef<SpeechSegment[]>([]);
  // Pending resolvers for per-segment transcription results.
  const pendingSegmentResolversRef = useRef<Map<number, (text: string) => void>>(new Map());

  const [output, setOutput] = useState<TranscriptionOutput | undefined>(
    undefined,
  );
  const [isBusy, setIsBusy] = useState(false);
  const [isModelLoading, setIsModelLoading] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const [progressItems, setProgressItems] = useState<
    TranscriptionProgressItem[]
  >([]);
  const [error, setError] = useState<string | null>(null);
  const pendingFinishRef = useRef<(() => void) | null>(null);

  const [settings, setSettings] = useState<TranscriptionSettings>(
    DEFAULT_TRANSCRIPTION_SETTINGS,
  );

  const beginPendingActivity = useCallback((): void => {
    if (pendingFinishRef.current) {
      return;
    }

    pendingFinishRef.current = startPendingActivity();
  }, []);

  const endPendingActivity = useCallback((): void => {
    pendingFinishRef.current?.();
    pendingFinishRef.current = null;
  }, []);

  const handleWorkerMessage = useCallback(
    (event: MessageEvent<WorkerMessage>): void => {
      const message = event.data;

      switch (message.status) {
        case 'progress':
          setProgressItems((previous) =>
            previous.map((item) => {
              if (item.file !== message.file) {
                return item;
              }

              return {
                ...item,
                progress: message.progress ?? item.progress,
                loaded: message.loaded ?? item.loaded,
                total: message.total ?? item.total,
                status: message.status,
              };
            }),
          );
          break;
        case 'update': {
          // Legacy streaming update: contains timestamped chunks relative to
          // the processed audio. Preserve existing behavior for backward
          // compatibility.
          const processedChunks = message.data[1].chunks;
          if (processedChunks && processedChunks.length > 0) {
            const remapped = remapWordTimestamps(
              processedChunks,
              speechSegmentsRef.current,
            );
            const enriched = processedChunks.map((pc, i) => ({
              text: pc.text,
              processedTimestamp: pc.timestamp,
              timestamp: remapped[i].timestamp,
            }));

            setOutput({
              isBusy: true,
              text: message.data[0],
              chunks: enriched,
            });
          }
          break;
        }
        case 'complete': {
          // Per-segment completion: worker returns `{ text, segmentIndex }`.
          // Resolve the pending promise created in `start()` so that the
          // sequential transcription loop can continue and assemble chunks
          // using the silence map timestamps.
          const completeMsg = message as WorkerTranscriptionCompleteMessage;
          const idx = completeMsg.data.segmentIndex;
          const text = completeMsg.data.text;
          const resolver = pendingSegmentResolversRef.current.get(idx);
          if (resolver) {
            resolver(text);
            pendingSegmentResolversRef.current.delete(idx);
          }
          break;
        }
        case 'initiate':
          setIsModelLoading(true);
          setProgressItems((previous) => [
            ...previous,
            {
              file: message.file,
              name: message.name,
              loaded: message.loaded ?? 0,
              progress: message.progress ?? 0,
              total: message.total ?? 0,
              status: message.status,
            },
          ]);
          break;
        case 'done':
          setProgressItems((previous) =>
            previous.filter((item) => item.file !== message.file),
          );
          break;
        case 'ready':
          setIsModelLoading(false);
          break;
        case 'error': {
          setIsBusy(false);
          setIsModelLoading(false);
          try {
            const errMsg = (message as WorkerErrorMessage).data?.message ?? '';
            const lower = String(errMsg).toLowerCase();
            // Detect common out-of-memory signatures reported by Xenova/ONNX runtime
            if (
              lower.includes('error code = 6') ||
              lower.includes('bad_alloc') ||
              lower.includes('out-of-memory') ||
              lower.includes('out of memory') ||
              lower.includes('ortrun')
            ) {
              // Suggest a lighter model to the user via safe translation.
              setError(safeT('errors.modelOOM', { suggestion: 'Xenova/whisper-base' }));
            } else {
              // Use safe translate for generic transcription errors when
              // possible; otherwise fall back to the raw message.
              try {
                setError(safeT('errors.transcription', { message: errMsg }));
              } catch {
                setError(errMsg || '');
              }
            }
          } catch {
            setError('');
          }
          endPendingActivity();
          break;
        }
        case 'stopped':
          setIsBusy(false);
          setIsModelLoading(false);
          setIsStopping(false);
          endPendingActivity();
          break;
        default:
          break;
      }
    },
    [endPendingActivity, safeT],
  );

  const createAndBindWorker = useCallback((): Worker => {
    const worker = createWorker();
    worker.addEventListener('message', handleWorkerMessage);
    workerRef.current = worker;
    return worker;
  }, [handleWorkerMessage]);

  const terminateWorker = useCallback((): void => {
    const worker = workerRef.current;
    if (!worker) {
      return;
    }

    worker.removeEventListener('message', handleWorkerMessage);
    worker.terminate();
    workerRef.current = null;
  }, [handleWorkerMessage]);

  const stop = useCallback(async (): Promise<void> => {
    const worker = workerRef.current;

    if (!worker) {
      setIsBusy(false);
      setIsModelLoading(false);
      setIsStopping(false);
      endPendingActivity();
      return;
    }

    setIsStopping(true);

    await new Promise<void>((resolve) => {
      const done = (): void => {
        worker.removeEventListener('message', handleStopAck);
        resolve();
      };

      const timeout = window.setTimeout(() => {
        done();
      }, 3000);

      const handleStopAck = (event: MessageEvent<WorkerMessage>): void => {
        if (event.data.status !== 'stopped') {
          return;
        }

        window.clearTimeout(timeout);
        done();
      };

      worker.addEventListener('message', handleStopAck);
      worker.postMessage({ action: 'stop' } satisfies WorkerRequest);
    });

    terminateWorker();
    setIsBusy(false);
    setIsModelLoading(false);
    setIsStopping(false);
    setProgressItems([]);
    endPendingActivity();
  }, [endPendingActivity, terminateWorker]);

  useEffect(() => {
    return () => {
      terminateWorker();
      endPendingActivity();
    };
  }, [endPendingActivity, terminateWorker]);

  const setModel = useCallback((model: string): void => {
    setSettings((previous) => ({
      ...previous,
      model,
    }));
  }, []);

  const setMultilingual = useCallback((value: boolean): void => {
    setSettings((previous) => ({
      ...previous,
      multilingual: value,
      language: value ? previous.language : 'auto',
    }));
  }, []);

  const setQuantized = useCallback((value: boolean): void => {
    setSettings((previous) => ({
      ...previous,
      quantized: value,
    }));
  }, []);

  const setLanguage = useCallback((language: string): void => {
    setSettings((previous) => ({
      ...previous,
      language,
    }));
  }, []);

  const start = useCallback(
    (processedAudio: Float32Array, speechSegments: SpeechSegment[]): void => {
      const worker = workerRef.current ?? createAndBindWorker();

      // Keep only true speech segments for transcription — ignore kept
      // normalized silences which are not meaningful to transcribe.
      const speechOnly = speechSegments.filter((s) => s.type === 'speech');
      speechSegmentsRef.current = speechOnly;
      // Also keep lastSpeechSegments for the UI (dialog)
      // Note: we store the original order indexes mapping so the dialog can
      // show players in the same order.
      // (TranscriptionDialog maintains its own copy via setSpeechSegments.)
      setOutput(undefined);
      setError(null);
      setIsBusy(true);
      beginPendingActivity();

      // Sequentially transcribe each speech segment using per-segment
      // worker requests. Whisper is treated as text-only per segment and
      // the silence map is used as the timing source of truth.
      (async () => {
        const sr = TRANSCRIPTION_SAMPLE_RATE;
        const chunks: TranscriptChunk[] = [];

        for (let i = 0; i < speechOnly.length; i++) {
          const seg = speechOnly[i];
          // Convert processedStart/end (seconds) to sample indices.
          const startSample = Math.max(0, Math.floor(seg.processedStart * sr));
          const endSample = Math.max(startSample, Math.floor(seg.processedEnd * sr));
          const segmentAudio = processedAudio.slice(startSample, endSample);

          // Prepare a promise that resolves when the worker returns the
          // per-segment completion message with `segmentIndex`.
          const textPromise = new Promise<string>((resolve) => {
            pendingSegmentResolversRef.current.set(i, resolve);
          });

          // Post transcription request for this segment.
          // Transfer the underlying ArrayBuffer to the worker to avoid
          // copying large Float32Array buffers on each segment.
          worker.postMessage({
            audio: segmentAudio,
            model: settings.model,
            multilingual: settings.multilingual,
            quantized: settings.quantized,
            language:
              settings.multilingual && settings.language !== 'auto'
                ? settings.language
                : null,
            segmentIndex: i,
          } satisfies WorkerRequest, [segmentAudio.buffer]);

          // Await result and build a chunk using the silence map timings.
          const text = await textPromise;
          const chunk = {
            text,
            processedTimestamp: [seg.processedStart, seg.processedEnd] as [number, number | null],
            timestamp: [seg.originalStart, seg.originalEnd] as [number, number | null],
          };
          chunks.push(chunk);

          // Update intermediate UI progressively so users see partial results.
          setOutput({ isBusy: true, text: chunks.map((c) => c.text).join(''), chunks });
        }

        // Finalize
        setOutput({ isBusy: false, text: chunks.map((c) => c.text).join(''), chunks });
        setIsBusy(false);
        endPendingActivity();
      })();
    },
    [beginPendingActivity, createAndBindWorker, settings, endPendingActivity],
  );

  const reset = useCallback((): void => {
    void stop();
    setOutput(undefined);
    setError(null);
  }, [stop]);

  return useMemo(
    () => ({
      isBusy,
      isModelLoading,
      isStopping,
      progressItems,
      output,
      error,
      settings,
      setModel,
      setMultilingual,
      setQuantized,
      setLanguage,
      start,
      stop,
      reset,
    }),
    [
      error,
      isBusy,
      isModelLoading,
      isStopping,
      output,
      progressItems,
      reset,
      setLanguage,
      setModel,
      setMultilingual,
      setQuantized,
      settings,
      start,
      stop,
    ],
  );
}
