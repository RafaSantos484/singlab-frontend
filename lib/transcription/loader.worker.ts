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

interface TokenItem {
  output_token_ids: number[];
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
      top_k: number;
      do_sample: boolean;
      chunk_length_s: number;
      stride_length_s: number;
      language: string | null;
      task: 'transcribe' | 'translate' | null;
      return_timestamps: boolean | 'word';
      force_full_sequences: boolean;
      callback_function: (item: TokenItem[]) => void;
      chunk_callback: (chunk: Partial<DecodeChunk>) => void;
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
      const revision = this.model?.includes('/whisper-medium')
        ? 'no_attentions'
        : 'main';

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
  jobToken: number,
): Promise<WhisperPipelineResult | null> {
  const isDistilWhisper = request.model.startsWith('distil-whisper/');

  let modelName = request.model;
  if (!isDistilWhisper && !request.multilingual) {
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

  const timePrecision =
    transcriber.processor.feature_extractor.config.chunk_length /
    transcriber.model.config.max_source_positions;

  const chunksToProcess: DecodeChunk[] = [
    {
      tokens: [],
      finalised: false,
    },
  ];

  function emitUpdate(): void {
    if (jobToken !== activeJobToken) {
      return;
    }

    const data = transcriber.tokenizer._decode_asr(chunksToProcess, {
      time_precision: timePrecision,
      return_timestamps: true,
      force_full_sequences: false,
    });

    self.postMessage({
      status: 'update',
      task: 'automatic-speech-recognition',
      data,
    } satisfies WorkerMessage);
  }

  function chunkCallback(chunk: Partial<DecodeChunk>): void {
    const last = chunksToProcess[chunksToProcess.length - 1];

    Object.assign(last, chunk);
    last.finalised = true;

    if (!chunk.is_last) {
      chunksToProcess.push({
        tokens: [],
        finalised: false,
      });
    }
  }

  function callbackFunction(item: TokenItem[]): void {
    const last = chunksToProcess[chunksToProcess.length - 1];
    if (item[0]?.output_token_ids) {
      last.tokens = [...item[0].output_token_ids];
    }

    emitUpdate();
  }

  try {
    return await transcriber(request.audio, {
      top_k: 0,
      do_sample: false,
      chunk_length_s: isDistilWhisper ? 20 : 25,
      stride_length_s: isDistilWhisper ? 3 : 5,
      language: request.language,
      task: request.subtask,
      return_timestamps: true,
      force_full_sequences: false,
      callback_function: callbackFunction,
      chunk_callback: chunkCallback,
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
  const transcript = await transcribe(event.data, jobToken);
  if (!transcript) {
    return;
  }

  if (jobToken !== activeJobToken) {
    return;
  }

  self.postMessage({
    status: 'complete',
    task: 'automatic-speech-recognition',
    data: transcript,
  } satisfies WorkerMessage);
});

export {};
