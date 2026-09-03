import { describe, expect, it } from "vitest";
import {
  BodyTooLargeError,
  bufferRequestBody,
  readBodyBytes,
  RequestBodyTooLargeError,
} from "../src/request-body.ts";

function postRequest(body: Uint8Array, contentLength?: string): Request {
  const headers = new Headers({ "content-type": "application/octet-stream" });
  if (contentLength !== undefined) headers.set("content-length", contentLength);
  return new Request("https://site.example/upload", {
    method: "POST",
    headers,
    body: Uint8Array.from(body).buffer,
  });
}

describe("bounded request buffering", () => {
  it("buffers streamed bytes when no Content-Length is supplied", async () => {
    const buffered = await bufferRequestBody(postRequest(new Uint8Array([1, 2, 3])), 3);

    expect(new Uint8Array(await buffered.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
  });

  it("rejects actual bytes beyond the limit when Content-Length is absent", async () => {
    await expect(
      bufferRequestBody(postRequest(new Uint8Array([1, 2, 3, 4])), 3),
    ).rejects.toBeInstanceOf(RequestBodyTooLargeError);
  });

  it("rejects a body that exceeds a smaller declared Content-Length", async () => {
    await expect(
      bufferRequestBody(postRequest(new Uint8Array([1, 2, 3, 4]), "1"), 3),
    ).rejects.toBeInstanceOf(RequestBodyTooLargeError);
  });

  it("caps response-style streams without relying on headers", async () => {
    const response = new Response(new Uint8Array([1, 2, 3, 4]));

    await expect(readBodyBytes(response.body, 3)).rejects.toBeInstanceOf(BodyTooLargeError);
  });

  it("rejects invalid and oversized declared lengths", async () => {
    for (const contentLength of ["invalid", "-1", "4"]) {
      await expect(
        bufferRequestBody(postRequest(new Uint8Array([1]), contentLength), 3),
      ).rejects.toBeInstanceOf(RequestBodyTooLargeError);
    }
  });
});
