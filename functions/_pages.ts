import { blake3 } from "@noble/hashes/blake3.js";

export interface PagesEnv {
  CLOUDFLARE_ACCOUNT_ID?: string;
  CLOUDFLARE_API_TOKEN?: string;
  XYLE_WORKER_BUNDLE_B64?: string;
}

export function pagesAssetHash(bytes: Uint8Array, path: string): string {
  const extension = path.slice(path.lastIndexOf(".") + 1);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const digest = blake3(new TextEncoder().encode(btoa(binary) + extension));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("").slice(0, 32);
}

export async function pagesRequest(env: PagesEnv, path: string, init: RequestInit = {}): Promise<Response> {
  if (!env.CLOUDFLARE_ACCOUNT_ID || !env.CLOUDFLARE_API_TOKEN) throw new Error("Cloudflare Pages credentials are not configured");
  return fetch(`https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}`, ...init.headers },
  });
}
