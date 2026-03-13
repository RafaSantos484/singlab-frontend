/**
 * Web Worker for lyrics adaptation.
 *
 * Runs the LLM inference (Xenova/flan-t5-base) off the main thread so the
 * UI stays responsive. Progress tracking uses a per-file Map so the reported
 * percentage is a smooth running average across all model files instead of
 * resetting to 0 whenever a new file starts downloading.
 *
 * Supports two request types:
 *  - 'adapt'       — batch-adapts all chunks from a transcription run.
 *  - 'retry-chunk' — re-adapts a single chunk with an escalated prompt
 *                    breadth based on retryCount.
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
// Prompt builder — retryCount escalates breadth of search instruction
// ---------------------------------------------------------------------------

/**
 * Returns a retry-escalation instruction appended to the standard prompt.
 * The higher the retryCount, the broader the instruction.
 *
 * retryCount 1 → mild widening: allow slight phonetic/orthographic variants.
 * retryCount 2 → medium widening: look for partial phrase matches.
 * retryCount ≥ 3 → maximum: accept any plausible correspondence.
 */
function retryInstruction(retryCount: number): string {
  if (retryCount === 1) {
    return '\nIMPORTANT: This is retry attempt 1. Widen your search slightly — allow minor spelling or phonetic variants when matching the captured verse to the lyrics.';
  }
  if (retryCount === 2) {
    return '\nIMPORTANT: This is retry attempt 2. Widen your search significantly — look for partial phrase matches and consider that multiple words may be misheard.';
  }
  return `\nIMPORTANT: This is retry attempt ${retryCount}. Widen your search as broadly as possible — accept any plausible lyric correspondence even if similarity is low.`;
}

/**
 * Builds a prompt for bounded retries — explicitly tells the model that the
 * lyric excerpt was narrowed using already-resolved surrounding segments.
 */
function buildBoundedPrompt(
  verse: string,
  lyrics: string,
  retryCount = 0,
): string {
  const base =
    `You are retrying this segment with a deliberately reduced lyric context, bounded by nearby segments that were already resolved. The target transcription is very likely contained within the lyric excerpt below. Restrict your reasoning to this excerpt and return the best matching lyric span from within it.
You receive:
- LYRIC EXCERPT: a deliberately narrowed portion of the song's lyrics, bounded by previously resolved segments.
- CAPTURED VERSE (may contain recognition errors).
Task (minimal intervention):
1) Find 1 or more CONSECUTIVE LINES from the LYRIC EXCERPT that best match the CAPTURED VERSE.
2) Return ONLY the corrected text:
   - preserve all accents and punctuation from LYRIC EXCERPT;
   - you may merge consecutive lines using a comma or period;
   - normalise capitalisation after commas (use lower case unless proper nouns/acronyms).
3) Do not include labels, explanations, or extra text. Reply ONLY with the final text.
LYRIC EXCERPT:
${lyrics}
CAPTURED VERSE:
${verse}`.trim();

  return retryCount > 0 ? base + retryInstruction(retryCount) : base;
}

