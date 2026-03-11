/**
 * Web Worker for lyrics adaptation.
 *
 * Runs the LLM inference (Xenova/flan-t5-base) off the main thread so the
 * UI stays responsive. Progress tracking uses a per-file Map so the reported
 * percentage is a smooth running average across all model files instead of
 * resetting to 0 whenever a new file starts downloading.
 */

import { env, pipeline } from '@xenova/transformers';

import {
  CORRECT_THRESHOLD,
  LLM_MODEL_ID,
  POSSIBLE_THRESHOLD,
  SPAN_MAX,
  joinSpanWithPunctuation,
  parseLyricsLines,
  pickBestSpan,
  type AdaptedChunk,
  type AdaptationStatus,
  type LyricsAdapterRequest,
  type LyricsAdapterResponse,
} from './lyricsAdapter';
import type { TranscriptChunk } from './types';

env.allowLocalModels = false;

// ---------------------------------------------------------------------------
// LLM pipeline singleton
// ---------------------------------------------------------------------------

type LLMPipeline = (
  text: string,
  options: Record<string, unknown>,
) => Promise<unknown>;

let _pipe: LLMPipeline | null = null;

/**
 * Per-file download progress in [0, 100].
 * Cleared each time we start loading a fresh pipeline (first use only).
 */
const fileProgressMap = new Map<string, number>();

function computeAverageProgress(): number {
  if (fileProgressMap.size === 0) return 0;
  const values = [...fileProgressMap.values()];
  return Math.round(values.reduce((a, b) => a + b, 0) / values.length);
}

async function getLLMPipeline(
  onProgress: (progress: number, status: string) => void,
): Promise<LLMPipeline> {
  if (_pipe !== null) return _pipe;

  const raw = await pipeline('text2text-generation', LLM_MODEL_ID, {
    progress_callback: (p: Record<string, unknown>): void => {
      const status = typeof p.status === 'string' ? p.status : 'loading';
      const file = typeof p.file === 'string' ? p.file : null;

      if (status === 'initiate' && file) {
        fileProgressMap.set(file, 0);
      } else if (
        status === 'progress' &&
        file &&
        typeof p.progress === 'number'
      ) {
        fileProgressMap.set(file, p.progress);
      } else if (status === 'done' && file) {
        fileProgressMap.set(file, 100);
      }

      onProgress(computeAverageProgress(), status);
    },
  });

  _pipe = raw as unknown as LLMPipeline;
  return _pipe;
}

// ---------------------------------------------------------------------------
// Prompt builder
// ---------------------------------------------------------------------------

function buildPrompt(verse: string, lyrics: string): string {
  return `You receive:
- ORIGINAL LYRICS in the song's language (one line per verse).
- CAPTURED VERSE (may span multiple lyric lines; may contain recognition errors).

Task (minimal intervention):
1) Find 1 or more CONSECUTIVE LINES from ORIGINAL LYRICS that best match the CAPTURED VERSE.
2) Return ONLY the corrected text:
   - preserve all accents and punctuation from ORIGINAL LYRICS;
   - you may merge consecutive lines using a comma or period;
   - normalise capitalisation after commas (use lower case unless proper nouns/acronyms).
3) Do not include labels, explanations, or extra text. Reply ONLY with the final text.

ORIGINAL LYRICS:
${lyrics}

CAPTURED VERSE:
${verse}`.trim();
}

// ---------------------------------------------------------------------------
// Per-chunk adaptation
// ---------------------------------------------------------------------------

