type MediaEnv = Pick<CloudflareEnv, "APP_ENV" | "MEDIA" | "SUPABASE_URL" | "SUPABASE_STORAGE_BUCKET" | "SUPABASE_SECRET_KEY">;
const formats = ["image/jpeg", "image/png", "image/webp"];
const maxBytes = 5 * 1024 * 1024;

async function storageJson(response: Response) {
  let size = 0;
  const body = response.body?.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({ transform(chunk, controller) {
    size += chunk.byteLength;
    if (size > 4096) throw new Error("Storage response too large");
    controller.enqueue(chunk);
  } }));
  return new Response(body).json() as Promise<Record<string, unknown>>;
}

export function uploadsEnabled(env: MediaEnv) {
  return Boolean(env.SUPABASE_URL && env.SUPABASE_STORAGE_BUCKET && env.SUPABASE_SECRET_KEY) || Boolean(env.MEDIA);
}

async function storageRequest(env: MediaEnv, path: string, init: RequestInit = {}) {
  const origin = new URL(env.SUPABASE_URL);
  if (origin.protocol !== "https:" || !/^[a-z0-9-]+\.supabase\.co$/.test(origin.hostname) || origin.pathname !== "/" || origin.username || origin.password || origin.search || origin.hash || !env.SUPABASE_SECRET_KEY) throw new Error("Storage configuration unavailable");
  const headers = new Headers(init.headers);
  headers.set("apikey", env.SUPABASE_SECRET_KEY);
  if (!env.SUPABASE_SECRET_KEY.startsWith("sb_secret_")) headers.set("Authorization", `Bearer ${env.SUPABASE_SECRET_KEY}`);
  // Workers requires manual redirects; callers reject non-2xx responses.
  return fetch(new URL(`/storage/v1/${path}`, origin), { ...init, headers, redirect: "manual", signal: AbortSignal.timeout(15000) });
}

function objectPath(env: MediaEnv, key: string) {
  if (!/^[a-z0-9][a-z0-9-]{2,62}$/.test(env.SUPABASE_STORAGE_BUCKET) || !/^[a-zA-Z0-9-]+\/[a-zA-Z0-9-]+\.(png|jpg|webp)$/.test(key)) throw new Error("Invalid media path");
  return `${env.SUPABASE_STORAGE_BUCKET}/${key}`;
}

export async function putMedia(env: MediaEnv, key: string, bytes: Uint8Array<ArrayBuffer>, contentType: string) {
  if (!formats.includes(contentType) || !bytes.length || bytes.length > maxBytes) throw new Error("Invalid image");
  if (env.SUPABASE_URL) {
    const response = await storageRequest(env, `object/${objectPath(env, key)}`, { method: "POST", headers: { "Content-Type": contentType, "x-upsert": "false", "Cache-Control": "no-store" }, body: new Blob([bytes]) });
    await response.body?.cancel();
    if (!response.ok) throw new Error("Image storage unavailable");
    return;
  }
  if (!env.MEDIA) throw new Error("Image storage unavailable");
  await env.MEDIA.put(key, new Blob([bytes]).stream(), { httpMetadata: { contentType } });
}

export async function getMedia(env: MediaEnv, key: string): Promise<Response> {
  let response: Response;
  if (env.SUPABASE_URL) {
    response = await storageRequest(env, `object/authenticated/${objectPath(env, key)}`);
    if (response.status === 404) { await response.body?.cancel(); return new Response("Not found", { status: 404 }); }
    if (response.status === 400) {
      const error = await storageJson(response);
      if (error.code === "NoSuchKey") return new Response("Not found", { status: 404 });
      throw new Error("Image storage unavailable");
    }
    if (!response.ok) { await response.body?.cancel(); throw new Error(`Image storage unavailable (${response.status})`); }
  } else {
    const object = await env.MEDIA?.get(key);
    if (!object) return new Response("Not found", { status: 404 });
    const headers = new Headers(); object.writeHttpMetadata(headers); headers.set("ETag", object.httpEtag);
    response = new Response(object.body, { headers });
  }
  if (!formats.includes(response.headers.get("Content-Type")?.split(";")[0] || "") || Number(response.headers.get("Content-Length")) > maxBytes) {
    await response.body?.cancel(); return new Response("Unsupported image", { status: 415 });
  }
  const headers = new Headers({ "Content-Type": response.headers.get("Content-Type")!, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "sandbox; default-src 'none'" });
  if (response.headers.has("ETag")) headers.set("ETag", response.headers.get("ETag")!);
  return new Response(response.body, { headers });
}

export async function checkMedia(env: MediaEnv) {
  if (env.SUPABASE_URL || env.SUPABASE_STORAGE_BUCKET) {
    objectPath(env, "health/check.png");
    const response = await storageRequest(env, `bucket/${env.SUPABASE_STORAGE_BUCKET}`);
    if (!response.ok) { await response.body?.cancel(); throw new Error(`Image storage unavailable (${response.status})`); }
    const bucket = await storageJson(response);
    if (bucket.id !== env.SUPABASE_STORAGE_BUCKET || bucket.public !== false || typeof bucket.file_size_limit !== "number" || bucket.file_size_limit <= 0 || bucket.file_size_limit > maxBytes || !Array.isArray(bucket.allowed_mime_types) || !bucket.allowed_mime_types.length || bucket.allowed_mime_types.some(type => !formats.includes(type))) throw new Error("Private image storage configuration required");
  } else if (env.MEDIA) await env.MEDIA.head("healthcheck");
}
