export class RequestBodyTooLargeError extends Error {
  constructor(readonly limit: number) {
    super(`request body exceeds ${limit} bytes`);
    this.name = "RequestBodyTooLargeError";
  }
}

function assertDeclaredLengthWithinLimit(request: Request, limit: number): void {
  const header = request.headers.get("content-length");
  if (header === null) return;
  const length = Number(header);
  if (!Number.isSafeInteger(length) || length < 0 || length > limit) {
    throw new RequestBodyTooLargeError(limit);
  }
}

/** Buffer a request body only after enforcing the limit against its streamed bytes. */
export async function bufferRequestBody(request: Request, limit: number): Promise<Request> {
  assertDeclaredLengthWithinLimit(request, limit);
  if (!request.body) return request;

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) {
        try {
          await reader.cancel();
        } catch {
          // Cancellation is best effort; the size rejection remains authoritative.
        }
        throw new RequestBodyTooLargeError(limit);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new Request(request.url, {
    method: request.method,
    headers: request.headers,
    body,
  });
}
