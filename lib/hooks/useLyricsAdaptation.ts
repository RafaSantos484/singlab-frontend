'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  AdaptedChunk,
  LyricsAdapterRequest,
  LyricsAdapterResponse,
} from '@/lib/transcription/lyricsAdapter';
import type { TranscriptChunk } from '@/lib/transcription/types';
import { startPendingActivity } from '@/lib/async/pendingActivity';

export type LyricsAdaptationState =
  | { phase: 'idle' }
  | { phase: 'adapting'; done: number; total: number }
  | { phase: 'loading-model'; progress: number; modelStatus: string }
  | { phase: 'done'; results: AdaptedChunk[] }
  | { phase: 'error'; message: string };

interface UseLyricsAdaptationReturn {
  lyrics: string;
  setLyrics: (text: string) => void;
  state: LyricsAdaptationState;
  /** Index of the chunk currently being retried, or null. */
  retryingIndex: number | null;
  /**
   * Error from the most recent retry attempt, if any.
   * Unlike `state.phase === 'error'`, this does NOT replace the results list —
   * it is shown alongside the existing results. Cleared on the next retry.
   */
  retryError: string | null;
  /** Start adapting. Synchronous — posts a message to the worker. */
  adapt: (chunks: TranscriptChunk[], skipLLM?: boolean) => void;
  /**
   * Retry a single chunk with an escalated prompt.
   * Increments `retryCount` on the existing result.
   */
  retryChunk: (chunk: AdaptedChunk) => void;
  /** Cancel an in-progress adaptation and return to idle. */
  cancel: () => void;
  /** Clear adaptation results and return to idle. */
  reset: () => void;
}

function createWorker(): Worker {
  return new Worker(
    new URL('../transcription/lyricsAdapter.worker.ts', import.meta.url),
    { type: 'module' },
  );
}

/**
 * Manages the lyrics text input and the lyrics-adaptation Web Worker lifecycle.
 *
 * The heavy work (Flan-T5 LLM inference) runs in `lyricsAdapter.worker.ts` so
 * the main thread stays responsive. A monotonically-increasing `jobIdRef`
 * ensures stale messages from cancelled or superseded jobs are silently
 * discarded before they can mutate state.
 *
 * `retryChunk` posts a `retry-chunk` message to the worker, uses
 * `startPendingActivity` to block page navigation for the duration, and patches
 * the specific result in the `done` state when the worker responds with
 * `retry-chunk-done`.
 */
