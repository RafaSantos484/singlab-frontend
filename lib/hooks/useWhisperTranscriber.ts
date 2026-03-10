'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { DEFAULT_TRANSCRIPTION_SETTINGS } from '@/lib/transcription/constants';
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
} from '@/lib/transcription/types';

/**
 * Removes chunks whose start timestamp regresses below the highest end time
 * seen so far. This eliminates duplicate/repeated segments produced when
 * Whisper backtracks over already-transcribed audio.
 */
function filterBacktrackingChunks(
  chunks: TranscriptChunk[],
): TranscriptChunk[] {
  let maxEndTime = -1;

  return chunks.filter((chunk) => {
    const start = chunk.timestamp[0];

    if (start < maxEndTime) {
      return false;
    }

    const end = chunk.timestamp[1];
    if (end !== null && end > maxEndTime) {
      maxEndTime = end;
    }

    return true;
  });
}

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
  setSubtask: (subtask: 'transcribe' | 'translate') => void;
  setLanguage: (language: string) => void;
  start: (processedAudio: Float32Array, speechSegments: SpeechSegment[]) => void;
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
 * language and task (transcribe or translate).
 *
 * **Silence-removal pipeline:**
 * The caller (e.g. TranscriptionDialog) is responsible for running FFmpeg
 * silence removal before calling `start()`. The hook receives the processed
 * audio and a speech segment cut map. After the worker returns word-level
 * timestamps relative to the processed audio, the hook automatically:
 * 1. Remaps them back to the original vocals timeline using the cut map.
 * 2. Filters out any backtracking chunks — segments whose start timestamp
 *    regresses below the highest end time seen so far — to eliminate
 *    duplicates produced when Whisper re-processes already-transcribed audio.
 *
 * **States:**
 * - `isBusy` — transcription is running
 * - `isModelLoading` — model is downloading and initializing
 * - `isStopping` — graceful stop in progress
 * - `progressItems` — array of model/inference progress events
 * - `output` — transcript with timestamps remapped to the original audio
 * - `settings` — model, quantization, language, task configuration
 *
 * **Controls:**
 * - `start(processedAudio, speechSegments)` — begin transcription on
 *   silence-removed audio with its corresponding cut map
 * - `stop()` — gracefully halt transcription; worker disposes pipeline
 * - `reset()` — clear output and progress; ready for new session
 * - `setModel/setMultilingual/setQuantized/setLanguage/setSubtask` — configure
 *
 * **Pending Activity:**
 * Calls `startPendingActivity()` during transcription to integrate with
 * navigation guards (prevents leaving page mid-transcription).
 *
 * @returns Hook result with state, controls, and settings setter functions.
 */
export function useWhisperTranscriber(): UseWhisperTranscriberResult {
  const workerRef = useRef<Worker | null>(null);
  const speechSegmentsRef = useRef<SpeechSegment[]>([]);

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
        case 'update':
          setOutput({
            isBusy: true,
            text: message.data[0],
            chunks: message.data[1].chunks,
          });
          break;
        case 'complete': {
          const remapped = remapWordTimestamps(
            message.data.chunks,
            speechSegmentsRef.current,
          );
          const filtered = filterBacktrackingChunks(remapped);
          setOutput({
            isBusy: false,
            text: filtered.map((c) => c.text).join(''),
            chunks: filtered,
          });
          setIsBusy(false);
          endPendingActivity();
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
        case 'error':
          setIsBusy(false);
          setIsModelLoading(false);
          setError(message.data.message ?? '');
          endPendingActivity();
          break;
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
    [endPendingActivity],
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
      subtask: value ? previous.subtask : 'transcribe',
      language: value ? previous.language : 'auto',
    }));
  }, []);

  const setQuantized = useCallback((value: boolean): void => {
    setSettings((previous) => ({
      ...previous,
      quantized: value,
    }));
  }, []);

  const setSubtask = useCallback(
    (subtask: 'transcribe' | 'translate'): void => {
      setSettings((previous) => ({
        ...previous,
        subtask,
      }));
    },
    [],
  );

  const setLanguage = useCallback((language: string): void => {
    setSettings((previous) => ({
      ...previous,
      language,
    }));
  }, []);

  const start = useCallback(
    (processedAudio: Float32Array, speechSegments: SpeechSegment[]): void => {
      const worker = workerRef.current ?? createAndBindWorker();

      speechSegmentsRef.current = speechSegments;
      setOutput(undefined);
      setError(null);
      setIsBusy(true);
      beginPendingActivity();

      worker.postMessage({
        audio: processedAudio,
        model: settings.model,
        multilingual: settings.multilingual,
        quantized: settings.quantized,
        subtask: settings.multilingual ? settings.subtask : null,
        language:
          settings.multilingual && settings.language !== 'auto'
            ? settings.language
            : null,
      } satisfies WorkerRequest);
    },
    [beginPendingActivity, createAndBindWorker, settings],
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
      setSubtask,
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
      setSubtask,
      settings,
      start,
      stop,
    ],
  );
}
