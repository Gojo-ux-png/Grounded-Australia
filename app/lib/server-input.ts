import { RequestError } from "./runtime";

export async function readLimited(request: Request, max: number) {
  if (Number(request.headers.get("content-length")) > max) throw new RequestError("Request is too large.", 413);
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const {done,value} = await reader.read(); if(done) break;
      size += value.byteLength; if(size > max) { await reader.cancel(); throw new RequestError("Request is too large.", 413); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset=0;
  for(const chunk of chunks) { bytes.set(chunk,offset); offset+=chunk.length; }
  return bytes;
}
export function sameOrigin(request: Request) {
  const origin=request.headers.get("origin");
  return request.headers.get("sec-fetch-site") !== "cross-site" && (!origin || origin===new URL(request.url).origin);
}
