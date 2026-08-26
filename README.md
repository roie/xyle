# Xyle

**Xyle is a visual editor that publishes changes back to static HTML and assets.**

```text
static folder → xyle → /edit → Publish → actual files changed
```

Xyle starts from the final static output — plain HTML, Astro, Hugo,
Eleventy, SvelteKit static export, Next static export, AI-generated HTML —
and never needs to know which tool produced it. The website *is* the content:
there is no content database, no source annotations, and no Xyle runtime on
normal public pages.

> Developers own structure and behavior. Editors own existing content.

## What v1 does

- `/edit` entry with one-owner high-entropy key login
- click-to-edit existing text in a sandboxed preview (site scripts and forms disabled)
- controlled `<br>` line breaks in paragraphs; headings reject them
- edit link text and destinations (`http(s)`, `mailto:`, `tel:`, relative)
- replace simple images, edit alt text, browse/upload raster media (`/__media/`)
- in-memory ChangeSet with undo/redo, per-change Undo, Changes drawer
- Publish patches the original source bytes narrowly — everything outside an
  edited range stays byte-for-byte identical
- Discard, stale-session `409 Conflict` handling, first-publish-wins
- atomic filesystem publisher (reference implementation)

## Quick start

```bash
pnpm install
pnpm build
pnpm exec tsx src/cli.ts init example/plain-html   # prints your editor key once
pnpm exec tsx src/cli.ts dev example/plain-html   # prints the local editor URL
```

Log in at `/edit` with the generated key, make edits, press **Publish**, then
inspect the files under `example/plain-html/` — the actual HTML changed.

## What v1 deliberately does not do

No page building, no new sections or pages, no CSS/layout editing, no form or
JS editing, no `picture`/`srcset` editing, no media deletion, no persisted
drafts (refreshing loses unpublished work — by design), no collaboration, no
content database.

## Developer handoff warning

Xyle edits final static output. It cannot back-propagate changes into
Astro/Hugo/etc. source templates. If you rebuild from framework source after
customer edits, use `xyle deploy`, which refuses to overwrite remote changes
made since your last managed deployment unless you pass `--force`.

## Development

```bash
pnpm check        # typecheck + unit tests + biome
pnpm test:e2e     # Playwright suite (Chromium/Firefox; WebKit needs host deps)
```

See [docs/architecture.md](docs/architecture.md) for the design,
[SECURITY.md](SECURITY.md) for the security model, and
[CONTRIBUTING.md](CONTRIBUTING.md) to contribute.
