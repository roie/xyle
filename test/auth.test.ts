import { describe, expect, it } from "vitest";
import {
  createSessionCookie,
  generateEditorKey,
  hashEditorKey,
  logoutCookie,
  readSessionCookie,
  verifyEditorKey,
  verifySessionCookie,
} from "../src/auth.ts";
import type { XyleDigest } from "../src/types.ts";

const secret = crypto.getRandomValues(new Uint8Array(32));
const NOW = Date.now();

describe("editor key", () => {
  it("generates a 256-bit-equivalent random key", () => {
    const key = generateEditorKey();
    // base64url of 32 bytes
    expect(key).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("verifies by SHA-256 digest comparison", async () => {
    const key = generateEditorKey();
    const digest = await hashEditorKey(key);
    expect(digest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(await verifyEditorKey(key, digest)).toBe(true);
    expect(await verifyEditorKey(`${key}x`, digest)).toBe(false);
    expect(await verifyEditorKey("", digest)).toBe(false);
  });
});

describe("session cookie", () => {
  it("round-trips a signed cookie", async () => {
    const cookie = await createSessionCookie(secret, NOW);
    const header = cookie.split(";")[0]!;
    const value = header.slice(header.indexOf("=") + 1);
    expect(await verifySessionCookie(`xyle_session=${value}`, secret, NOW)).toBe(true);
  });

  it("rejects tampered cookies", async () => {
    const cookie = await createSessionCookie(secret, NOW);
    let value = cookie.split(";")[0]!.split("=")[1]!;
    const parts = value.split(".");
    const payload = Buffer.from(parts[0]!, "base64url").toString();
    const forged = Buffer.from(payload.replace("exp", "exq")).toString("base64url");
    value = `${forged}.${parts[1]}`;
    expect(await verifySessionCookie(`xyle_session=${value}`, secret, NOW)).toBe(false);

    value = cookie.split(";")[0]!.split("=")[1]!;
    const [enc2, sig2] = value.split(".");
    const badSig = sig2!.slice(0, -2) + (sig2!.endsWith("AA") ? "BB" : "AA");
    expect(await verifySessionCookie(`xyle_session=${enc2}.${badSig}`, secret, NOW)).toBe(false);
  });

  it("rejects expired cookies", async () => {
    const cookie = await createSessionCookie(secret, NOW, 60);
    const value = cookie.split(";")[0]!.split("=")[1]!;
    expect(await verifySessionCookie(value, secret, NOW + 61_000)).toBe(false);
  });

  it("rejects cookies signed with a different secret", async () => {
    const otherSecret = crypto.getRandomValues(new Uint8Array(32));
    const cookie = await createSessionCookie(otherSecret, NOW);
    const value = cookie.split(";")[0]!.split("=")[1]!;
    expect(await verifySessionCookie(value, secret, NOW)).toBe(false);
  });

  it("logout clears the cookie", () => {
    expect(logoutCookie()).toContain("Max-Age=0");
  });

  it("reads the session value from a cookie header", async () => {
    const cookie = await createSessionCookie(secret, NOW, 3600);
    const token = cookie.split(";")[0]!.split("=")[1]!;
    const header = `other=1; ${cookie.split(";")[0]}; more=2`;
    expect(readSessionCookie(header)).toBe(token);
    expect(readSessionCookie(null)).toBeNull();
  });
});

describe("digest typing", () => {
  it("keeps digests in the sha256 namespace", async () => {
    const digest: XyleDigest = await hashEditorKey("k");
    expect(digest.startsWith("sha256:")).toBe(true);
  });
});
