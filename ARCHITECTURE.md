# SingLab Frontend — Architecture Overview

## High-Level Architecture

```
┌───────────────────────────────────────────────────────────────────┐
│  Browser / User                                                   │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │  Next.js App Router (singlab-frontend)                      │ │
│  │                                                             │ │
│  │  Pages & Layouts         Components            Lib (utils)  │ │
│  │  ─────────────────       ──────────────         ──────────  │ │
│  │  app/layout.tsx          features/GlobalPlayer  firebase/*  │ │
│  │  app/page.tsx            ui/…                   api/sep.    │ │
│  │  app/login/              …                      hooks/*     │ │
│  │  app/dashboard/                                 store/*     │ │
│  └──────┬───────────────────────────┬─────────────────────────┘ │
└─────────│───────────────────────────│──────────────────────────────┘
          │  Direct SDK                │  HTTP (REST)
          ▼                           ▼
┌──────────────────────┐  ┌──────────────────────────────────────┐
│ Firebase (client SDK)│  │ singlab-api (NestJS + Cloud Functions)│
│                      │  │                                      │
│ • Auth (sign-in,     │  │ POST /separations/submit              │
│   registration)      │  │   → Forward request to PoYo API      │
│ • Firestore (songs,  │  │ GET  /separations/status              │
│   users, separation  │  │   → Fetch task status from PoYo      │
│   info)              │  │                                      │
│ • Cloud Storage      │  │ No Firestore / Storage access        │
│   (raw audio, stems) │  └──────────────┬───────────────────────┘
└──────────────────────┘                 │
                                         ▼
                                  ┌────────────┐
                                  │ Stem Split │
                                  │ API (PoYo) │
                                  └────────────┘
```

## Frontend Layers

### 1. App Router (pages & layouts)

All routes live under `app/`. Route segments follow Next.js App Router
conventions with server and client components as appropriate.

| Route | Purpose |
|---|---|
| `/` | Landing / home |
| `/login` | Firebase authentication page |
| `/dashboard` | User's song library with inline audio player |

### 2. Components

Components are split into two groups:

- **`components/layout/`** — Shared page wrappers for route families.
     - `AuthLayout` — common visual shell for `/login` and `/register`.
     - `DashboardLayout` — authenticated shell (app bar, profile, sign out).
- **`components/ui/`** — Branding and decorative primitives (`SingLabLogo`,
     waveform/spectrum decorations).
- **`components/features/`** — Feature-specific composite components.
     - `GlobalPlayer` — single global audio player component; displays currently
          playing song with play/pause/stop controls, progress bar, and volume.
          Supports both raw audio and separated stem playback with stem selection UI.
          Integrated with global state for centralized playback control.
     - `SongCardItem` — reusable song card displaying metadata, play/edit buttons,
          and separation status (pending, processing, finished, or failed).
          Uses `useSeparationStatus` hook to manage the separation lifecycle.
     - `SongDeleteButton` — reusable confirmation dialog for deleting songs with
          loading state, accessibility features, and error handling.
     - `SeparationDialog` — provider selector (`poyo` or `local`) for separation requests.
     - `StemUploadForm` — manual stem upload workflow (vocals required + at least one extra stem).
     - `SongCreateDialog` — upload workflow with:
          * File picker + drag-and-drop support
          * Audio format validation (MIME type + extension fallback)
          * Client-side metadata extraction from audio tags
          * Client-side FFmpeg WASM MP3 conversion with progress tracking
          * Form validation for title/author
          * Multi-phase progress UI (converting → uploading → saving)
     - `SongEditDialog` — song metadata editing with validation and error handling.

### 3. Lib

Shared utilities used across the app:

