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
- New helper: `lib/audio/sliceWav.ts` — creates a valid WAV `Blob` for a
  requested time slice (reads headers and copies PCM frames). Useful for
  creating per-segment object URLs used by the UI players.
- UI: `components/features/SegmentPlayers.tsx` was added to render
  per-segment audio players using either per-segment object URLs or the
  full processed audio as fallback.

If you change the worker API or per-segment contract, update this README
and the types in `lib/transcription/types.ts` accordingly.
