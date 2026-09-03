# Xyle demo

`demo/site` is the tracked source for Xyle's deterministic demonstration website. It contains a coherent Home, About, and Contact experience.

Do not run Xyle against `demo/site` directly. Use the ignored writable copy at `demo/.workspace/site`.

## Run the browser demo

```bash
pnpm demo:dev
```

Open the printed `/demo/` URL. The browser demo does not require an editor key. Refresh the page to reset it.

For a WebMCP rehearsal, use [the demo prompts](JUDGE_PROMPTS.md) and [the three-minute recording script](DEMO_SCRIPT.md).

## Test the authenticated editor

Create the local workspace:

```bash
pnpm build
pnpm demo:reset
pnpm exec tsx src/cli.ts init demo/.workspace/site
```

The last command prints the editor key once. Keep it private.

Start Xyle against the workspace:

```bash
pnpm demo:workspace
```

Open the printed `/edit` URL. Sign in with the local editor key.

Run `pnpm demo:reset` to restore the tracked demo. The command keeps the existing local editor key.

## Edit as a person

Select visible content in the preview. Use Xyle's controls to edit text, links, media, formatting, structure, layout, and SEO. Review the Changes drawer before you publish.

Published demo changes update only `demo/.workspace/site`. They never modify the tracked canonical site.

## Edit with an agent

Open the editor in a browser with WebMCP support. Ask the agent to inspect the page and make the changes you want. Xyle exposes only the editing operations that are safe for the selected content.

Agent and human edits appear together in the Changes drawer. You can undo individual changes or a complete agent task. The agent cannot publish; publishing remains a human action.

## Test-only content

Playwright creates a temporary copy of `demo/site` and adds pages from `e2e/fixtures/site`. Tests publish only to that temporary directory. QA pages are not part of the public demo.