| Module | Responsibility |
|---|---|
| `lib/api/` | Typed HTTP client for backend separation endpoints only (30s timeout, logging) |
| `lib/api/song-creation.ts` | Three-step song upload: validation → FFmpeg MP3 conversion → Storage upload → Firestore save with rollback |
| `lib/api/separations.ts` | API client for stem separation proxy (submit, status) |
| `lib/audio/convertToMp3.ts` | Client-side audio/video → MP3 conversion using FFmpeg WASM (singleton, lazy-loaded from CDN) |
| `lib/async/` | Pending activity tracking for navigation guards (prevents leaving during uploads) |
| `lib/firebase/` | Firebase app initialization (singleton), auth helpers, Firestore CRUD (songs, users), Storage utilities |
| `lib/hooks/` | Custom React hooks (`useAuthGuard`, `useSongRawUrl`, `useSeparationStatus`, `useStemAutoProcessor`, etc.) |
| `lib/separations/` | Adapter pattern for provider-agnostic separation normalization and stem URL extraction |
| `lib/storage/` | Firebase Storage upload utilities (raw songs and separated stems) with rollback support |
| `lib/storage/StorageUrlManager.ts` | Centralized Firebase Storage download URL caching with TTL (1 day) based expiration, deduplication of concurrent requests, and automatic refresh on expiry. Ensures fast URL access for real-time playback switching without redundant Firebase calls. |
| `lib/store/` | Global state — `GlobalStateProvider` (React Context + useReducer) manages auth, songs, and player state |
| `lib/theme/muiTheme.ts` | Centralized MUI theme tokens and component defaults |
| `lib/validation/` | Zod-based validation schemas and functions (sign-in, user creation) |
| `lib/env.ts` | Typed, validated environment variable access |

## Authentication Flow

```
User browser
    │
    │  1. Sign in with Firebase Auth (Google / Email)
    ▼
Firebase Auth (client SDK)
    │
    │  2. Obtain ID token
    ▼
singlab-api
    │  Authorization: Bearer <idToken>
    │
    │  3. Guard verifies token with Firebase Admin SDK
    ▼
Protected endpoints
```

## Song Upload & Stem Processing Flows

### Song Upload Flow (Validation → Conversion → Storage → Firestore)

```
[User selects audio file via picker or drag-and-drop in SongCreateDialog]
     │
     │ 1. Client-side validation (size, format, MIME + extension fallback)
     │ 2. Metadata extraction from audio tags (optional, auto-fill title/artist)
     │ 3. Extract metadata if available
     ▼
[FFmpeg WASM converts audio/video to MP3 (if not already MP3)]
     │
     │ Uses [@ffmpeg/ffmpeg] loaded from CDN (single-threaded, no COOP/COEP needed)
     │ Fast path: if file is already MP3, returns unchanged
     │ Supports: MP3, WAV, OGG, WebM, MP4, MOV, FLAC, AAC, M4A
     │ VBR encoding (~192 kbps) for smaller file sizes
     │ Progress callback updates UI (0–100%)
     ▼
[User fills in Title and Author (can be auto-filled from metadata)]
     │
     │ Client-side validation of metadata fields
     ▼
[Generate stable songId (Firestore doc ID)]
[Upload MP3 to Storage: users/:userId/songs/:songId/raw.mp3]
     ▼
[Firebase Storage SDK uploads audio]
     │
     │ withPendingActivity() tracks upload
     │ Navigation guard prevents tab close
     ▼
[createSongDoc() writes directly to Firestore]
     │
     │ Creates song document at /users/{uid}/songs/{songId}
     │ No backend API call needed
     ▼
[Success]
     │
     │ If Firestore write fails → rollback: delete Storage file
     │ Real-time listener adds song to globalState
     ▼
[Song appears in dashboard]
```

### Stem Separation Processing Flow

Two provider paths are supported: `poyo` (async backend-proxied AI task) and
`local` (immediate manual stem upload).

#### `poyo` provider flow

```
[User opens SeparationDialog and selects provider = poyo]
     │
     │ 1. Get signed audio URL from Storage
     │ 2. POST /separations/submit { audioUrl, title }
     ▼
[Backend forwards request to PoYo API]
     │
     │ Returns provider response (taskId, status, etc.)
     ▼
[Frontend writes providerData to Firestore]
     │
     │ updateSeparatedSongInfo() writes to song doc
     ▼
[useSeparationStatus polls status every 60s]
     │
     │ GET /separations/status?taskId=xxx
     │ Backend fetches status from PoYo API
     │ Frontend writes updated providerData to Firestore
     │ Firestore listener propagates changes to globalState
     ▼
[Status: processing → finished]
     │
     │ useStemAutoProcessor detects: status=finished, stems=null
     │ Extracts stem URLs from providerData (via PoyoSeparationAdapter)
     ▼
[Client downloads stems from PoYo URLs]
     │
     │ processStemUrls(): downloads each stem as Blob
     │ Uploads to Storage: users/:userId/songs/:songId/stems/:stemName.mp3
     │ withPendingActivity() tracks uploads
     ▼
[Frontend writes stem paths directly to Firestore]
     │
     │ updateSeparationStems() updates song doc with paths + uploadedAt
     ▼
[Success]
     │
     │ If Firestore write fails → rollback: delete uploaded stems
     │ Real-time listener updates song.separatedSongInfo.stems
     ▼
[Stems available in GlobalPlayer]
```

