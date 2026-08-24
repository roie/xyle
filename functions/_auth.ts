export interface Env { XYLE_EDITOR_KEY_DIGEST?: string; XYLE_SESSION_SECRET?: string; }

const encoder = new TextEncoder();
const toBase64Url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
const fromBase64Url = (value: string) => Uint8Array.from(atob(value.replaceAll("-", "+").replaceAll("_", "/")), (char) => char.charCodeAt(0));

async function hmac(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return toBase64Url(new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(value))));
}

export async function authenticated(request: Request, env: Env): Promise<boolean> {
  if (!env.XYLE_SESSION_SECRET) return false;
  const token = request.headers.get("cookie")?.match(/(?:^|;\s*)xyle_session=([^;]+)/)?.[1];
  if (!token) return false;
  const [payload, signature] = token.split(".");
  if (!payload || !signature || signature !== await hmac(env.XYLE_SESSION_SECRET, payload)) return false;
  try { return JSON.parse(new TextDecoder().decode(fromBase64Url(payload))).exp > Math.floor(Date.now() / 1000); } catch { return false; }
}

export async function login(key: string, env: Env): Promise<string | null> {
  if (!env.XYLE_EDITOR_KEY_DIGEST || !env.XYLE_SESSION_SECRET) return null;
  const digest = `sha256:${[...new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(key.normalize("NFKC"))))].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
  if (digest !== env.XYLE_EDITOR_KEY_DIGEST) return null;
  const payload = toBase64Url(encoder.encode(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 28800, nonce: crypto.randomUUID() })));
  return `${payload}.${await hmac(env.XYLE_SESSION_SECRET, payload)}`;
}

export const sessionCookie = (token: string) => `xyle_session=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=28800`;
export const logoutCookie = "xyle_session=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0";
