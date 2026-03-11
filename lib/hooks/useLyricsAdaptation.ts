'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import type {
  AdaptedChunk,
  LyricsAdapterRequest,
  LyricsAdapterResponse,
} from '@/lib/transcription/lyricsAdapter';
import type { TranscriptChunk } from '@/lib/transcription/types';

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
  /** Start adapting. Synchronous — posts a message to the worker. */
  adapt: (chunks: TranscriptChunk[], skipLLM?: boolean) => void;
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
 */
export function useLyricsAdaptation(): UseLyricsAdaptationReturn {
  const [lyrics, setLyrics] = useState('');
  const [state, setState] = useState<LyricsAdaptationState>({ phase: 'idle' });

  const workerRef = useRef<Worker | null>(null);
  /** Incremented on every new job and every cancel/reset to filter stale messages. */
  const jobIdRef = useRef(0);

  /** Lazily creates the worker and wires the message handler exactly once. */
  const getWorker = useCallback((): Worker => {
    if (!workerRef.current) {
      const w = createWorker();
      workerRef.current = w;

      w.onmessage = (event: MessageEvent<LyricsAdapterResponse>): void => {
        const msg = event.data;

        // 'cancelled' has no jobId  state was already set by cancel/reset.
        if (msg.type === 'cancelled') return;

        // Discard stale messages from previous jobs.
        if ('jobId' in msg && msg.jobId !== jobIdRef.current) return;

        switch (msg.type) {
          case 'model-progress':
            setState({
              phase: 'loading-model',
              progress: msg.progress,
              modelStatus: msg.status,
            });
            break;
          case 'chunk-done':
            setState({ phase: 'adapting', done: msg.done, total: msg.total });
            break;
          case 'complete':
            setState({ phase: 'done', results: msg.results });
            break;
          case 'error':
            setState({ phase: 'error', message: msg.message });
            break;
        }
      };

      w.onerror = (err: ErrorEvent): void => {
        setState({ phase: 'error', message: err.message ?? 'Worker error' });
      };
    }

    return workerRef.current;
  }, []);

  // Terminate the worker when the component unmounts.
  useEffect(() => {
    return (): void => {
      workerRef.current?.terminate();
    };
  }, []);

  const cancel = useCallback((): void => {
    const worker = workerRef.current;
    if (!worker) return;
    jobIdRef.current += 1;
    worker.postMessage({ type: 'cancel' } satisfies LyricsAdapterRequest);
    setState({ phase: 'idle' });
  }, []);

  const reset = useCallback((): void => {
    const worker = workerRef.current;
    if (worker) {
      jobIdRef.current += 1;
      worker.postMessage({ type: 'cancel' } satisfies LyricsAdapterRequest);
    }
    setState({ phase: 'idle' });
  }, []);

  const adapt = useCallback(
    (chunks: TranscriptChunk[], skipLLM = false): void => {
      const worker = getWorker();
      const jobId = jobIdRef.current + 1;
      jobIdRef.current = jobId;

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

  return { lyrics, setLyrics, state, adapt, cancel, reset };
}
