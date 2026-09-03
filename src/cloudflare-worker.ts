import { onRequest as handleApiRequest } from "../functions/__xyle/api/[[route]].ts";
import type { Env as AuthEnv } from "../functions/_auth.ts";
import { onRequestGet as handleEditRequest } from "../functions/edit.ts";
import type { CloudflareImagesBinding } from "../functions/_publish.ts";

interface CloudflareWorkerEnv extends AuthEnv {
  ASSETS: { fetch(request: Request): Promise<Response> };
  CLOUDFLARE_ACCOUNT_ID?: string;
  CLOUDFLARE_API_TOKEN?: string;
  CLOUDFLARE_PROJECT?: string;
  IMAGES?: CloudflareImagesBinding;
}

export default {
  async fetch(request: Request, env: CloudflareWorkerEnv): Promise<Response> {
    try {
      const url = new URL(request.url);
      if (url.pathname === "/edit" || url.pathname === "/edit/") {
        if (request.method !== "GET" && request.method !== "HEAD") {
          return new Response("Method not allowed", { status: 405 });
        }
        return handleEditRequest({ request, env });
      }
      if (url.pathname.startsWith("/__xyle/api/")) {
        const route = url.pathname.slice("/__xyle/api/".length).split("/").filter(Boolean);
        return handleApiRequest({ request, env, params: { route } });
      }
      if (url.pathname.startsWith("/_xyle/")) {
        return new Response("Not found", { status: 404 });
      }
      return env.ASSETS.fetch(request);
    } catch {
      return new Response("Internal error", { status: 500 });
    }
  },
};
