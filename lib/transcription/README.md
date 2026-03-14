# Transcription module — developer notes

This folder contains the client-side transcription integration (Whisper
pipeline worker + loader). Recent changes simplified the transcription
flow to a per-segment (silence-sliced) transcription model.

Key points for maintainers
- Per-segment flow: callers provide processed (silence-removed) audio and
  an array of `SpeechSegment` intervals. The worker is invoked per segment
  and returns final text for that segment. Timestamp mapping is handled
  by the caller using the silence map.
- `subtask` / translate option removed: the application now performs
  transcription-only. If translation is required in the future re-introduce
  a `task`/`subtask` option carefully and update types and worker messages.
- Worker messages: the worker now returns simple per-segment completions
  of the shape `{ status: 'complete', data: { text, segmentIndex } }`.
- Performance: large Float32Array buffers are transferred to the worker to
  avoid copies. See `useWhisperTranscriber` for `postMessage(..., [buffer])`.
- Constants: distil/distinct model variants were removed from
  `lib/transcription/constants.ts` — adjust available model list there.
  - Note: the default settings in `lib/transcription/constants.ts` now
    choose a quantized `Xenova/whisper-base` model to reduce memory usage
    on typical client devices. If you change this default, update docs
    and translations accordingly (see `messages/en-US.json` / `pt-BR.json`).
  - The hook and UI now cache a processed audio `Blob` per Transcription
    dialog session to avoid re-running FFmpeg repeatedly; callers should
    be aware of in-memory blob lifetimes when profiling memory usage.
  - Inline editing: the Transcription UI (`TranscriptionDialog`) now exposes an inline edit workflow for adapted lyric chunks. The `useLyricsAdaptation` hook provides an `editChunk(index, newText)` method that lets the UI persist manual corrections; corrected chunks are marked with a `corrected` status. When changing UI behavior or the adaptation state shape, update this README and the `useLyricsAdaptation` types.
    - Adapted chunk deletion: the same panel now exposes a per-item delete action. The `useLyricsAdaptation` hook provides `deleteChunk(index)` so the UI can remove unwanted adapted items while keeping the remaining edit flow intact.
    - Lyrics adaptation is deterministic only: `useLyricsAdaptation` runs local
      correlation based on text similarity against parsed lyric lines from
      `lib/transcription/lyricsAdapter.ts`. There is no model loading, worker
      messaging, retries, or prompt-based correction in this flow.
- New helper: `lib/audio/sliceWav.ts` — creates a valid WAV `Blob` for a
  requested time slice (reads headers and copies PCM frames). Useful for
  creating per-segment object URLs used by the UI players.
  - The Transcription UI creates per-segment object URLs from sliced WAV
    blobs so each segment player can use a bounded audio file. When editing
    code that manipulates segment URLs, ensure existing object URLs are
    revoked to avoid leaking browser memory.
- UI: `components/features/SegmentPlayers.tsx` was added to render
  per-segment audio players using either per-segment object URLs or the
  full processed audio as fallback.
- Transcript noise filtering: `lib/transcription/transcriptNoiseFilter.ts`
  applies deterministic heuristics to remove clearly non-lyrical segments
  (musical symbols, bracketed placeholders, and long repetitive humming-like
  content). Filtering is executed in `useWhisperTranscriber` before chunks are
  exposed to the UI and before lyrics adaptation consumes them.

If you change the worker API or per-segment contract, update this README
and the types in `lib/transcription/types.ts` accordingly.