#### `local` provider flow

```
[User opens SeparationDialog and selects provider = local]
     │
     │ Fills StemUploadForm (vocals required + at least one other stem)
     │ Client validates files and converts to MP3 when required
     ▼
[Client uploads stems directly to Firebase Storage]
     │
     │ uploadSeparationStem() for each selected stem
     ▼
[Frontend writes local separation data to Firestore]
     │
     │ updateSeparatedSongInfo() with provider='local' and stems paths
     ▼
[Stems immediately available in GlobalPlayer]
```

#### Stem reset flow

```
[User clicks "Delete stems" on song card]
     │
     │ Deletes stem files from Storage
     │ Sets separatedSongInfo=null in Firestore
     ▼
[Song becomes eligible for a new separation request]
```

## State Management

The app uses React built-ins (useState, useContext, useReducer) to keep the

requires it.

Global state is managed by `GlobalStateProvider` (`lib/store/`) using React
`useReducer` + Context. When a user is authenticated:

- **User profile** — data comes directly from Firebase Auth (name, email, UID)
- **Songs library** — subscribed to `/users/{uid}/songs` Firestore listener
  for real-time updates via `onSnapshot`
- **Player state** — `currentSongId` and `playbackStatus` managed in global state.
  Cards dispatch actions (`PLAYER_LOAD_SONG`) to trigger playback, and the
  `GlobalPlayer` component handles audio element control and UI rendering.

Server-side interactions that are not covered by real-time listeners (e.g.
fetching separation status from the backend proxy) are handled by dedicated
hooks (`useSeparationStatus`, `useSongRawUrl`) that call the REST API or
Firebase SDK directly.

## Audio Playback & Stem Separation

The app uses a single global audio player with centralized state management to
ensure a consistent playback experience. The player supports both raw audio
playback and separated stem playback with dynamic stem selection.

### Design Overview

The GlobalPlayer component supports two completely independent playback modes:

1. **Raw Mode** — Plays the original audio file as-is with a single audio element.
     Simple, no synchronization complexity.

2. **Separated Mode** — Plays isolated stems (vocals, bass, drums, piano, guitar, other).
     - Master track is chosen dynamically: the first audible (non-muted) stem serves as the source of truth for playback position; if no stems are audible, vocals is the fallback master
     - All other stems stay in lock-step with the master before and during playback
     - Volume is shared across all stems; disabling a stem mutes it but keeps it playing in sync with the master
     - Transport controls (play, pause, seek, volume) affect all stems equally

Raw and separated modes are completely independent:
- Each mode is built on-demand; the inactive mode never loads data (no memory waste)
- Switching between modes triggers a complete audio rebuild (old elements disposed, new ones created)
- This acts as an automatic song restart from 0 on the new source
- Raw and separated URLs are cached centrally via `StorageUrlManager` with 1-day TTL, so mode switches are instant

### Architecture

