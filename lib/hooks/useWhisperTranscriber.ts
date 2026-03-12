'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

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
    // Prefer the remapped/original timeline for backtracking detection.
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
  // Pending resolvers for per-segment transcription results.
  const pendingSegmentResolversRef = useRef<Map<number, (text: string) => void>>(new Map());
  // Keep the last speech segments so the dialog can render per-segment players.
  const lastSpeechSegmentsRef = useRef<SpeechSegment[]>([]);

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
            if (message.status === 'complete') {
              const data = message.data as any;
              const idx = data.segmentIndex as number;
              const text = data.text as string;
              const resolver = pendingSegmentResolversRef.current.get(idx);
              if (resolver) {
                resolver(text);
                pendingSegmentResolversRef.current.delete(idx);
              }
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
        const chunks: any[] = [];

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
          worker.postMessage({
            audio: segmentAudio,
            model: settings.model,
            multilingual: settings.multilingual,
            quantized: settings.quantized,
            subtask: settings.multilingual ? settings.subtask : null,
            language:
              settings.multilingual && settings.language !== 'auto'
                ? settings.language
                : null,
            segmentIndex: i,
          } satisfies WorkerRequest);

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
