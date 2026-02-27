# SingLab Frontend — Architecture Overview

## High-Level Architecture

```
┌───────────────────────────────────────────────────────────────────┐
│  Browser / User                                                   │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │  Next.js App Router (singlab-frontend)                      │ │
│  │                                                             │ │
│  │  Pages & Layouts         Components         Lib (utils)     │ │
│  │  ─────────────────       ──────────────      ──────────     │ │
│  │  app/layout.tsx          ui/Button           api/songs      │ │
│  │  app/page.tsx            ui/AudioPlayer      firebase/auth  │ │
│  │  app/(routes)/           features/Submit     hooks/useJob   │ │
│  │                          features/Library                    │ │
│  └──────────────┬──────────────────────────────────────────────┘ │
└─────────────────│─────────────────────────────────────────────────┘
                  │  HTTP (REST)
                  ▼
┌───────────────────────────────────────────────────────────────────┐
│  singlab-api (NestJS + Firebase Functions)                       │
│                                                                   │
│  POST /songs/upload     ← Submit audio file                      │
│  GET  /songs            ← List user songs                        │
│  GET  /songs/:id        ← Get song details + tracks              │
│  GET  /songs/:id/status ← Poll job status                        │
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
| `/library` | User's song library |
| `/upload` | Submit a new song (file or link) |
| `/songs/[id]` | Song detail + karaoke player |

### 2. Components

Components are split into two groups:

- **`components/ui/`** — Primitive, stateless components (Button, Input,
  AudioPlayer, Badge, etc.)
- **`components/features/`** — Feature-specific composite components that
  contain business logic (SongCard, UploadForm, JobStatusBanner, etc.)

### 3. Lib

Shared utilities used across the app:

| Module | Responsibility |
|---|---|
| `lib/api/` | Typed HTTP client wrapping `singlab-api` endpoints |
| `lib/firebase/` | Firebase app initialization (singleton) and auth helpers |
| `lib/hooks/` | Custom React hooks (useJobStatus, useAudioPlayer, etc.) |
| `lib/types/` | Shared TypeScript types and interfaces |

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

Global state candidates:
- Auth state: React Context (wrapping Firebase auth)
- Song library: React Query / SWR (data fetching + caching, planned)

## Styling

Tailwind CSS with the Next.js PostCSS integration. Design tokens (colors,
spacing) are configured in `tailwind.config.ts`.

## Testing Strategy

| Layer | Tooling |
|---|---|
| Unit (components, hooks, utils) | Jest + React Testing Library |
| Integration (API client) | Jest + MSW (Mock Service Worker) |
| E2E (planned) | Playwright |

Test files live co-located with the source in `__tests__/` subfolders or as
`*.spec.tsx` siblings.
