# Xyle

**Xyle is an open-source visual editor for non-technical owners of static websites.**

Xyle publishes reviewed changes back to the site's HTML and assets.

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
- safe text editing preserves existing `<br>` structure; new line-break editing is deferred
- edit link text and destinations (`http(s)`, `mailto:`, `tel:`, relative)
- replace simple images, edit alt text, browse/upload raster media (`/__media/`)
- in-memory ChangeSet with undo/redo, per-change Undo, Changes drawer
- Publish patches the original source bytes narrowly — everything outside an
  edited range stays byte-for-byte identical
- Discard, stale-session `409 Conflict` handling, first-publish-wins
- per-file atomic replacement with rollback for filesystem publication
- browser-native WebMCP tools for shared human and agent editing
- safe section visibility, sibling reordering, duplication, Groups, and Layout controls with shared undo/history

## Quick start

```bash
cd /path/to/static-output
npx xyle init .
npx xyle dev .
```

The `init` command prints the editor key once. The `dev` command prints the public and editor URLs.

Open the editor URL and publish a change. Xyle writes the change to the static HTML and asset files.

To run the deterministic Xyle demo:

```bash
pnpm demo:reset
pnpm demo:dev
```

See [demo/README.md](demo/README.md) for first-time setup.

## Host `/edit` on Cloudflare Pages

Create a Cloudflare API token with **Cloudflare Pages: Edit** access for the owner's account. Put the token in the `CLOUDFLARE_API_TOKEN` environment variable with a credential manager or a hidden terminal prompt. Do not put it in a file inside the website.

Then run:

```bash
cd /path/to/static-output
npx xyle cloudflare . --project=my-static-site --account-id=YOUR_ACCOUNT_ID
```

This command creates or validates a Direct Upload Pages project, creates the owner credentials, stores the required encrypted Pages secrets, and deploys the complete static site with Xyle. It prints the editor key once and gives the owner `https://my-static-site.pages.dev/edit`.

Xyle refuses to adopt an existing project unless its managed snapshot is current. Use `--force` only after you confirm that Xyle can replace the selected Direct Upload project. Git-integrated Pages projects are not supported by this command.

The deployed editor publishes complete, storage-free Pages snapshots. The website files remain the content source of truth. The runtime token is required so an owner-approved publish can create the next deployment; it is never sent to the browser.

## Edit with an agent

Open Xyle edit mode in a browser with WebMCP support. Ask the agent to inspect
the page and make the changes you want. The agent uses Xyle's safe editing
capabilities for content, media, structure, layout, and SEO.

Human and agent edits appear in the same Changes drawer. Review or undo any
change before you publish. Publishing remains an explicit human action.

Log in at `/edit` with the generated key, make edits, press **Publish**, then
inspect your static output directory — the actual HTML changed.

## What v1 deliberately does not do

No page building, no new sections or pages, no arbitrary CSS editing, no form or
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
pnpm check          # typecheck + unit tests + biome
pnpm test:coverage  # report focused unit coverage without a threshold
pnpm test:e2e       # Playwright suite (Chromium/Firefox; WebKit needs host deps)
pnpm test:package              # pack, install, edit, publish, and reload a temporary static site
pnpm test:website              # build and test the product homepage and isolated browser demo
pnpm test:cloudflare-runtime   # run the packaged Pages Worker locally with workerd
pnpm release:check             # run the complete local release matrix in sequence
```

The release check includes WebKit. Run it on a host with the documented WebKit system libraries. It also runs native Chrome WebMCP checks with the required browser flags.

See [docs/architecture.md](docs/architecture.md) for the design,
[docs/COVERAGE_BASELINE.md](docs/COVERAGE_BASELINE.md) for the initial unit coverage report,
[SECURITY.md](SECURITY.md) for the security model,
[docs/webmcp.md](docs/webmcp.md) for the WebMCP interface, and
[CONTRIBUTING.md](CONTRIBUTING.md) to contribute.
