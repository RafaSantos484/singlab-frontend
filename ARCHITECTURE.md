# SingLab Frontend — Architecture Overview

## High-Level Architecture

```
┌───────────────────────────────────────────────────────────────────┐
│  Browser / User                                                   │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │  Next.js App Router (singlab-frontend)                      │ │
│  │                                                             │ │
│  │  Pages & Layouts         Components            Lib (utils)     │ │
│  │  ─────────────────       ──────────────         ──────────     │ │
│  │  app/layout.tsx          features/GlobalPlayer  api/songs      │ │
│  │  app/page.tsx            ui/…                   firebase/auth  │ │
│  │  app/login/              …                      hooks/useAuth  │ │
│  │  app/dashboard/                                 hooks/useSong  │ │
│  └──────────────┬──────────────────────────────────────────────┘ │
└─────────────────│─────────────────────────────────────────────────┘
                  │  HTTP (REST)
                  ▼
┌───────────────────────────────────────────────────────────────────┐
│  singlab-api (NestJS + Firebase Functions)                       │
│                                                                   │
│  POST /songs            ← Register song (JSON metadata only)     │
│  GET  /songs            ← List user songs                        │
│  GET  /songs/:id        ← Get song details                        │
│  GET  /songs/:id/raw/url ← Get (and refresh) signed audio URL    │
│  POST /songs/:id/separation ← Request stem separation            │
│  PUT  /songs/:id/separation/stems ← Update stem storage paths    │
└──────────────────────────────────┬────────────────────────────────┘
                                   │
                    ┌──────────────┼──────────────┐
                    │              │              │
                    ▼              ▼              ▼
             ┌────────────┐ ┌──────────┐ ┌─────────────┐
             │ Stem Split │ │  ASR /   │ │  Firestore  │
             │ API (PoYo) │ │ Transcr. │ │  + Storage  │
             │            │ │(OpenAI / │ │ (raw audio  │
             │            │ │ AssemblyAI) │ and stems)  │
             └────────────┘ └──────────┘ └─────────────┘
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
     - `SongCreateDialog` — upload workflow with:
          * File picker + drag-and-drop support
          * Audio format validation (MIME type + extension fallback)
          * Client-side metadata extraction from audio tags
          * Client-side FFmpeg WASM MP3 conversion with progress tracking
          * Form validation for title/author
          * Multi-phase progress UI (converting → uploading → registering)
     - `SongEditDialog` — song metadata editing with validation and error handling.

### 3. Lib

Shared utilities used across the app:

| Module | Responsibility |
|---|---|
| `lib/api/` | Typed HTTP client wrapping `singlab-api` endpoints (includes 30s request timeout and logging) |
| `lib/api/song-creation.ts` | Three-step song upload: validation → FFmpeg MP3 conversion → Storage upload → API registration with rollback |
| `lib/audio/convertToMp3.ts` | Client-side audio/video → MP3 conversion using FFmpeg WASM (singleton, lazy-loaded from CDN) |
| `lib/api/separations.ts` | API client for stem separation operations (request, refresh, update stems) |
| `lib/async/` | Pending activity tracking for navigation guards (prevents leaving during uploads) |
| `lib/firebase/` | Firebase app initialization (singleton) and auth helpers |
| `lib/hooks/` | Custom React hooks (`useAuthGuard`, `useSongRawUrl`, `useSeparationStatus`, `useStemAutoProcessor`, etc.) |
| `lib/separations/` | Adapter pattern for provider-agnostic separation normalization and stem URL extraction |
| `lib/storage/` | Firebase Storage upload utilities (raw songs and separated stems) with rollback support |
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

### Song Upload Flow (Three-Step: Validation → Conversion → Storage → API)

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
[POST /songs with { songId, title, author }]
     │
     │ Backend validates Storage file exists
     │ Creates Firestore document
     ▼
[Success]
     │
     │ If API call fails → rollback: delete Storage file
     │ Real-time listener adds song to globalState
     ▼
[Song appears in dashboard]
```

### Stem Separation Processing Flow

```
[User clicks "Request Separation" on song card]
     │
     │ POST /songs/:id/separation
     ▼
[Backend initiates PoYo separation task]
     │
     │ Firestore updated with providerData.taskId
     ▼
[useSeparationStatus polls status every 5s]
     │
     │ Backend polls PoYo API and updates Firestore providerData
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
[PUT /songs/:id/separation/stems with storage paths]
     │
     │ Backend validates Storage files exist
     │ Updates Firestore with stem paths + expiry metadata
     ▼
[Success]
     │
     │ If API call fails → rollback: delete uploaded stems
     │ Real-time listener updates song.separatedSongInfo.stems
     ▼
[Stems available in GlobalPlayer]
```

