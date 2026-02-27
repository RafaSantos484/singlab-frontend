# Contributing to SingLab Frontend

Thank you for your interest in contributing.

## How to Contribute

### Reporting Issues

- Check if the issue already exists.
- Provide clear steps to reproduce.
- Include relevant browser, OS, and Node version information.

### Submitting Pull Requests

1. Fork the repository.
2. Create a feature branch following the naming conventions below.
3. Make your changes.
4. Run tests (`npm test`).
5. Run the linter (`npm run lint`).
6. Format code (`npm run format`).
7. Run the type check (`npm run type-check`).
8. Commit your changes using conventional commits.
9. Push to the branch.
10. Open a Pull Request against `develop`.

#### Branch Naming Conventions

| Prefix | Use |
|---|---|
| `feat/` or `feature/` | New features |
| `fix/` | Bug fixes |
| `chore/` | Maintenance tasks |
| `refactor/` | Code refactoring |
| `style/` | Code style changes |
| `ci/` | CI/CD changes |
| `test/` | Test additions or changes |
| `docs/` | Documentation updates |
| `hotfix/` | Production hotfixes |

**Examples**:
- `feat/upload-form`
- `fix/audio-player-loop`
- `chore/update-dependencies`
- `docs/add-component-storybook`

#### Git Workflow

This project follows Git Flow:

- **`master`** — Production-ready code (auto-deploys).
- **`develop`** — Integration branch for features.
- **Feature branches** — Created from `develop`, merged back to `develop`.
- **Hotfix branches** — Created from `master`, merged to both `master` and `develop`.

**Pull Request rules (enforced by GitHub Actions)**:

To `master`:
- ✅ Only from `develop` (for releases)
- ✅ Only from `hotfix/*` (for urgent fixes)

To `develop`:
- ✅ From feature branches (`feat/*`, `fix/*`, `chore/*`, etc.)
- ✅ From `master` (for back-merges)

#### Commit Message Conventions

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>: <description>

[optional body]

[optional footer(s)]
```

**Types**: `feat`, `fix`, `chore`, `docs`, `style`, `refactor`, `test`, `ci`

**Examples**:
```bash
feat: add song upload form with drag-and-drop
fix: resolve audio player volume reset on track switch
chore: update tailwind to v4
docs: add component usage examples
ci: add lighthouse CI step
```

**Important**: Do NOT add scopes between type and colon (e.g., ~~`feat(player):`~~).

### Code Style

- Follow the existing code style (ESLint + Prettier).
- Use functional components and hooks — no class components.
- TypeScript strict mode is always enabled; never use `any`.
- Specify explicit return types on all exported functions.
- Keep components small and single-responsibility.
- Co-locate tests with their source file.

### Language Policy

All code, comments, documentation, and commit messages **must be in English**.