async function adaptChunk(
  verse: string,
  lyricsLines: string[],
  lyricsText: string,
  skipLLM: boolean,
  jobId: number,
  onModelProgress: (progress: number, status: string) => void,
): Promise<{ adaptedText: string; status: AdaptationStatus; score: number }> {
  const best = pickBestSpan(verse, lyricsLines, SPAN_MAX);

  if (best.score >= CORRECT_THRESHOLD) {
    return {
      adaptedText: joinSpanWithPunctuation(best.lines),
      status: 'matched',
      score: best.score,
    };
  }

  if (!skipLLM && best.lines.length > 0) {
    try {
      const pipe = await getLLMPipeline(onModelProgress);

      if (activeJobId !== jobId) {
        // Cancelled while the model was loading — fall through to heuristic.
        return {
          adaptedText: joinSpanWithPunctuation(best.lines),
          status: best.score >= POSSIBLE_THRESHOLD ? 'corrected' : 'unmatched',
          score: best.score,
        };
      }

      const prompt = buildPrompt(verse, lyricsText);
      const output = await pipe(prompt, {
        temperature: 0.1,
        max_new_tokens: 96,
        repetition_penalty: 1.1,
      });

      if (activeJobId !== jobId) {
        return { adaptedText: verse, status: 'unmatched', score: 0 };
      }

      const generated = (
        Array.isArray(output)
          ? (output[0] as Record<string, string>)?.generated_text
          : (output as Record<string, string>)?.generated_text
      )?.trim();

      if (generated) {
        const llmBest = pickBestSpan(generated, lyricsLines, SPAN_MAX);
        if (llmBest.score >= POSSIBLE_THRESHOLD) {
          return {
            adaptedText: joinSpanWithPunctuation(llmBest.lines),
            status: 'corrected',
            score: llmBest.score,
          };
        }
      }
    } catch {
      // LLM failed — fall through to heuristic.
    }
  }

  if (best.score >= POSSIBLE_THRESHOLD) {
    return {
      adaptedText: joinSpanWithPunctuation(best.lines),
      status: 'corrected',
      score: best.score,
    };
  }

  return {
    adaptedText: verse.trim(),
    status: 'unmatched',
    score: best.score,
  };
}

// ---------------------------------------------------------------------------
// Job state
// ---------------------------------------------------------------------------

let activeJobId = -1;

// ---------------------------------------------------------------------------
// Message handler
// ---------------------------------------------------------------------------

self.addEventListener(
  'message',
  (event: MessageEvent<LyricsAdapterRequest>): void => {
    void handleMessage(event.data);
  },
);

async function handleMessage(request: LyricsAdapterRequest): Promise<void> {
  if (request.type === 'cancel') {
    activeJobId = -1;
    self.postMessage({ type: 'cancelled' } satisfies LyricsAdapterResponse);
    return;
  }

  const { jobId, chunks, lyrics, skipLLM } = request;
  activeJobId = jobId;

  const lyricsLines = parseLyricsLines(lyrics);
  const results: AdaptedChunk[] = [];

  const nonEmptyChunks = chunks.filter(
    (c: TranscriptChunk) => c.text.trim().length > 0,
  );
  const total = nonEmptyChunks.length;
  let done = 0;

  try {
    for (let i = 0; i < chunks.length; i++) {
      if (activeJobId !== jobId) break;

      const chunk = chunks[i];
      const verse = chunk.text.trim();

      if (!verse) {
        const result: AdaptedChunk = {
          index: i,
          rawText: verse,
          adaptedText: '',
          timestamp: chunk.timestamp,
          status: 'unmatched',
          score: 0,
        };
        results.push(result);
        self.postMessage({
          type: 'chunk-done',
          jobId,
          done,
          total,
          result,
        } satisfies LyricsAdapterResponse);
        continue;
      }

      const { adaptedText, status, score } = await adaptChunk(
        verse,
        lyricsLines,
        lyrics,
        skipLLM,
        jobId,
        (progress, s) => {
          if (activeJobId !== jobId) return;
          self.postMessage({
            type: 'model-progress',
            jobId,
            progress,
            status: s,
          } satisfies LyricsAdapterResponse);
        },
      );

      if (activeJobId !== jobId) break;

      done += 1;
      const result: AdaptedChunk = {
        index: i,
        rawText: verse,
        adaptedText,
        timestamp: chunk.timestamp,
        status,
        score,
      };
      results.push(result);

      self.postMessage({
        type: 'chunk-done',
        jobId,
        done,
        total,
        result,
      } satisfies LyricsAdapterResponse);
    }

    if (activeJobId !== jobId) return;

    self.postMessage({
      type: 'complete',
      jobId,
      results,
    } satisfies LyricsAdapterResponse);
  } catch (err) {
    if (activeJobId !== jobId) return;
    const message = err instanceof Error ? err.message : String(err);
    self.postMessage({
      type: 'error',
      jobId,
      message,
    } satisfies LyricsAdapterResponse);
  }
}

export {};
