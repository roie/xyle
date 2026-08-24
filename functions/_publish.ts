import { pagesAssetHash, pagesRequest, type PagesEnv } from "./_pages";

export interface PublishFile { path: string; bytes: Uint8Array; contentType: string; }

export async function deployCompleteSnapshot(env: PagesEnv & { CLOUDFLARE_PROJECT?: string }, files: PublishFile[], baseUrl: string): Promise<string> {
  const projectName = env.CLOUDFLARE_PROJECT ?? "xyle";
  const assets = await Promise.all(files.map(async (file) => ({ ...file, hash: await pagesAssetHash(file.bytes, file.path, baseUrl) })));
  const tokenResponse = await pagesRequest(env, `/pages/projects/${projectName}/upload-token`);
  if (!tokenResponse.ok) throw new Error(`Cloudflare upload token failed (${tokenResponse.status})`);
  const tokenBody = await tokenResponse.json() as { result?: { jwt?: string }; jwt?: string };
  const jwt = tokenBody.result?.jwt ?? tokenBody.jwt;
  if (!jwt) throw new Error("Cloudflare upload token missing JWT");
  const assetHeaders = { authorization: `Bearer ${jwt}`, "content-type": "application/json" };
  const missingResponse = await fetch("https://api.cloudflare.com/client/v4/pages/assets/check-missing", { method: "POST", headers: assetHeaders, body: JSON.stringify({ hashes: assets.map((asset) => asset.hash) }) });
  const missingBody = await missingResponse.json() as { result?: string[] };
  const missing = new Set(missingBody.result ?? []);
  const uploads = assets.filter((asset) => missing.has(asset.hash)).map((asset) => ({ key: asset.hash, value: bytesToBase64(asset.bytes), base64: true, metadata: { contentType: asset.contentType } }));
  if (uploads.length) {
    const uploadResponse = await fetch("https://api.cloudflare.com/client/v4/pages/assets/upload", { method: "POST", headers: assetHeaders, body: JSON.stringify(uploads) });
    if (!uploadResponse.ok) throw new Error(`Cloudflare asset upload failed (${uploadResponse.status})`);
  }
  const upsertResponse = await fetch("https://api.cloudflare.com/client/v4/pages/assets/upsert-hashes", { method: "POST", headers: assetHeaders, body: JSON.stringify({ hashes: assets.map((asset) => asset.hash) }) });
  if (!upsertResponse.ok) throw new Error(`Cloudflare asset hash registration failed (${upsertResponse.status})`);
  const form = new FormData();
  form.set("manifest", JSON.stringify(Object.fromEntries(assets.map((asset) => [asset.path, asset.hash]))));
  const deployment = await pagesRequest(env, `/pages/projects/${projectName}/deployments`, { method: "POST", body: form });
  if (!deployment.ok) throw new Error(`Cloudflare deployment failed (${deployment.status})`);
  const body = await deployment.json() as { result?: { id?: string; url?: string } };
  return body.result?.url ?? body.result?.id ?? "deployment-created";
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
