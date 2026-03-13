# Quick Start — SingLab Frontend

This guide gets you from zero to a running local development environment.

## Prerequisites

| Tool | Version | Notes |
|---|---|---|
| Node.js | 18+ | Firebase Functions v2 requirement |
| npm | 9+ | Bundled with Node.js |

## 1. Clone the repository

```bash
git clone https://github.com/your-org/singlab-frontend.git
cd singlab-frontend
```

## 2. Install dependencies

```bash
npm install
```

## 3. Configure environment variables

```bash
cp .env.local.example .env.local
```

Open `.env.local` and fill in the values:

```env
# URL of the local singlab-api instance
NEXT_PUBLIC_API_URL=http://localhost:5001

# Firebase client credentials (same Firebase project as singlab-api)
NEXT_PUBLIC_FIREBASE_API_KEY=your-api-key
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=your-project-id.firebaseapp.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=your-project-id
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=your-project-id.appspot.com
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=your-sender-id
NEXT_PUBLIC_FIREBASE_APP_ID=your-app-id
```

You can find these values in the Firebase console under
**Project Settings → Your apps → Web app**.

## 4. Start the development server

```bash
npm run dev
```

Local app: http://localhost:3000

## 4.1 (Optional) Enable Storage CORS for Practice vocals pitch chart

If you want live pitch analysis in Singing Practice Mode with stems loaded from
Firebase Storage, configure CORS on the storage bucket.

```bash
cp cors.example.json cors.json
# Edit cors.json and replace origins with your local/prod origins
gcloud storage buckets update gs://<your-storage-bucket> --cors-file=cors.json
```

If CORS is not configured, playback still works and microphone tracking still
works, but vocals-stem waveform analysis is disabled.

## 5. (Optional) Start the backend locally

The frontend communicates with `singlab-api`. To run it locally, follow the
[singlab-api Quick Start](https://github.com/your-org/singlab-api/blob/develop/QUICKSTART.md)
and ensure `NEXT_PUBLIC_API_URL` points to the local API.

## Scripts Reference

```bash
npm run dev           # Start Next.js dev server (hot reload)
npm run build         # Production build
npm run start         # Serve production build locally
npm run lint          # Run ESLint
npm run format        # Format with Prettier
npm run type-check    # TypeScript type check (no emit)
npm test              # Run Jest tests
npm run test:watch    # Jest in watch mode
npm run test:coverage # Jest with coverage report
```

## Troubleshooting

### Firebase auth errors on first load

Make sure `.env.local` has valid Firebase credentials. If `NEXT_PUBLIC_API_URL`
points to the local `singlab-api` and that server has `SKIP_AUTH=true`, you can
still call API endpoints without a token during development.

### Port already in use

```bash
# Kill whatever is on port 3000
npx kill-port 3000
npm run dev
```

### TypeScript errors after pulling changes

```bash
npm install        # sync dependencies
npm run type-check # verify
```

### Linting / Pre-commit checks

Before committing changes, run the linter and type-check to catch issues early:

```bash
npm run lint
npm run type-check
```
