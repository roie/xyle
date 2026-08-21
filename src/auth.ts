import { createHmac, timingSafeEqual } from "node:crypto";
import { digestBytes } from "./manifest.ts";
import type { XyleDigest } from "./types.ts";

export const SESSION_COOKIE_NAME = "xyle_session";
/** 8-hour maximum lifetime. */
export const SESSION_MAX_AGE_SECONDS = 8 * 60 * 60;

export interface AuthConfig {
  editorKeyDigest: XyleDigest;
  sessionSecret: Uint8Array;
  sessionMaxAgeSeconds?: number;
}

function constantTimeHexEquals(a: string, b: string): boolean {
  const ab = new TextEncoder().encode(a);
  const bb = new TextEncoder().encode(b);
  if (ab.length !== bb.length) {
    // still burn comparable time
    timingSafeEqual(ab, ab);
    return false;
  }
  return timingSafeEqual(ab, bb);
}

export async function hashEditorKey(key: string): Promise<XyleDigest> {
  return digestBytes(new TextEncoder().encode(key.normalize("NFKC")));
}

export async function verifyEditorKey(
  submitted: string,
  expectedDigest: XyleDigest,
): Promise<boolean> {
  if (typeof submitted !== "string" || submitted.length === 0 || submitted.length > 512) {
    return false;
  }
  const actual = await hashEditorKey(submitted);
  return constantTimeHexEquals(actual, expectedDigest);
}

function sign(secret: Uint8Array, payload: string): string {
  const mac = createHmac("sha256", secret).update(payload).digest();
  return Buffer.from(mac).toString("base64url");
}

interface SessionPayload {
  exp: number;
  nonce: string;
}

export async function createSessionToken(
  secret: Uint8Array,
  now: number,
  maxAgeSeconds: number = SESSION_MAX_AGE_SECONDS,
): Promise<string> {
  const payload: SessionPayload = {
    exp: Math.floor(now / 1000) + maxAgeSeconds,
    nonce: crypto.randomUUID(),
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${encoded}.${sign(secret, encoded)}`;
}

export async function verifySessionToken(
  token: string | null | undefined,
  secret: Uint8Array,
  now: number,
): Promise<boolean> {
  if (!token) return false;
  const dot = token.indexOf(".");
  if (dot === -1) return false;
  const encoded = token.slice(0, dot);
  const mac = token.slice(dot + 1);
  const expected = sign(secret, encoded);
  const equal = constantTimeHexEquals(mac, expected);
  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString()) as SessionPayload;
    return equal && typeof payload.exp === "number" && payload.exp > Math.floor(now / 1000);
  } catch {
    return false;
  }
}

export async function createSessionCookie(
  secret: Uint8Array,
  now: number,
  maxAgeSeconds: number = SESSION_MAX_AGE_SECONDS,
): Promise<string> {
  const token = await createSessionToken(secret, now, maxAgeSeconds);
  return [
    `${SESSION_COOKIE_NAME}=${token}`,
    "HttpOnly",
    "SameSite=Strict",
    "Path=/",
    `Max-Age=${maxAgeSeconds}`,
  ].join("; ");
}

export function logoutCookie(): string {
  return `${SESSION_COOKIE_NAME}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`;
}

export function readSessionCookie(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(/;\s*/)) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq) === SESSION_COOKIE_NAME) {
      return part.slice(eq + 1) || null;
    }
  }
  return null;
}

export async function verifySessionCookie(
  cookieHeader: string | null,
  secret: Uint8Array,
  now: number,
): Promise<boolean> {
  return verifySessionToken(readSessionCookie(cookieHeader), secret, now);
}

export function generateEditorKey(): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");
}

export function generateSessionSecret(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(32));
}
