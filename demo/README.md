# Xyle demo

This deterministic static site demonstrates Xyle's human visual editor and its WebMCP interface. Both interfaces use the same pending changes, undo history, safety checks, and human-controlled publish action.

## First-time setup

Build Xyle and reset the demo site:

```bash
pnpm build
pnpm demo:reset
```

Create a local editor key if the demo does not already have one:

```bash
pnpm exec tsx src/cli.ts init demo/site
```

The command prints the editor key once. Keep it private.

## Run locally

```bash
pnpm demo:dev
```

Open the printed `/edit` URL and sign in with the local editor key.

Use `pnpm demo:reset` when you want a clean copy of the demo. The reset keeps an existing local editor key and removes unpublished demo changes.

## Edit as a person

Select visible content in the preview. Use Xyle's controls to edit text, links, media, formatting, structure, layout, and SEO. Review the Changes drawer before you publish.

## Edit with an agent

Open the editor in a browser with WebMCP support. Ask the agent to inspect the page and make the changes you want. Xyle exposes only the editing operations that are safe for the selected content.

Agent and human edits appear together in the Changes drawer. You can undo individual changes or a complete agent task. The agent cannot publish; publishing remains a human action.