```
Song Cards (dashboard)
    │
    ├─→ useSeparationStatus(song)
    │       ├─→ Fetch separation status via separationsApi
     │       ├─→ Poll backend every 60s while processing (poyo provider)
    │       └─→ Display UI (request pending/progress/finished/failed)
    │
    │ dispatch({ type: 'PLAYER_LOAD_SONG', payload: songId })
    ▼
Global State (useReducer)
    │
    │ currentSongId, playbackStatus
    ▼
GlobalPlayer (component)
    │
    ├─→ useSongRawUrl(currentSong)
    │       └─→ Fetch/refresh signed URL for raw audio
    │
    ├─→ Unified Multi-Track Audio Engine
     │       ├─→ Loads only active source tracks (raw OR stems)
     │       ├─→ Stem selection changes volume (0 for deselected, base volume for selected)
     │       ├─→ playbackSource: 'raw' or 'separated'
     │       │   ├─→ raw mode: single audio element, simple transport
     │       │   └─→ separated mode: multi-stem playback with vocals as master
     │       ├─→ In separated mode: all non-vocal tracks stay synced to vocals' position
     │       ├─→ Stem selection changes which stems are audible (volume 0 = muted but still playing)
    │       ├─→ Deterministic synchronization on every play/resume/seek:
    │       │   └─→ prepareAt(time, autoResume):
    │       │         1. Pause all tracks
    │       │         2. Seek all to exactly `time` (currentTime, not fastSeek)
    │       │         3. syncAudioTracks() – aligns non-master tracks to master's
    │       │            settled frame (corrects sub-frame browser clamping)
    │       │         4. waitForAllTracksReady() – waits for all elements to reach
    │       │            readyState ≥ HAVE_FUTURE_DATA via 'canplay' events
    │       │            (5 s timeout safety net; stale attempts are cancelled)
     │       │         5. play() all active-track elements simultaneously
    │       │   Raises isSyncing=true for the whole operation, disabling all UI
    │       ├─→ Seek-scrub split: onChange only updates display + silently pauses;
    │       │   onChangeCommitted triggers prepareAt for the committed position
    │       ├─→ Buffering stall recovery: 'waiting'/'stalled' on master pauses
    │       │   non-master tracks; 'playing' re-syncs and restarts them
     │       └─→ Mode switch (raw ↔ separated):
     │           1. Cancel any in-flight sync operations
     │           2. Pause current audio elements
     │           3. Update playbackSource state
     │           4. trackKey changes → rebuild effect fires
     │           5. Rebuild disposes old elements, creates new ones for new mode
     │           6. Auto-play from 0 with cached URLs (instant mode switch)
    │
    └─→ Event handlers
            └─→ dispatch({ type: 'PLAYER_SET_STATUS', ... })
```

### Key Components


- **`GlobalPlayer` (`components/features/GlobalPlayer.tsx`)** — Single audio
  player component that manages multi-track synchronization for seamless playback
  of raw audio and separated stems.
  
  **Design Principles:**
  1. **Two independent playback modes** — Raw mode plays a single audio element.
     Separated mode plays multiple stem elements with vocals as the master track.
     Modes are completely independent; switching mode is a full audio rebuild.
  2. **Master-slave model (separated mode only)** — The first audible (unmuted) stem
     serves as the master track that drives playback position. All other stems follow
     the master's position and maintain perfect lock-step synchronization. If no stems
     are audible (all muted), vocals is the fallback master. In raw mode, there is only
     one element (the raw audio), so no synchronization is needed.
  3. **Event-driven synchronization via `prepareAt`** — Every play/resume/seek
     calls `prepareAt(time, autoResume)` which: pauses all tracks; seeks each to
     the exact same `currentTime` (avoiding `fastSeek` whose keyframe snapping
     varies per file); calls `syncAudioTracks()` to correct any sub-frame browser
     clamping; then waits for all elements to be buffered at that position
     (`readyState ≥ HAVE_FUTURE_DATA`) via `'canplay'` events before starting
     simultaneous playback. A 5-second timeout acts as a safety net.
  4. **`isSyncing` gate** — While `prepareAt` is running, all transport controls
     (play, stop, seek slider, source toggle, stem presets) are disabled and a
     spinner is shown, preventing conflicting user interactions.
  5. **Seek-scrub split** — The seek slider uses `onChange` to update only the
     displayed time (audio is silently paused during the drag), and
     `onChangeCommitted` to trigger the full `prepareAt` sync at the committed
     position. Avoids a buffer-fetch on every pixel of movement.
  6. **Buffering stall recovery** — `'waiting'`/`'stalled'` events on the master
     track pause all non-master tracks to prevent them drifting ahead. The
     master's `'playing'` event re-syncs and restarts them automatically.
  7. **Play-attempt tracking** — A monotonically increasing counter cancels stale
     in-flight syncs if the user quickly switches songs or issues conflicting
     commands.
  8. **URL caching strategy** — Raw audio and stem URLs are cached centrally via
       `StorageUrlManager` with 1-day TTL expiration. This ensures fast mode
       switching without redundant Firebase API calls. Concurrent requests for the
       same path are deduplicated, and expired URLs are automatically refreshed.
  
  Supports playback source selection (raw vs. separated), dynamic stem selection
  with preset mixes (vocals-only, instrumental, all stems), and volume control.
  All controls are disabled during loading/buffering/syncing for better UX.

