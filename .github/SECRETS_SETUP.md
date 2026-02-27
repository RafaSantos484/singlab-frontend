# Secrets & Variables Setup

This document describes all GitHub Actions secrets and variables required for
CI and deployment of `singlab-frontend`.

## Repository Variables (`vars.*`)

These are non-sensitive configuration values. Set them in
**Settings → Secrets and variables → Actions → Variables**.

| Variable | Description | Example |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | Production URL of `singlab-api` | `https://api.singlab.app` |
| `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` | Firebase auth domain | `my-project.firebaseapp.com` |
| `NEXT_PUBLIC_FIREBASE_PROJECT_ID` | Firebase project ID | `my-project` |
| `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET` | Firebase storage bucket | `my-project.appspot.com` |

## Repository Secrets (`secrets.*`)

Sensitive values. Set them in
**Settings → Secrets and variables → Actions → Secrets**.

| Secret | Description |
|---|---|
| `VERCEL_TOKEN` | Vercel personal access token for CLI deploy |
| `NEXT_PUBLIC_FIREBASE_API_KEY` | Firebase web API key |
| `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID` | Firebase messaging sender ID |
| `NEXT_PUBLIC_FIREBASE_APP_ID` | Firebase app ID |

## How to Obtain the Values

### Vercel Token
1. Go to https://vercel.com/account/tokens
2. Create a new token with scope **Full Account**.
3. Copy and save as `VERCEL_TOKEN` secret.

### Firebase Config
1. Open the [Firebase Console](https://console.firebase.google.com/).
2. Go to **Project Settings → Your apps → Web app**.
3. Find the `firebaseConfig` object and map each field to the corresponding
   variable above.

## Local Development

For local development, copy `.env.local.example` to `.env.local` and fill in
the values. This file is gitignored and never committed.

```bash
cp .env.local.example .env.local
```
