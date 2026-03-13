import { env, pipeline } from '@xenova/transformers';

import type {
  TranscriptChunk,
  WorkerMessage,
  WorkerRequest,
  WorkerStopRequest,
  WorkerTranscriptionRequest,
} from './types';

/**
 * Web Worker for OpenAI Whisper Speech-to-Text Transcription
 *
 * This worker runs transformers.js AI models in a background thread, allowing
 * the main thread to remain responsive during CPU-intensive model loading and
 * inference.
 *
 * **Threading Model:**
 * Worker is created by useWhisperTranscriber hook. Main thread posts messages
 * to request transcription start or stop. Worker emits progress and completion
 * events back to the main thread. Only one inference job runs at a time.
 *
 * **Model Loading:**
 * - Models are loaded on-demand per configuration (model ID, quantization, task).
 * - `env.allowLocalModels = false` forces models to load from CDN (remote),
 *   matching whisper-web behavior for reproducibility.
 * - Model instance is cached and reused until settings change.
 * - Large models (medium, large) take time to download and compile; progress
 *   is streamed back to UI.
 *
 * **Messages Emitted:**
 * - `progress` — model loading progress (file, loaded, total, progress %)
 * - `initiate` — inference started, buffer processing begins
 * - `update` — partial transcript available (streamed in real-time)
 * - `complete` — inference finished, final full transcript ready
 * - `ready` — model fully loaded and ready for inference
 * - `done` — cleanup after inference
 * - `error` — transcription failed
 */

// Force remote model loading to match whisper-web behavior.
env.allowLocalModels = false;

interface DecodeChunk {
  tokens: number[];
  finalised: boolean;
  is_last?: boolean;
}

type DecodeResult = [
  string,
  {
    chunks: TranscriptChunk[];
  },
];

interface WhisperPipelineResult {
  text: string;
  chunks: TranscriptChunk[];
}

interface WhisperPipelineInstance {
  (
    audio: Float32Array,
    options: {
      do_sample: boolean;
      chunk_length_s?: number;
      stride_length_s?: number;
      language: string | null;
      task: 'transcribe' | 'translate' | null;
      return_timestamps: boolean | 'word';
      force_full_sequences: boolean;
    },
  ): Promise<WhisperPipelineResult>;
  dispose: () => Promise<void>;
  processor: {
    feature_extractor: {
      config: {
        chunk_length: number;
      };
    };
  };
  model: {
    config: {
      max_source_positions: number;
    };
  };
  tokenizer: {
    _decode_asr: (
      chunks: DecodeChunk[],
      options: {
        time_precision: number;
        return_timestamps: boolean;
        force_full_sequences: boolean;
      },
    ) => DecodeResult;
  };
}

class PipelineFactory {
  public static task: string | null = null;
  public static model: string | null = null;
  public static quantized: boolean | null = null;
  public static instance: WhisperPipelineInstance | null = null;

  public static async getInstance(
    progressCallback?: (progressInfo: unknown) => void,
  ): Promise<WhisperPipelineInstance> {
    if (this.instance === null) {
      // Use the default revision for pipelines. The previous special-case
      // for whisper-medium is removed since that model is no longer listed
      // in available options.
      const revision = 'main';

      const pipelineOptions = {
        quantized: this.quantized ?? true,
        progress_callback: progressCallback,
        revision,
      } as unknown as Parameters<typeof pipeline>[2];

      this.instance = (await pipeline(
        this.task as 'automatic-speech-recognition',
        this.model ?? '',
        pipelineOptions,
      )) as unknown as WhisperPipelineInstance;
    }

    return this.instance;
  }
}

class AutomaticSpeechRecognitionPipelineFactory extends PipelineFactory {
  public static override task = 'automatic-speech-recognition';
  public static override model: string | null = null;
  public static override quantized: boolean | null = null;
}

let activeJobToken = 0;

async function disposeCurrentPipeline(): Promise<void> {
  const factory = AutomaticSpeechRecognitionPipelineFactory;
  if (factory.instance !== null) {
    const current = await factory.getInstance();
    await current.dispose();
    factory.instance = null;
  }
}

async function transcribe(
  request: WorkerTranscriptionRequest,
): Promise<WhisperPipelineResult | null> {
  // Per-segment transcription is the application default. Choose chunk and
  // stride sizes appropriate for short isolated segments.
  // Detect smaller/less-powerful models to use shorter chunk lengths.
  // const modelId = request.model;

  let modelName = request.model;
  if (!request.multilingual) {
    modelName += '.en';
  }

  const factory = AutomaticSpeechRecognitionPipelineFactory;
  if (factory.model !== modelName || factory.quantized !== request.quantized) {
    factory.model = modelName;
    factory.quantized = request.quantized;

    await disposeCurrentPipeline();
  }

  const transcriber = await factory.getInstance((data) => {
    self.postMessage(data as unknown as WorkerMessage);
  });

  // Streaming updates via tokenizer decoding are not used in the
  // per-segment flow. The pipeline is invoked to return final text only.

  try {
    // For isolated short segments we disable stride (no context overlap)
    // and pick a conservative chunk length: 10s for smaller models and
    // 25s for more capable models. Since segments are typically short,
    // this reduces memory/compute for weaker models.
    return await transcriber(request.audio, {
      language: request.language,
      task: 'transcribe',
      do_sample: false,
      return_timestamps: false,
      force_full_sequences: false,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Unknown transcription error';

    self.postMessage({
      status: 'error',
      task: 'automatic-speech-recognition',
      data: {
        message,
      },
    } satisfies WorkerMessage);

    return null;
  }
}

function isStopRequest(request: WorkerRequest): request is WorkerStopRequest {
  return (request as WorkerStopRequest).action === 'stop';
}

self.addEventListener('message', async (event: MessageEvent<WorkerRequest>) => {
  if (isStopRequest(event.data)) {
    activeJobToken += 1;
    await disposeCurrentPipeline();
    self.postMessage({ status: 'stopped' } satisfies WorkerMessage);

    return;
  }

  const jobToken = activeJobToken + 1;
  activeJobToken = jobToken;
  const transcript = await transcribe(event.data);
  if (!transcript) {
    return;
  }

  if (jobToken !== activeJobToken) {
    return;
  }

  self.postMessage({
    status: 'complete',
    task: 'automatic-speech-recognition',
    // Per-segment completion: always return `{ text, segmentIndex }` so
    // the main thread can attach the returned text to the corresponding
    // speech interval from the silence map.
    data: {
      text: transcript.text,
      segmentIndex: (event.data as WorkerTranscriptionRequest).segmentIndex,
    },
  } satisfies WorkerMessage);
});

export {};
