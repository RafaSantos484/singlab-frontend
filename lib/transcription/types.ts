export interface TranscriptionProgressItem {
  file: string;
  loaded: number;
  progress: number;
  total: number;
  name: string;
  status: string;
}

export interface TranscriptChunk {
  text: string;
  /**
   * Timestamp range relative to the processed (silence-removed) audio.
   * This value is always provided by the transcription worker as it
   * produces streaming updates.
   */
  processedTimestamp: [number, number | null];
  /**
   * Timestamp range remapped to the original vocals timeline. When a
   * remapping is not available yet this will equal `processedTimestamp`.
   */
  timestamp: [number, number | null];
}

export interface TranscriptionOutput {
  isBusy: boolean;
  text: string;
  chunks: TranscriptChunk[];
}

export interface TranscriptionSettings {
  model: string;
  multilingual: boolean;
  quantized: boolean;
  subtask: 'transcribe' | 'translate';
  language: string;
}

export interface WorkerTranscriptionRequest {
  audio: Float32Array;
  model: string;
  multilingual: boolean;
  quantized: boolean;
  subtask: 'transcribe' | 'translate' | null;
  language: string | null;
  /** Index of the speech segment when transcribing per-segment. */
  segmentIndex: number;
}

export interface WorkerStopRequest {
  action: 'stop';
}

export type WorkerRequest = WorkerTranscriptionRequest | WorkerStopRequest;

export interface WorkerTranscriptionUpdateMessage {
  status: 'update';
  task: 'automatic-speech-recognition';
  data: [string, { chunks: TranscriptChunk[] }];
}

export interface WorkerTranscriptionCompleteMessage {
  status: 'complete';
  task: 'automatic-speech-recognition';
  // For the current per-segment-only flow `data` contains text and the
  // `segmentIndex` identifying which speech segment this transcript refers
  // to. Legacy chunked results are no longer emitted.
  data: {
    text: string;
    segmentIndex: number;
  };
}

export interface WorkerTranscriptionProgressMessage {
  status: 'initiate' | 'progress' | 'done';
  file: string;
  name: string;
  loaded?: number;
  progress?: number;
  total?: number;
}

export interface WorkerDownloadReadyMessage {
  status: 'ready';
  file?: string;
  name?: string;
}

export interface WorkerReadyMessage {
  status: 'ready';
}

export interface WorkerStoppedMessage {
  status: 'stopped';
}

export interface WorkerErrorMessage {
  status: 'error';
  task: 'automatic-speech-recognition';
  data: {
    message?: string;
  };
}

export type WorkerMessage =
  | WorkerTranscriptionUpdateMessage
  | WorkerTranscriptionCompleteMessage
  | WorkerTranscriptionProgressMessage
  | WorkerDownloadReadyMessage
  | WorkerReadyMessage
  | WorkerStoppedMessage
  | WorkerErrorMessage;