export function useLyricsAdaptation(): UseLyricsAdaptationReturn {
  const [lyrics, setLyrics] = useState('');
  const [state, setState] = useState<LyricsAdaptationState>({ phase: 'idle' });
  /**
   * Index of the chunk currently being retried.
   * `null` when no retry is in progress.
   */
  const [retryingIndex, setRetryingIndex] = useState<number | null>(null);
  /**
   * Non-null when a single-chunk retry produced an error.
   * Unlike a batch adaptation error, this does not overwrite the results list.
   */
  const [retryError, setRetryError] = useState<string | null>(null);

  const workerRef = useRef<Worker | null>(null);
  /** Incremented on every new job and every cancel/reset to filter stale messages. */
  const jobIdRef = useRef(0);
  /** Finish function returned by startPendingActivity during a retry. */
  const retryPendingFinishRef = useRef<(() => void) | null>(null);
  /**
   * Ref-based mirror of `retryingIndex !== null`, used inside the `onmessage`
   * closure where React state is stale due to closure capture.
   */
  const isRetryingRef = useRef(false);

  /** Lazily creates the worker and wires the message handler exactly once. */
  const getWorker = useCallback((): Worker => {
    if (!workerRef.current) {
      const w = createWorker();
      workerRef.current = w;

      w.onmessage = (event: MessageEvent<LyricsAdapterResponse>): void => {
        const msg = event.data;

        // 'cancelled' has no jobId — state was already set by cancel/reset.
        if (msg.type === 'cancelled') return;

        // Discard stale messages from previous jobs.
        if ('jobId' in msg && msg.jobId !== jobIdRef.current) return;

        switch (msg.type) {
          case 'model-progress':
            // While a single-chunk retry is loading the model, suppress the
            // 'loading-model' state transition to preserve the visible results list.
            if (!isRetryingRef.current) {
              setState({
                phase: 'loading-model',
                progress: msg.progress,
                modelStatus: msg.status,
              });
            }
            break;

          case 'chunk-done':
            setState({ phase: 'adapting', done: msg.done, total: msg.total });
            break;

          case 'retry-chunk-done': {
            console.debug(
              `[useLyricsAdaptation] retry-chunk-done received — index=${msg.result.index} ` +
                `status=${msg.result.status} score=${msg.result.score.toFixed(3)}`,
            );
            // Finish pending activity guard.
            retryPendingFinishRef.current?.();
            retryPendingFinishRef.current = null;
            isRetryingRef.current = false;
            setRetryingIndex(null);
            // Patch the specific result inside the done state.
            setState((prev) => {
              if (prev.phase !== 'done') return prev;
              const next = prev.results.map((r) =>
                r.index === msg.result.index ? msg.result : r,
              );
              return { phase: 'done', results: next };
            });
            break;
          }

          case 'complete':
            setState({ phase: 'done', results: msg.results });
            break;

          case 'error':
            retryPendingFinishRef.current?.();
            retryPendingFinishRef.current = null;
            if (isRetryingRef.current) {
              // Retry-specific error: preserve the existing results list.
              isRetryingRef.current = false;
              setRetryingIndex(null);
              setRetryError(msg.message);
            } else {
              setState({ phase: 'error', message: msg.message });
            }
            break;
        }
      };

      w.onerror = (err: ErrorEvent): void => {
        retryPendingFinishRef.current?.();
        retryPendingFinishRef.current = null;
        if (isRetryingRef.current) {
          // Worker crashed during a retry: preserve the existing results list.
          isRetryingRef.current = false;
          setRetryingIndex(null);
          setRetryError(err.message ?? 'Worker error');
        } else {
          setState({ phase: 'error', message: err.message ?? 'Worker error' });
        }
      };
    }
    return workerRef.current;
  }, []);

  // Terminate the worker when the component unmounts.
  useEffect(() => {
    return (): void => {
      retryPendingFinishRef.current?.();
      isRetryingRef.current = false;
      workerRef.current?.terminate();
    };
  }, []);

  const cancel = useCallback((): void => {
    const worker = workerRef.current;
    if (!worker) return;
    jobIdRef.current += 1;
    worker.postMessage({ type: 'cancel' } satisfies LyricsAdapterRequest);
    retryPendingFinishRef.current?.();
    retryPendingFinishRef.current = null;
    isRetryingRef.current = false;
    setRetryingIndex(null);
    setState({ phase: 'idle' });
  }, []);

  const reset = useCallback((): void => {
    const worker = workerRef.current;
    if (worker) {
      jobIdRef.current += 1;
      worker.postMessage({ type: 'cancel' } satisfies LyricsAdapterRequest);
    }
    retryPendingFinishRef.current?.();
    retryPendingFinishRef.current = null;
    isRetryingRef.current = false;
    setRetryingIndex(null);
    setRetryError(null);
    setState({ phase: 'idle' });
  }, []);

  const adapt = useCallback(
    (chunks: TranscriptChunk[], skipLLM = false): void => {
      const worker = getWorker();
      const jobId = jobIdRef.current + 1;
      jobIdRef.current = jobId;

      setRetryError(null);
      const total = chunks.filter((c) => c.text.trim().length > 0).length;
      setState({ phase: 'adapting', done: 0, total });

      worker.postMessage({
        type: 'adapt',
        jobId,
        chunks,
        lyrics,
        skipLLM,
      } satisfies LyricsAdapterRequest);
    },
    [getWorker, lyrics],
  );

  const retryChunk = useCallback(
    (chunk: AdaptedChunk): void => {
      console.debug(
        `[useLyricsAdaptation] retryChunk — index=${chunk.index} ` +
          `currentRetryCount=${chunk.retryCount} rawText="${chunk.rawText}"`,
      );

      const worker = getWorker();
      const jobId = jobIdRef.current + 1;
      jobIdRef.current = jobId;

      // Block page navigation for the duration of the retry.
      retryPendingFinishRef.current?.();
      retryPendingFinishRef.current = startPendingActivity();

      isRetryingRef.current = true;
      setRetryError(null);
      setRetryingIndex(chunk.index);

      worker.postMessage({
        type: 'retry-chunk',
        jobId,
        index: chunk.index,
        rawText: chunk.rawText,
        timestamp: chunk.timestamp,
        lyrics,
        retryCount: chunk.retryCount + 1,
      } satisfies LyricsAdapterRequest);
    },
    [getWorker, lyrics],
  );

  return {
    lyrics,
    setLyrics,
    state,
    retryingIndex,
    retryError,
    adapt,
    retryChunk,
    cancel,
    reset,
  };
}
