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
│  │  app/layout.tsx          features/SongPlayer api/songs      │ │
│  │  app/page.tsx            ui/…                firebase/auth  │ │
│  │  app/login/              …                   hooks/useAuth  │ │
│  │  app/dashboard/                              hooks/useSong  │ │
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
     - `SongPlayer` — inline `<audio>` player; delegates signed URL management to
          `useSongRawUrl`.
     - `SongCreateDialog` — upload workflow (metadata + file validation + API).

### 3. Lib

Shared utilities used across the app:

| Module | Responsibility |
|---|---|
| `lib/api/` | Typed HTTP client wrapping `singlab-api` endpoints |
| `lib/api/song-creation.ts` | Song upload validation and orchestration logic |
| `lib/firebase/` | Firebase app initialization (singleton) and auth helpers |
| `lib/hooks/` | Custom React hooks (`useAuthGuard`, `useSongRawUrl`) |
| `lib/store/` | Global state — `GlobalStateProvider` (React Context + useReducer) |
| `lib/theme/muiTheme.ts` | Centralized MUI theme tokens and component defaults |
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

Server-side interactions that are not covered by real-time listeners (e.g.
refreshing a signed URL) are handled by dedicated hooks (`useSongRawUrl`) that
call the REST API directly.

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
