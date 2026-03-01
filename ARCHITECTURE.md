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
│  POST /songs/upload     ← Submit audio file                      │
│  GET  /songs            ← List user songs                        │
│  GET  /songs/:id        ← Get song details                        │
│  GET  /songs/:id/raw/url ← Get (and refresh) signed audio URL    │
└──────────────────────────────────┬────────────────────────────────┘
                                   │
                    ┌──────────────┼──────────────┐
                    │              │              │
                    ▼              ▼              ▼
             ┌────────────┐ ┌──────────┐ ┌─────────────┐
             │ Stem Split │ │  ASR /   │ │  Firestore  │
             │ API        │ │ Transcr. │ │  + Storage  │
             │(Moises /   │ │(OpenAI / │ │             │
             │ LALAL.AI)  │ │ AssemblyAI)             │
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
     - `SongCreateDialog` — upload workflow (metadata + file validation + API).
     - `SongEditDialog` — song metadata editing with validation and error handling.

### 3. Lib

Shared utilities used across the app:

| Module | Responsibility |
|---|---|
| `lib/api/` | Typed HTTP client wrapping `singlab-api` endpoints |
| `lib/api/song-creation.ts` | Song upload validation and orchestration logic |
| `lib/api/separations.ts` | API client for stem separation operations (request and refresh) |
| `lib/firebase/` | Firebase app initialization (singleton) and auth helpers |
| `lib/hooks/` | Custom React hooks (`useAuthGuard`, `useSongRawUrl`, `useSeparationStatus`) |
| `lib/separations/` | Adapter pattern for provider-agnostic separation normalization and polling |
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

## Job Processing Flow (Frontend Perspective)

```
[Upload Form]
     │
     │ POST /songs/upload  (multipart or { url })
     ▼
[API returns jobId]
     │
     │ Poll GET /songs/:id/status every N seconds
     ▼
[Status: PROCESSING → COMPLETED]
     │
     │ Fetch full song data (tracks: original, vocal, instrumental)
     ▼
[Karaoke Player]
     │  Switch between: original / vocal-only / instrumental
     │  Display transcribed lyrics
     ▼
[Practice mode]
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
    │       ├─→ Stem selection only changes volume (0 for deselected, current volume for selected)
    │       ├─→ Simplified synchronization before play/seek:
    │       │   └─→ prepareAt(time, autoResume) pauses, seeks all tracks, syncs them, then plays all
    │       └─→ Manual sync on source switch (raw ↔ separated)
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
  2. **Simplified synchronization before play** — `prepareAt(time, autoResume)`
     pauses all tracks, seeks to `time`, syncs current times, waits 50ms for
     readiness (especially on mobile/cached audio), then calls `.play()` on all
     tracks in a coordinated burst. Prevents race conditions where some tracks
     remain paused while others play.
  3. **Play attempt tracking** — Cancels stale play attempts if a user quickly
     switches songs or clicks play/pause multiple times, preventing state
     desynchronization.
  4. **Manual sync on source switch** — Explicitly syncs all tracks and reapplies
     volume when switching between raw and separated sources (50ms delay for
     mobile readiness).
  
  Supports playback source selection (raw vs. separated), dynamic stem selection
  with preset mixes (vocals-only, instrumental, all stems), and volume control.
  All controls are disabled during loading/buffering for better UX.

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

- **Perfect Synchronization** — Barrier-based coordination ensures no track
  ever drifts, eliminating audio sync issues common in multi-track playback.
- **Robust Buffering** — Automatic rebuffering on network stalls prevents playback
  interruptions; watchdog timer prevents stuck loading states.
- **Seamless Stem Switching** — All tracks always play, so switching stems is a
  pure volume change—no cold-start delays or playback interruption.
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
