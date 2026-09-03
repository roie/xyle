export class BodyTooLargeError extends Error {
  constructor(readonly limit: number) {
    super(`body exceeds ${limit} bytes`);
    this.name = "BodyTooLargeError";
  }
}

export class RequestBodyTooLargeError extends BodyTooLargeError {
  constructor(limit: number) {
    super(limit);
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

export async function readBodyBytes(
  stream: ReadableStream<Uint8Array> | null,
  limit: number,
): Promise<Uint8Array> {
  if (!stream) return new Uint8Array();
  const reader = stream.getReader();
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
        throw new BodyTooLargeError(limit);
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
  return body;
}

/** Buffer a request body only after enforcing the limit against its streamed bytes. */
export async function bufferRequestBody(request: Request, limit: number): Promise<Request> {
  assertDeclaredLengthWithinLimit(request, limit);
  let body: Uint8Array;
  try {
    body = await readBodyBytes(request.body, limit);
  } catch (error) {
    if (error instanceof BodyTooLargeError) throw new RequestBodyTooLargeError(limit);
    throw error;
  }
  if (!request.body) return request;
  return new Request(request.url, {
    method: request.method,
    headers: request.headers,
    body: Uint8Array.from(body).buffer,
  });
}