function buildPrompt(verse: string, lyrics: string, retryCount = 0): string {
  const base = `You receive:
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

  return retryCount > 0 ? base + retryInstruction(retryCount) : base;
}

// ---------------------------------------------------------------------------
// Per-chunk adaptation
// ---------------------------------------------------------------------------

/**
 * Computes an effective SPAN_MAX that grows with retryCount.
 * retryCount=0 → SPAN_MAX (default 3)
 * retryCount=1 → SPAN_MAX + 1
 * retryCount=2 → SPAN_MAX + 2
 * retryCount≥3 → SPAN_MAX + 3 (uncapped to keep it sensible)
 */
function effectiveSpanMax(retryCount: number): number {
  return SPAN_MAX + Math.min(retryCount, 3);
}

/**
 * Computes effective thresholds that relax as retryCount grows.
 * This ensures that at higher retry counts, the heuristic path also accepts
 * lower-confidence matches rather than always falling back to 'unmatched'.
 */
function effectiveThresholds(retryCount: number): {
  correct: number;
  possible: number;
} {
  const relaxation = Math.min(retryCount, 3) * 0.06;
  return {
    correct: Math.max(CORRECT_THRESHOLD - relaxation, 0.6),
    possible: Math.max(POSSIBLE_THRESHOLD - relaxation, 0.4),
  };
}

async function adaptChunk(
  verse: string,
  lyricsLines: string[],
  lyricsText: string,
  skipLLM: boolean,
  jobId: number,
  retryCount: number,
  isBoundedRetry: boolean,
  onModelProgress: (progress: number, status: string) => void,
): Promise<{
  adaptedText: string;
  status: AdaptationStatus;
  score: number;
  lyricIdxStart?: number;
  lyricIdxEnd?: number;
}> {
  const spanMax = effectiveSpanMax(retryCount);
  const { correct: correctThreshold, possible: possibleThreshold } =
    effectiveThresholds(retryCount);

  const best = pickBestSpan(verse, lyricsLines, spanMax);

  if (best.score >= correctThreshold) {
    console.debug(
      `[lyricsAdapter.worker] adaptChunk jobId=${jobId} retryCount=${retryCount} ` +
        `→ matched (score=${best.score.toFixed(3)}, threshold=${correctThreshold.toFixed(3)})`,
    );
    return {
      adaptedText: joinSpanWithPunctuation(best.lines),
      status: 'matched',
      score: best.score,
      lyricIdxStart: best.idxStart,
      lyricIdxEnd: best.idxEnd,
    };
  }

  if (!skipLLM && best.lines.length > 0) {
    console.debug(
      `[lyricsAdapter.worker] adaptChunk jobId=${jobId} retryCount=${retryCount} ` +
        `→ heuristic score ${best.score.toFixed(3)} below threshold, invoking LLM`,
    );
    try {
      const pipe = await getLLMPipeline(onModelProgress);
      if (activeJobId !== jobId) {
        console.debug(
          `[lyricsAdapter.worker] adaptChunk jobId=${jobId} — cancelled while loading model`,
        );
        const resolved = best.score >= possibleThreshold;
        return {
          adaptedText: joinSpanWithPunctuation(best.lines),
          status: resolved ? 'corrected' : 'unmatched',
          score: best.score,
          lyricIdxStart: resolved ? best.idxStart : undefined,
          lyricIdxEnd: resolved ? best.idxEnd : undefined,
        };
      }
      const prompt = isBoundedRetry
        ? buildBoundedPrompt(verse, lyricsText, retryCount)
        : buildPrompt(verse, lyricsText, retryCount);
      console.debug(
        `[lyricsAdapter.worker] adaptChunk jobId=${jobId} retryCount=${retryCount} ` +
          `isBoundedRetry=${isBoundedRetry} — LLM prompt:\n${prompt}`,
      );
      const output = await pipe(prompt, {
        temperature: 0.1,
        max_new_tokens: 96,
        repetition_penalty: 1.1,
      });
      if (activeJobId !== jobId) {
        console.debug(
          `[lyricsAdapter.worker] adaptChunk jobId=${jobId} — cancelled after LLM inference`,
        );
        return { adaptedText: verse, status: 'unmatched', score: 0 };
      }
      const generated = (
        Array.isArray(output)
          ? (output[0] as Record<string, string>)?.generated_text
          : (output as Record<string, string>)?.generated_text
      )?.trim();

      console.debug(
        `[lyricsAdapter.worker] adaptChunk jobId=${jobId} retryCount=${retryCount} ` +
          `LLM output: "${generated ?? '(empty)'}"`,
      );

      if (generated) {
        const llmBest = pickBestSpan(generated, lyricsLines, spanMax);
        if (llmBest.score >= possibleThreshold) {
          console.debug(
            `[lyricsAdapter.worker] adaptChunk jobId=${jobId} → corrected via LLM ` +
              `(llmBest.score=${llmBest.score.toFixed(3)})`,
          );
          return {
            adaptedText: joinSpanWithPunctuation(llmBest.lines),
            status: 'corrected',
            score: llmBest.score,
            lyricIdxStart: llmBest.idxStart,
            lyricIdxEnd: llmBest.idxEnd,
          };
        }
      }
    } catch (err) {
      console.warn(
        `[lyricsAdapter.worker] adaptChunk jobId=${jobId} LLM error:`,
        err,
      );
      // LLM failed — fall through to heuristic.
    }
  }

  if (best.score >= possibleThreshold) {
    console.debug(
      `[lyricsAdapter.worker] adaptChunk jobId=${jobId} → corrected via heuristic ` +
        `(score=${best.score.toFixed(3)})`,
    );
    return {
      adaptedText: joinSpanWithPunctuation(best.lines),
      status: 'corrected',
      score: best.score,
      lyricIdxStart: best.idxStart,
      lyricIdxEnd: best.idxEnd,
    };
  }

  console.debug(
    `[lyricsAdapter.worker] adaptChunk jobId=${jobId} → unmatched ` +
      `(score=${best.score.toFixed(3)}, possibleThreshold=${possibleThreshold.toFixed(3)})`,
  );
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

// Automatic retries removed: manual retry via UI and automatic bounded retry
// (triggered by useLyricsAdaptation) remain available via `retry-chunk`.

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
  // ── cancel ──────────────────────────────────────────────────────────────
  if (request.type === 'cancel') {
    console.debug(
      '[lyricsAdapter.worker] received cancel — resetting activeJobId',
    );
    activeJobId = -1;
    self.postMessage({ type: 'cancelled' } satisfies LyricsAdapterResponse);
    return;
  }

  // ── retry-chunk ──────────────────────────────────────────────────────────
  if (request.type === 'retry-chunk') {
    const {
      jobId,
      index,
      rawText,
      timestamp,
      lyrics,
      retryCount,
      isBoundedRetry = false,
      lyricsLineOffset = 0,
    } = request;
    activeJobId = jobId;

    console.debug(
      `[lyricsAdapter.worker] retry-chunk start — jobId=${jobId} index=${index} ` +
        `retryCount=${retryCount} isBoundedRetry=${isBoundedRetry} rawText="${rawText}"`,
    );

    const lyricsLines = parseLyricsLines(lyrics);

    try {
      const { adaptedText, status, score, lyricIdxStart, lyricIdxEnd } =
        await adaptChunk(
          rawText,
          lyricsLines,
          lyrics,
          false, // never skip LLM on explicit retry
          jobId,
          retryCount,
          isBoundedRetry,
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

      if (activeJobId !== jobId) {
        console.debug(
          `[lyricsAdapter.worker] retry-chunk cancelled mid-flight — jobId=${jobId}`,
        );
        return;
      }

      const result: AdaptedChunk = {
        index,
        rawText,
        adaptedText,
        timestamp,
        status,
        score,
        retryCount,
        lyricIdxStart:
          lyricIdxStart !== undefined
            ? lyricIdxStart + lyricsLineOffset
            : undefined,
        lyricIdxEnd:
          lyricIdxEnd !== undefined
            ? lyricIdxEnd + lyricsLineOffset
            : undefined,
      };

      console.debug(
        `[lyricsAdapter.worker] retry-chunk done — jobId=${jobId} index=${index} ` +
          `status=${status} score=${score.toFixed(3)} adaptedText="${adaptedText}"`,
      );

      self.postMessage({
        type: 'retry-chunk-done',
        jobId,
        result,
      } satisfies LyricsAdapterResponse);
    } catch (err) {
      if (activeJobId !== jobId) return;
      const message = err instanceof Error ? err.message : String(err);
      console.error(
        `[lyricsAdapter.worker] retry-chunk error — jobId=${jobId} index=${index}:`,
        err,
      );
      self.postMessage({
        type: 'error',
        jobId,
        message,
      } satisfies LyricsAdapterResponse);
    }
    return;
  }

  // ── adapt (batch) ────────────────────────────────────────────────────────
  const { jobId, chunks, lyrics, skipLLM } = request;
  activeJobId = jobId;

  console.debug(
    `[lyricsAdapter.worker] adapt start — jobId=${jobId} chunks=${chunks.length} skipLLM=${skipLLM}`,
  );

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
          retryCount: 0,
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

      const onProgress = (progress: number, s: string): void => {
        if (activeJobId !== jobId) return;
        self.postMessage({
          type: 'model-progress',
          jobId,
          progress,
          status: s,
        } satisfies LyricsAdapterResponse);
      };

      // Initial adaptation pass.
      const adapted = await adaptChunk(
        verse,
        lyricsLines,
        lyrics,
        skipLLM,
        jobId,
        0, // initial adaptation always starts at retryCount=0
        false, // never a bounded retry on the initial pass
        onProgress,
      );

      // Note: automatic bounded retries are coordinated by useLyricsAdaptation
      // after the initial pass completes. Manual retry is also available via
      // the UI (`retry-chunk` message with isBoundedRetry=false).

      if (activeJobId !== jobId) break;

      done += 1;
      const result: AdaptedChunk = {
        index: i,
        rawText: verse,
        adaptedText: adapted.adaptedText,
        timestamp: chunk.timestamp,
        status: adapted.status,
        score: adapted.score,
        retryCount: 0,
        lyricIdxStart: adapted.lyricIdxStart,
        lyricIdxEnd: adapted.lyricIdxEnd,
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

    console.debug(
      `[lyricsAdapter.worker] adapt complete — jobId=${jobId} results=${results.length}`,
    );
    self.postMessage({
      type: 'complete',
      jobId,
      results,
    } satisfies LyricsAdapterResponse);
  } catch (err) {
    if (activeJobId !== jobId) return;
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[lyricsAdapter.worker] adapt error — jobId=${jobId}:`, err);
    self.postMessage({
      type: 'error',
      jobId,
      message,
    } satisfies LyricsAdapterResponse);
  }
}

export {};
