# Security model

## Authentication

- `xyle init` generates a 256-bit editor key (not a human password) and an
  independent session-signing secret. Secrets live in `.xyle/secrets.local.json`
  with `0600` permissions and are git-ignored.
- Login compares the SHA-256 digest of the submitted key using constant-time
  byte comparison. The high-entropy key makes online guessing impractical, so
  no password KDF or rate-limit database is required in v1.
- Sessions are HMAC-SHA-256 signed stateless cookies: `HttpOnly`,
  `SameSite=Strict`, `Path=/`, 8-hour maximum lifetime. No cross-site OAuth
  flow exists because these assumptions are deliberate.

## Mutating requests

Every mutation (publish) requires **all** of:

1. a valid session cookie
2. `POST`
3. accepted content type
4. exact expected `Origin`
5. the custom `X-Xyle-Request: 1` header

The custom header prevents HTML-form CSRF; Origin checking blocks cross-site
scripted requests. No permissive CORS is shipped.

## Preview isolation

The editing preview is a sandboxed `iframe` (`sandbox="allow-same-origin"`,
never `allow-scripts`/`allow-forms`) fed via `srcdoc`. Authored site scripts
do not execute and forms cannot submit while editing. Preview-only
instrumentation (`data-xyle-node`, injected `<base>`) never reaches published
bytes.

## Input validation

- Link destinations: relative/`http:`/`https:`/`mailto:`/`tel:` only;
  `javascript:`, `data:`, `vbscript:` and control-character tricks rejected
  client- and server-side.
- Uploads: JPEG/PNG/WebP/AVIF validated by magic signature (not filename),
  ≤ 20 MiB, SVG and executable signatures rejected. Server recomputes the
  content-addressed `/__media/…` path — submitted paths are never trusted.
- Page fetches resolve through manifest membership only; traversal fails closed.
- Publish verifies the base file digest before patching; overlapping patches,
  unknown node ids and malformed segment refs are rejected.

## Threat model

Protected against: session forgery, CSRF, unsafe link schemes, path traversal,
stale writes, malformed patches, malicious/oversized uploads, accidental
structure mutation during editing.

Out of scope: same-origin XSS in the customer's own site — if hostile
JavaScript executes with the editor's origin, it may compromise editing
authority. The sandboxed preview substantially reduces this exposure while
editing.

## Known limitations

Drafts are memory-only by design; closing the tab discards them (an unload
warning is shown). Media uploads accumulate under `/__media/`; v1 has no
deletion.
