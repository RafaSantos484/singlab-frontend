'use client';

import { useCallback, useRef, useState } from 'react';
import {
  adaptTranscriptChunks,
  type AdaptedChunk,
} from '@/lib/transcription/lyricsAdapter';
import type { TranscriptChunk } from '@/lib/transcription/types';

export type LyricsAdaptationState =
  | { phase: 'idle' }
  | { phase: 'adapting'; done: number; total: number }
  | { phase: 'done'; results: AdaptedChunk[] }
  | { phase: 'error'; message: string };

interface UseLyricsAdaptationReturn {
  lyrics: string;
  setLyrics: (text: string) => void;
  state: LyricsAdaptationState;
  adapt: (chunks: TranscriptChunk[]) => void;
  editChunk: (index: number, newText: string) => void;
  deleteChunk: (index: number) => void;
  cancel: () => void;
  reset: () => void;
}

/**
 * Deterministic lyrics adaptation state manager.
 *
 * Correlation runs on the main thread using text similarity only.
 */
export function useLyricsAdaptation(): UseLyricsAdaptationReturn {
  const [lyrics, setLyrics] = useState('');
  const [state, setState] = useState<LyricsAdaptationState>({ phase: 'idle' });

  // Incrementing token used to ignore stale adaptation completions.
  const adaptationTokenRef = useRef(0);

  const cancel = useCallback((): void => {
    adaptationTokenRef.current += 1;
    setState({ phase: 'idle' });
  }, []);

  const reset = useCallback((): void => {
    adaptationTokenRef.current += 1;
    setState({ phase: 'idle' });
  }, []);

  const adapt = useCallback(
    (chunks: TranscriptChunk[]): void => {
      const token = adaptationTokenRef.current + 1;
      adaptationTokenRef.current = token;

      const total = chunks.filter((chunk) => chunk.text.trim().length > 0).length;
      setState({ phase: 'adapting', done: 0, total });

      queueMicrotask(() => {
        if (adaptationTokenRef.current !== token) {
          return;
        }

        try {
          const results = adaptTranscriptChunks(chunks, lyrics);
          if (adaptationTokenRef.current !== token) {
            return;
          }
          setState({ phase: 'done', results });
        } catch (error) {
          if (adaptationTokenRef.current !== token) {
            return;
          }
          setState({
            phase: 'error',
            message: error instanceof Error ? error.message : 'Adaptation failed',
          });
        }
      });
    },
    [lyrics],
  );

  const editChunk = useCallback((index: number, newText: string): void => {
    setState((previous) => {
      if (previous.phase !== 'done') {
        return previous;
      }

      const results = previous.results.map((chunk) =>
        chunk.index === index
          ? { ...chunk, adaptedText: newText, status: 'corrected' as const }
          : chunk,
      );

      return { phase: 'done', results };
    });
  }, []);

  const deleteChunk = useCallback((index: number): void => {
    setState((previous) => {
      if (previous.phase !== 'done') {
        return previous;
      }

      const results = previous.results.filter((chunk) => chunk.index !== index);
      return { phase: 'done', results };
    });
  }, []);

  return {
    lyrics,
    setLyrics,
    state,
    adapt,
    editChunk,
    deleteChunk,
    cancel,
    reset,
  };
}