- **Song Cards (`SongCardItem`)** — Display song metadata, play/edit/delete buttons,
  and separation status panel. The separation panel shows:
  - No separation requested: button to initiate separation
  - Processing: progress bar with refresh button
  - Finished: available stems with provider/task info
  - Failed: error message with retry button
  Uses `useSeparationStatus` hook for lifecycle management and polling.
  Clicking Play dispatches `PLAYER_LOAD_SONG` action to load the song into
  the global player. The "Now Playing" card shows a visual indicator and is
  pinned to the top of the list.

- **Global State** — `currentSongId` and `playbackStatus` tracked in the
     app-wide state managed by `GlobalStateProvider`. Audio events update the
     state, which triggers re-renders of the player UI. The `songs` array includes
     `separatedSongInfo` (provider data plus processed stem URLs with expiry
     metadata) which is updated in real-time via Firestore listener.

- **Separation Polling (`useSeparationStatus` hook)** — Manages the separation
  lifecycle for a song: submission via `separationsApi.requestSeparation()` (which
  gets a signed audio URL from Storage, sends it to the backend proxy, and writes
  provider data to Firestore), polling via `separationsApi.refreshSeparationStatus()`
  every 5 seconds while in-progress (writing updated status to Firestore), and
  error handling. Automatically sets up/tears down the polling interval based on
  task status.

### Benefits

- **Deterministic Synchronization** — All tracks are seeked to exactly the same
  `currentTime` (no `fastSeek` keyframe snapping). `syncAudioTracks()` corrects
  any residual sub-frame clamping before buffering begins, and playback starts only
  once every track has confirmed it is buffered at that position via `'canplay'`
  events.
- **Stall-Resilient Buffering** — Network stalls on the master track pause
  non-master tracks immediately; they are re-synced and restarted when the master
  recovers. A 5-second timeout prevents indefinitely stuck states.
- **Seamless Stem Switching** — All tracks always play, so switching stems is a
  pure volume change—no cold-start delays or playback interruption.
- **Mute-Resilient Playback** — Even when all stems are muted (volume=0), the master
  track is automatically chosen as the first audible stem, ensuring reliable
  synchronization. Browsers may pause muted audio elements when tabs are hidden,
  so this dynamic selection prevents time drift when users return to the tab while
  stems are muted.
- **Race-condition-free UI** — `isSyncing` disables all transport controls for
  the duration of any sync operation. A play-attempt counter cancels stale async
  operations on rapid user input or song switches.
- **Single Source of Truth** — Unified track map and master reference point;
  global state manages visibility and user intentions.
- **Persistent Controls** — Player always visible while song is loaded.
- **Clean Architecture** — Clear separation of concerns (cards fire PLAYER_LOAD_SONG,
  player manages audio engine and UI).

## Styling

The frontend uses a **Tailwind + MUI hybrid** strategy:

- **MUI** for interactive UI components (TextField, Button, Dialog, Card,
  Snackbar/Alert, layout primitives).
- **Tailwind CSS v4** for page-level layout utilities and decorative styling.

Tailwind v4 has no `tailwind.config.ts` — all Tailwind configuration,
including the `@theme` block and custom design tokens, lives in
[`app/globals.css`](app/globals.css).

### Design Token Palette

Two token families are registered and available as Tailwind utility classes
(`bg-brand-*`, `text-accent-*`, `border-brand-*`, etc.):

| Family | Range | Purpose |
|---|---|---|
| `brand` | 950 → 50 | Purple spectrum — page backgrounds, card surfaces, borders, muted text |
| `accent` | 700 → 100 | Electric indigo/blue — CTAs, focus rings, interactive highlights |

## Testing Strategy

| Layer | Tooling |
|---|---|
| Unit (components, hooks, utils) | Jest + React Testing Library |
| Integration (API client) | Jest + MSW (Mock Service Worker) |
| E2E (planned) | Playwright |

Test files live co-located with the source in `__tests__/` subfolders or as
`*.spec.tsx` siblings.
