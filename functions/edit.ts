import { authenticated, type Env } from "./_auth";

const loginPage = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Xyle — Sign in</title><style>
:root{color-scheme:dark;font-family:ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#101110;color:#f2f3ef}
*{box-sizing:border-box}
body{display:grid;place-items:center;min-height:100svh;margin:0;padding:1rem;background:#101110}
main{width:min(100%,26rem)}
.xyle-mark{display:inline-flex;align-items:center;gap:.65rem;margin-bottom:1.5rem;color:#f2f3ef;font-size:.83rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase}
.xyle-mark svg{width:1.75rem;height:1.75rem;padding:.35rem;border:1px solid #667a6166;border-radius:6px;background:#667a6126;color:#a1b69a;stroke:currentColor;stroke-width:1.8;fill:none}
form{display:grid;gap:1.15rem;padding:clamp(1.25rem,7vw,2rem);border:1px solid #3a3c38;border-radius:12px;background:#1c1d1b;box-shadow:0 18px 48px #00000066}
h1{margin:0;color:#f2f3ef;font-size:clamp(1.65rem,8vw,2.15rem);line-height:1.05;letter-spacing:-.045em}
.description{margin:-.45rem 0 .2rem;color:#a5a8a0;font-size:.95rem;line-height:1.55}
.field{display:grid;gap:.5rem}
label{color:#d9ded7;font-size:.82rem;font-weight:600}
input{width:100%;min-height:2.9rem;padding:.65rem .8rem;border:1px solid #3a3c38;border-radius:6px;outline:0;background:#141513;color:#f2f3ef;font:inherit}
input:hover{border-color:#5b6058}
input:focus-visible{border-color:#a1b69a;box-shadow:0 0 0 3px #667a6140}
input[aria-invalid="true"]{border-color:#d26d6d;box-shadow:0 0 0 3px #d26d6d26}
.error{min-height:1.2em;margin:0;color:#e38a8a;font-size:.8rem;line-height:1.45}
button{min-height:2.9rem;padding:.7rem 1rem;border:1px solid #667a61;border-radius:6px;background:#667a61;color:#fff;font:600 .9rem/1 inherit;cursor:pointer;transition:background-color .15s ease,transform .15s ease}
button:hover{background:#7f9378}
button:active{transform:translateY(1px)}
button:focus-visible{outline:3px solid #667a6166;outline-offset:3px}
button:disabled{cursor:wait;opacity:.7}
.help{margin:.25rem 0 0;color:#777b73;font-size:.75rem;line-height:1.5;text-align:center}
@media(max-width:22rem){body{padding:.75rem}form{border-radius:10px}.xyle-mark{margin-left:.25rem;margin-bottom:1rem}}
@media(prefers-reduced-motion:reduce){button{transition:none}}
</style></head><body><main>
<div class="xyle-mark" aria-label="Xyle"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 5l12 14M18 5L6 19"/></svg><span>Xyle</span></div>
<form id="login" novalidate>
<h1>Open your site editor</h1>
<p id="login-description" class="description">Enter the editor key for this site to make and publish content changes.</p>
<div class="field"><label for="key">Editor key</label><input id="key" name="key" type="password" autocomplete="current-password" required aria-describedby="login-description login-error" aria-invalid="false"></div>
<p id="login-error" class="error" aria-live="polite"></p>
<button type="submit"><span id="submit-label">Sign in to Xyle</span></button>
</form>
<p class="help">The editor key is stored with your Xyle site setup.</p>
</main><script type="module">
const form = document.getElementById("login");
const input = document.getElementById("key");
const error = document.getElementById("login-error");
const button = form.querySelector("button");
const submitLabel = document.getElementById("submit-label");
form.addEventListener("submit", async (event) => {
  event.preventDefault();
  error.textContent = "";
  input.setAttribute("aria-invalid", "false");
  if (!input.value) {
    input.setAttribute("aria-invalid", "true");
    error.textContent = "Enter your editor key.";
    input.focus();
    return;
  }
  button.disabled = true;
  submitLabel.textContent = "Signing in…";
  try {
    const res = await fetch("/__xyle/api/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ key: input.value }),
    });
    if (res.ok) {
      location.reload();
      return;
    }
    input.setAttribute("aria-invalid", "true");
    error.textContent = res.status === 401 ? "That editor key was not accepted." : "Xyle could not sign you in. Try again.";
    input.focus();
    input.select();
  } catch {
    input.setAttribute("aria-invalid", "true");
    error.textContent = "Xyle could not be reached. Check your connection and try again.";
    input.focus();
  } finally {
    button.disabled = false;
    submitLabel.textContent = "Sign in to Xyle";
  }
});
input.addEventListener("input", () => {
  if (input.getAttribute("aria-invalid") === "true") {
    input.setAttribute("aria-invalid", "false");
    error.textContent = "";
  }
});
</script></body></html>`;

const editorPage = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Xyle Editor</title><style>html,body{margin:0;height:100%}</style></head><body><div id="xyle-root"></div><script type="module" src="/editor.js?v=20260825"></script></body></html>`;

export const onRequestGet = async ({
  request,
  env,
}: {
  request: Request;
  env: Env;
}): Promise<Response> =>
  new Response((await authenticated(request, env)) ? editorPage : loginPage, {
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
