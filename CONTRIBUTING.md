# Contributing to Custom-PI

Thanks for considering a contribution. Custom-PI is a self-evolving autonomous AI coding agent with knowledge graph memory, DAG swarm orchestration, and free image generation.

## Getting started

1. Fork and clone the repo.
2. Ensure Node.js >= 18.0.0 is installed.
3. Install dependencies:
   ```bash
   npm install
   ```
4. For browser automation (social posting), install Playwright:
   ```bash
   npx playwright install chromium
   ```
5. Copy `.env.example` to `.env` and configure your API keys (optional — most features work without any).

## Good first issues

Look for issues tagged [`good first issue`](https://github.com/IamNishant51/Custom-PI/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22) on this repo. If none are open, check the "Known Limitations" in docs/ or look for TODO comments in the source.

## Code conventions

- **TypeScript** with strict mode — no `any` unless absolutely necessary.
- **ES modules** (`import`/`export`) — no CommonJS `require()` in new code.
- **React** — functional components with hooks, default exports for pages.
- **Tests** — Vitest for unit/integration tests, run with `npm test`.
- Run `npm test && npx tsc --noEmit` before opening a PR.

## Pull request process

1. One focused change per PR — don't bundle unrelated fixes.
2. Reference the issue your PR addresses.
3. Describe what you tested, not just what you changed.
4. Ensure all CI checks pass (tests, type-check, lint).
