import { authenticated, type Env } from "./_auth";

const loginPage = `<!doctype html><title>Xyle — Sign in</title><form id="login"><label>Editor key <input id="key" type="password" autofocus></label><p id="error"></p><button>Sign in</button></form><script>login.onsubmit=async(e)=>{e.preventDefault();const r=await fetch('/__xyle/api/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({key:key.value})});if(r.ok)location.reload();else error.textContent='That key was not accepted.'}</script>`;
const editorPage = `<!doctype html><title>Xyle Editor</title><div id="xyle-root"></div><script type="module" src="/__xyle/editor.js?v=20260824"></script>`;

export const onRequestGet = async ({ request, env }: { request: Request; env: Env }): Promise<Response> => new Response(await authenticated(request, env) ? editorPage : loginPage, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
