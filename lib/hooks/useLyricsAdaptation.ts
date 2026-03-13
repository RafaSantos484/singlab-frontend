'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  buildBoundedLyricScope,
  findNextResolved,
  findPrevResolved,
  isResolvedChunk,
  parseLyricsLines,
  type AdaptedChunk,
  type LyricsAdapterRequest,
  type LyricsAdapterResponse,
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
  /** Index of the chunk currently being retried (manual or auto), or null. */
  retryingIndex: number | null;
  /**
   * True while the automatic post-pass retry loop is running over unmatched
   * segments. Cleared when the loop converges or exhausts all segments.
   */
  isAutoRetrying: boolean;
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
  /** Directly overwrite the adaptedText of a result in the done state. */
  editChunk: (index: number, newText: string) => void;
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
 * After the initial adaptation pass completes, an automatic iterative retry
 * loop runs over any segments still marked `unmatched`. Each segment is
 * retried with a narrowed lyric scope derived from the nearest resolved
 * neighbours (matched/corrected/user-edited). The loop repeats until no
 * unmatched segment is newly resolved in a round, or all segments are resolved.
 *
 * `retryChunk` posts a `retry-chunk` message to the worker for a single manual
 * retry, uses `startPendingActivity` to block page navigation, and patches the
 * specific result in the `done` state on `retry-chunk-done`.
 */
