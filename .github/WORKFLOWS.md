# GitHub Actions Workflows

This document describes the CI/CD workflow setup for `singlab-frontend`.

## 📋 Workflows Overview

| Workflow | File | Trigger |
|---|---|---|
| Branch Validation | `branch-enforcer.yml` | Pull Request |
| CI | `ci.yml` | Pull Request + push to `develop` |
| Deploy to Production | `deploy.yml` | Push to `main` / `master` |

---

## 1️⃣ Branch Validation (`branch-enforcer.yml`)

### Objective
Enforce branch naming conventions and merge rules to maintain Git Flow integrity.

### Branch Rules

**For `main` / `master`:**
- ✅ PRs only from `develop` or `hotfix/*`
- ❌ Rejects all other branches

**For `develop`:**
- ✅ `feat/*`, `feature/*`, `fix/*`, `chore/*`, `refactor/*`, `style/*`, `ci/*`, `test/*`, `docs/*`, `hotfix/*`
- ✅ Back-merges from `main` / `master`
- ❌ Rejects random branches

### Permissions
`contents: read`, `statuses: write`, `pull-requests: read`

---

## 2️⃣ Continuous Integration (`ci.yml`)

### Objective
Validate code on all pull requests and pushes to `develop`.

### Parallel Jobs

**1. Lint** (10 min)
```yaml
- npm run lint   # ESLint + Prettier check
```

**2. Type-Check** (10 min)
```yaml
- npm run type-check   # tsc --noEmit
```

**3. Test** (15 min)
```yaml
- npm run test:coverage   # Jest with coverage
- Codecov upload          # Coverage tracking
- Artifact: coverage/     # Preserved 7 days
```

**4. Build** (15 min) — depends on lint + type-check + test
```yaml
- npm run build            # Next.js production build
- Verify .next/ directory  # Artifact: next-build/
```

### Concurrency
`cancel-in-progress: true` — cancels stale runs on the same branch.

### Permissions
`contents: read`, `statuses: write`, `checks: write`, `pull-requests: write`

---

## 3️⃣ Deploy to Production (`deploy.yml`)

### Objective
Build and deploy to **Vercel** on push to `main` / `master`.

### Stages

**1. validate** — Full suite (type-check + lint + test + build).
Outputs `should-deploy: true` when all checks pass.

**2. deploy** — Deploys to Vercel using Vercel CLI.

### Required Secrets / Variables
See [SECRETS_SETUP.md](SECRETS_SETUP.md) for configuration details.

### Deployment Target
Vercel is the recommended hosting platform for Next.js.
The production environment URL is captured as a GitHub deployment.

---

## Git Flow Summary

```
feature/fix/chore branches
         │
         │  PR → develop
         ▼
      develop  ──── CI runs ────► pass
         │
         │  PR → main
         ▼
        main  ──── Deploy runs ────► Vercel production
```