## State Management

The app uses React built-ins (useState, useContext, useReducer) to keep the
bundle small. No external state management library is added until complexity
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
refreshing a signed URL) are handled by dedicated hooks (`useSongRawUrl`) that
call the REST API directly.

## Audio Playback & Stem Separation

The app uses a single global audio player with centralized state management to
ensure a consistent playback experience. The player supports both raw audio
playback and separated stem playback with dynamic stem selection.

### Architecture

```
Song Cards (dashboard)
    │
    ├─→ useSeparationStatus(song)
    │       ├─→ Fetch separation status via separationsApi
    │       ├─→ Poll backend every 5s while processing
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
    │       ├─→ All tracks (raw + stems) always play simultaneously
    │       ├─→ Stem selection only changes volume (0 for deselected, base volume for selected)
    │       ├─→ Deterministic synchronization on every play/resume/seek:
    │       │   └─→ prepareAt(time, autoResume):
    │       │         1. Pause all tracks
    │       │         2. Seek all to exactly `time` (currentTime, not fastSeek)
    │       │         3. syncAudioTracks() – aligns non-master tracks to master's
    │       │            settled frame (corrects sub-frame browser clamping)
    │       │         4. waitForAllTracksReady() – waits for all elements to reach
    │       │            readyState ≥ HAVE_FUTURE_DATA via 'canplay' events
    │       │            (5 s timeout safety net; stale attempts are cancelled)
    │       │         5. play() all tracks simultaneously
    │       │   Raises isSyncing=true for the whole operation, disabling all UI
    │       ├─→ Seek-scrub split: onChange only updates display + silently pauses;
    │       │   onChangeCommitted triggers prepareAt for the committed position
    │       ├─→ Buffering stall recovery: 'waiting'/'stalled' on master pauses
    │       │   non-master tracks; 'playing' re-syncs and restarts them
    │       └─→ Source switch (raw ↔ separated): changing playbackSource updates
    │           the tracks memo → trackKey → triggers rebuild useEffect, which
    │           disposes old elements, creates fresh ones, and auto-plays from 0
    │
    └─→ Event handlers
            └─→ dispatch({ type: 'PLAYER_SET_STATUS', ... })
```

### Key Components

- **`GlobalPlayer` (`components/features/GlobalPlayer.tsx`)** — Single audio
  player component that manages multi-track synchronization for seamless playback
  of raw audio and separated stems.
  
  **Design Principles:**
  1. **All tracks always play simultaneously** — Selecting/deselecting stems only
     changes volume (0 = muted, current volume = audible), eliminating cold-start
     issues and guaranteeing perfect sync.
  2. **Event-driven synchronization via `prepareAt`** — Every play/resume/seek
     calls `prepareAt(time, autoResume)` which: pauses all tracks; seeks each to
     the exact same `currentTime` (avoiding `fastSeek` whose keyframe snapping
     varies per file); calls `syncAudioTracks()` to correct any sub-frame browser
     clamping; then waits for all elements to be buffered at that position
     (`readyState ≥ HAVE_FUTURE_DATA`) via `'canplay'` events before starting
     simultaneous playback. A 5-second timeout acts as a safety net.
  3. **`isSyncing` gate** — While `prepareAt` is running, all transport controls
     (play, stop, seek slider, source toggle, stem presets) are disabled and a
     spinner is shown, preventing conflicting user interactions.
  4. **Seek-scrub split** — The seek slider uses `onChange` to update only the
     displayed time (audio is silently paused during the drag), and
     `onChangeCommitted` to trigger the full `prepareAt` sync at the committed
     position. Avoids a buffer-fetch on every pixel of movement.
  5. **Buffering stall recovery** — `'waiting'`/`'stalled'` events on the master
     track pause all non-master tracks to prevent them drifting ahead. The
     master's `'playing'` event re-syncs and restarts them automatically.
  6. **Play-attempt tracking** — A monotonically increasing counter cancels stale
     in-flight syncs if the user quickly switches songs or issues conflicting
     commands.
  7. **Source switching (raw ↔ separated)** — The `tracks` memo is
     source-dependent: raw mode builds only the raw element; separated mode
     builds only stem elements. Switching source changes `playbackSource`
     state, which changes `tracks` → `trackKey`, which triggers the rebuild
     `useEffect`. The rebuild disposes old elements, creates fresh ones for
     the new source, and auto-plays from 0 – equivalent to a song restart.
  
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
  lifecycle for a song: submission via `separationsApi.requestSeparation()`,
  polling via `separationsApi.refreshSeparationStatus()` every 5 seconds while
  in-progress, and error handling. Automatically sets up/tears down the polling
  interval based on task status.

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
