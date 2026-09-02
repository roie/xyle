# Xyle demo

`demo/site` is the tracked source for Xyle's deterministic demonstration website. It contains a coherent Home, About, and Contact experience.

Do not run Xyle against `demo/site` directly. Use the ignored writable copy at `demo/.workspace/site`.

## First-time setup

Build Xyle and create the local workspace:

```bash
pnpm build
pnpm demo:reset
pnpm exec tsx src/cli.ts init demo/.workspace/site
```

The last command prints the editor key once. Keep it private.

## Run locally

```bash
pnpm demo:dev
```

Open the printed `/edit` URL and sign in with the local editor key.

Use `pnpm demo:reset` when you want a clean copy. The reset restores the tracked canonical site and keeps an existing local editor key.

## Edit as a person

Select visible content in the preview. Use Xyle's controls to edit text, links, media, formatting, structure, layout, and SEO. Review the Changes drawer before you publish.

Published demo changes update only `demo/.workspace/site`. They never modify the tracked canonical site.

## Edit with an agent

Open the editor in a browser with WebMCP support. Ask the agent to inspect the page and make the changes you want. Xyle exposes only the editing operations that are safe for the selected content.

Agent and human edits appear together in the Changes drawer. You can undo individual changes or a complete agent task. The agent cannot publish; publishing remains a human action.

## Test-only content

Playwright creates a temporary copy of `demo/site` and adds pages from `e2e/fixtures/site`. Tests publish only to that temporary directory. QA pages are not part of the public demo.
