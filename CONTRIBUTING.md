# Contributing to Xyle

## Ground rules

These constraints are design decisions, not accidents. Proposals that
violate them need a design discussion first:

1. Static files are the canonical published content; no content database.
2. Publish patches original source ranges narrowly. Never serialize browser DOM.
3. No required source annotations (`data-xyle` etc.) on customer sites.
4. No frontend/HTTP/schema frameworks in the core (parse5 is the only runtime dep).
5. Normal public pages load no Xyle JavaScript.
6. Unpublished edits live only in the current browser session.
7. Fail closed instead of guessing.

## Workflow

```bash
pnpm install
pnpm check          # Must pass: typecheck + vitest + biome
pnpm build          # bundles src/editor.ts → dist/editor.js
pnpm test:e2e       # Playwright across Chromium/Firefox (WebKit needs OS deps)
```

- Keep `src/` flat unless a file genuinely outgrows review.
- New behavior needs tests: unit tests for engine code, Playwright for
  browser behavior, and a security regression case for anything attack-facing.
- Editing-fidelity changes must keep the cross-browser matrix green or must
  reduce the supported editing surface explicitly (fail closed).
- Provider-specific logic belongs in `src/publishers/<provider>.ts` only.

## Commit style

Short imperative subject, no scope noise: `feat: add static media editing`.
