// import { env, pipeline, ProgressInfo } from '@huggingface/transformers';
import { env, pipeline } from '@xenova/transformers';

import type {
  TranscriptChunk,
  WorkerMessage,
  WorkerRequest,
  WorkerStopRequest,
  WorkerTranscriptionRequest,
} from './types';

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
      top_k: number;
      do_sample: boolean;
      chunk_length_s: number;
      stride_length_s: number;
      language: string | null;
      task: 'transcribe' | 'translate' | null;
      return_timestamps: boolean;
      force_full_sequences: boolean;
      callback_function: (item: unknown) => void;
      chunk_callback: (chunk: unknown) => void;
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

function getOutputTokenIds(item: unknown): number[] {
  if (!Array.isArray(item) || item.length === 0) {
    return [];
  }

  const first = item[0] as { output_token_ids?: number[] } | undefined;
  return Array.isArray(first?.output_token_ids) ? first.output_token_ids : [];
}

function toDecodeChunk(chunk: unknown): DecodeChunk {
  const value = (chunk ?? {}) as {
    tokens?: number[];
    is_last?: boolean;
  };

  return {
    tokens: Array.isArray(value.tokens) ? value.tokens : [],
    finalised: true,
    is_last: Boolean(value.is_last),
  };
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

  function chunkCallback(chunk: unknown): void {
    const last = chunksToProcess[chunksToProcess.length - 1];
    const normalizedChunk = toDecodeChunk(chunk);

    last.tokens = normalizedChunk.tokens;
    last.finalised = true;
    last.is_last = normalizedChunk.is_last;

    if (!normalizedChunk.is_last) {
      chunksToProcess.push({
        tokens: [],
        finalised: false,
      });
    }

    // Emit an update when a chunk completes so UI is refreshed incrementally.
    emitUpdate();
  }

  function callbackFunction(item: unknown): void {
    const last = chunksToProcess[chunksToProcess.length - 1];
    last.tokens = getOutputTokenIds(item);

    emitUpdate();
  }

  try {
    return await transcriber(request.audio, {
      top_k: 0,
      do_sample: false,
      chunk_length_s: isDistilWhisper ? 20 : 30,
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