export function useLyricsAdaptation(): UseLyricsAdaptationReturn {
  const [lyrics, setLyrics] = useState('');
  const [state, setState] = useState<LyricsAdaptationState>({ phase: 'idle' });
  /**
   * Index of the chunk currently being retried (manual or auto), or null.
   */
  const [retryingIndex, setRetryingIndex] = useState<number | null>(null);
  /**
   * True while the automatic post-pass retry loop is running.
   */
  const [isAutoRetrying, setIsAutoRetrying] = useState(false);
  /**
   * Non-null when a retry attempt produced an error.
   * Does not replace the results list; shown alongside it.
   */
  const [retryError, setRetryError] = useState<string | null>(null);

  /**
   * Captures the lyrics string at the moment `adapt` is called so that the
   * auto-retry coordinator always uses the same lyrics as the initial pass,
   * even if the user edits the textarea afterwards.
   * Updated inside `adapt` (not during render).
   */
  const adaptedLyricsRef = useRef('');
  /**
   * Mirror of the most-recent `done` results array.
   * Updated whenever results change (complete, retry-chunk-done, editChunk)
   * so that `retryChunk` can compute bounded lyric scope without reading stale
   * React state inside a callback closure.
   */
  const latestResultsRef = useRef<AdaptedChunk[]>([]);

  const workerRef = useRef<Worker | null>(null);
  /** Incremented on every new job and every cancel/reset to filter stale messages. */
  const jobIdRef = useRef(0);
  /** Finish function returned by startPendingActivity during a manual retry. */
  const retryPendingFinishRef = useRef<(() => void) | null>(null);
  /**
   * Ref mirror of `retryingIndex !== null` / `isAutoRetrying`, used inside
   * the `onmessage` closure to suppress `loading-model` state transitions while
   * any retry (manual or automatic) is in progress.
   */
  const isRetryingRef = useRef(false);

  // ── Auto-retry coordinator refs ──────────────────────────────────────────
  /** True while the automatic retry loop is running. */
  const isAutoRetryingRef = useRef(false);
  /** Remaining segments to dispatch in the current auto-retry round. */
  const autoRetryQueueRef = useRef<AdaptedChunk[]>([]);
  /** Number of newly resolved segments in the current round. */
  const autoRetryRoundResolvedRef = useRef(0);
  /**
   * Snapshot of all results, kept in sync as auto-retry patches individual
   * chunks. Used for boundary computation in the next dispatch.
   */
  const autoRetryAllResultsRef = useRef<AdaptedChunk[]>([]);
  /** Finish function for the single `startPendingActivity` span covering the
   *  entire auto-retry session. */
  const autoRetryPendingFinishRef = useRef<(() => void) | null>(null);

  /** Lazily creates the worker and wires the message handler exactly once. */
  const getWorker = useCallback((): Worker => {
    if (!workerRef.current) {
      const w = createWorker();
      workerRef.current = w;

      // ── Internal auto-retry helpers (close over refs only — stable) ──────

      /**
       * Ends the auto-retry session and cleans up all coordinator state.
       */
      function endAutoRetry(): void {
        console.debug(
          '[useLyricsAdaptation] auto-retry complete — ending session',
        );
        isAutoRetryingRef.current = false;
        isRetryingRef.current = false;
        autoRetryPendingFinishRef.current?.();
        autoRetryPendingFinishRef.current = null;
        autoRetryQueueRef.current = [];
        autoRetryRoundResolvedRef.current = 0;
        autoRetryAllResultsRef.current = [];
        setIsAutoRetrying(false);
        setRetryingIndex(null);
      }

      /**
       * Called when a round drains. Starts another round if any segments were
       * resolved; otherwise ends the auto-retry session.
       */
      function finishAutoRetryRound(): void {
        const resolved = autoRetryRoundResolvedRef.current;
        const remaining = autoRetryAllResultsRef.current.filter(
          (r) => !isResolvedChunk(r) && r.rawText.trim().length > 0,
        );

        console.debug(
          `[useLyricsAdaptation] auto-retry round finished — resolved=${resolved} remaining=${remaining.length}`,
        );

        if (resolved > 0 && remaining.length > 0) {
          autoRetryRoundResolvedRef.current = 0;
          autoRetryQueueRef.current = [...remaining];
          dispatchNextAutoRetry(); // start next round
          return;
        }
        endAutoRetry();
      }

      /**
       * Iterates over the auto-retry queue, skipping segments whose lyric
       * window cannot be bounded, and dispatches the first dispatchable chunk
       * to the worker. Calls `finishAutoRetryRound` when the queue is empty.
       */
      function dispatchNextAutoRetry(): void {
        const allLines = parseLyricsLines(adaptedLyricsRef.current);
        const allResults = autoRetryAllResultsRef.current;

        while (autoRetryQueueRef.current.length > 0) {
          // Peek at the head of the queue.
          const chunk = autoRetryQueueRef.current[0];
          autoRetryQueueRef.current = autoRetryQueueRef.current.slice(1);

          const prev = findPrevResolved(allResults, chunk.index);
          const next = findNextResolved(allResults, chunk.index);
          const bounded = buildBoundedLyricScope(allLines, prev, next);

          if (!bounded) {
            // No usable boundary — skip this segment in this round.
            console.debug(
              `[useLyricsAdaptation] auto-retry: skipping index=${chunk.index} (no boundary)`,
            );
            continue;
          }

          // Dispatch.
          const jobId = jobIdRef.current + 1;
          jobIdRef.current = jobId;
          setRetryingIndex(chunk.index);

          console.debug(
            `[useLyricsAdaptation] auto-retry: dispatching index=${chunk.index} ` +
              `retryCount=${chunk.retryCount + 1} boundedLines=${bounded.startLine}+${
                bounded.lyrics.split('\n').length
              }`,
          );

          w.postMessage({
            type: 'retry-chunk',
            jobId,
            index: chunk.index,
            rawText: chunk.rawText,
            timestamp: chunk.timestamp,
            lyrics: bounded.lyrics,
            retryCount: chunk.retryCount + 1,
            isBoundedRetry: true,
            lyricsLineOffset: bounded.startLine,
          } satisfies LyricsAdapterRequest);
          return; // wait for reply before dispatching next
        }

        // Queue is empty.
        finishAutoRetryRound();
      }

      /**
       * Starts the first auto-retry round for the given results.
       * No-op if there are no unmatched segments.
       */
      function startAutoRetry(results: AdaptedChunk[]): void {
        const unmatched = results.filter(
          (r) => !isResolvedChunk(r) && r.rawText.trim().length > 0,
        );
        if (unmatched.length === 0) return;

        console.debug(
          `[useLyricsAdaptation] starting auto-retry — ${unmatched.length} unmatched segments`,
        );

        autoRetryAllResultsRef.current = [...results];
        autoRetryQueueRef.current = [...unmatched];
        autoRetryRoundResolvedRef.current = 0;
        isAutoRetryingRef.current = true;
        isRetryingRef.current = true;
        autoRetryPendingFinishRef.current?.();
        autoRetryPendingFinishRef.current = startPendingActivity();
        setIsAutoRetrying(true);

        dispatchNextAutoRetry();
      }

      // ── Worker message handler ────────────────────────────────────────────

      w.onmessage = (event: MessageEvent<LyricsAdapterResponse>): void => {
        const msg = event.data;

        // 'cancelled' has no jobId — state was already reset by cancel/reset.
        if (msg.type === 'cancelled') return;

        // Discard stale messages from previous jobs.
        if ('jobId' in msg && msg.jobId !== jobIdRef.current) return;

        switch (msg.type) {
          case 'model-progress':
            // While any retry is loading the model, suppress the
            // 'loading-model' state transition to preserve the results list.
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
            const newResult = msg.result;
            console.debug(
              `[useLyricsAdaptation] retry-chunk-done — index=${newResult.index} ` +
                `status=${newResult.status} score=${newResult.score.toFixed(3)} ` +
                `autoRetry=${isAutoRetryingRef.current}`,
            );

            if (isAutoRetryingRef.current) {
              // ── Auto-retry path ──────────────────────────────────────────
              // Update the working snapshot used for boundary computation.
              autoRetryAllResultsRef.current =
                autoRetryAllResultsRef.current.map((r) =>
                  r.index === newResult.index ? newResult : r,
                );
              if (isResolvedChunk(newResult)) {
                autoRetryRoundResolvedRef.current += 1;
              }
              // Patch the visible results list and keep latestResultsRef in sync.
              setState((prev) => {
                if (prev.phase !== 'done') return prev;
                const next = prev.results.map((r) =>
                  r.index === newResult.index ? newResult : r,
                );
                latestResultsRef.current = next;
                return { phase: 'done', results: next };
              });
              // Continue driving the queue.
              if (autoRetryQueueRef.current.length > 0) {
                dispatchNextAutoRetry();
              } else {
                finishAutoRetryRound();
              }
            } else {
              // ── Manual retry path (existing behaviour) ───────────────────
              retryPendingFinishRef.current?.();
              retryPendingFinishRef.current = null;
              isRetryingRef.current = false;
              setRetryingIndex(null);
              setState((prev) => {
                if (prev.phase !== 'done') return prev;
                const next = prev.results.map((r) =>
                  r.index === newResult.index ? newResult : r,
                );
                latestResultsRef.current = next;
                return { phase: 'done', results: next };
              });
            }
            break;
          }

          case 'complete':
            latestResultsRef.current = msg.results;
            setState({ phase: 'done', results: msg.results });
            // Immediately begin the auto-retry pass for any unmatched segments.
            startAutoRetry(msg.results);
            break;

          case 'error':
            retryPendingFinishRef.current?.();
            retryPendingFinishRef.current = null;
            if (isAutoRetryingRef.current) {
              // Error during auto-retry — abort the session but preserve results.
              console.warn(
                '[useLyricsAdaptation] error during auto-retry, aborting session:',
                msg.message,
              );
              autoRetryPendingFinishRef.current?.();
              autoRetryPendingFinishRef.current = null;
              isAutoRetryingRef.current = false;
              isRetryingRef.current = false;
              autoRetryQueueRef.current = [];
              autoRetryRoundResolvedRef.current = 0;
              setIsAutoRetrying(false);
              setRetryingIndex(null);
              setRetryError(msg.message);
            } else if (isRetryingRef.current) {
              // Manual retry error — preserve results.
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
        if (isAutoRetryingRef.current) {
          autoRetryPendingFinishRef.current?.();
          autoRetryPendingFinishRef.current = null;
          isAutoRetryingRef.current = false;
          isRetryingRef.current = false;
          autoRetryQueueRef.current = [];
          autoRetryRoundResolvedRef.current = 0;
          setIsAutoRetrying(false);
          setRetryingIndex(null);
          setRetryError(err.message ?? 'Worker error');
        } else if (isRetryingRef.current) {
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
      autoRetryPendingFinishRef.current?.();
      isRetryingRef.current = false;
      isAutoRetryingRef.current = false;
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
    autoRetryPendingFinishRef.current?.();
    autoRetryPendingFinishRef.current = null;
    isRetryingRef.current = false;
    isAutoRetryingRef.current = false;
    autoRetryQueueRef.current = [];
    autoRetryRoundResolvedRef.current = 0;
    autoRetryAllResultsRef.current = [];
    setIsAutoRetrying(false);
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
    autoRetryPendingFinishRef.current?.();
    autoRetryPendingFinishRef.current = null;
    isRetryingRef.current = false;
    isAutoRetryingRef.current = false;
    autoRetryQueueRef.current = [];
    autoRetryRoundResolvedRef.current = 0;
    autoRetryAllResultsRef.current = [];
    setIsAutoRetrying(false);
    setRetryingIndex(null);
    setRetryError(null);
    setState({ phase: 'idle' });
  }, []);

  const adapt = useCallback(
    (chunks: TranscriptChunk[], skipLLM = false): void => {
      const worker = getWorker();
      const jobId = jobIdRef.current + 1;
      jobIdRef.current = jobId;

      // Capture lyrics for auto-retry (must use the same lyrics as this pass).
      adaptedLyricsRef.current = lyrics;

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
      const allResults = latestResultsRef.current;
      const allLines = parseLyricsLines(adaptedLyricsRef.current || lyrics);
      const prev = findPrevResolved(allResults, chunk.index);
      const next = findNextResolved(allResults, chunk.index);
      const bounded = buildBoundedLyricScope(allLines, prev, next);

      const lyricsToSend = bounded ? bounded.lyrics : lyrics;
      const isBoundedRetry = !!bounded;
      const lyricsLineOffset = bounded ? bounded.startLine : 0;

      console.debug(
        `[useLyricsAdaptation] retryChunk (manual) — index=${chunk.index} ` +
          `currentRetryCount=${chunk.retryCount} isBoundedRetry=${isBoundedRetry} ` +
          `lyricsLineOffset=${lyricsLineOffset} rawText="${chunk.rawText}"`,
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
        lyrics: lyricsToSend,
        retryCount: chunk.retryCount + 1,
        isBoundedRetry,
        lyricsLineOffset,
      } satisfies LyricsAdapterRequest);
    },
    [getWorker, lyrics],
  );

  const editChunk = useCallback((index: number, newText: string): void => {
    setState((prev) => {
      if (prev.phase !== 'done') return prev;
      const next = prev.results.map((r) =>
        r.index === index
          ? { ...r, adaptedText: newText, status: 'corrected' as const }
          : r,
      );
      latestResultsRef.current = next;
      return { phase: 'done', results: next };
    });
  }, []);

  return {
    lyrics,
    setLyrics,
    state,
    retryingIndex,
    isAutoRetrying,
    retryError,
    adapt,
    retryChunk,
    editChunk,
    cancel,
    reset,
  };
}
