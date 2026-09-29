import { env } from "cloudflare:workers";

export const registrationOpen = () => env.REGISTRATION_OPEN === "true";
export const isLocal = () => env.APP_ENV === "local";
export function siteUrl() {
  const url = new URL(env.SITE_URL);
  if (!isLocal() && (url.protocol !== "https:" || url.hostname === "example.com" || url.hostname.endsWith(".example.com"))) throw new Error("SITE_URL is not configured.");
  return url.origin;
}
export class RequestError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
export async function limit(binding: RateLimit, key: string) {
  if (!(await binding.limit({ key })).success) throw new RequestError("Too many attempts. Please wait a minute and try again.", 429);
}
export async function verifyChallenge(request: Request, token: unknown, action: string) {
  if (isLocal()) return;
  if (!env.TURNSTILE_SECRET_KEY) throw new RequestError("Account access is temporarily unavailable.", 503);
  if (typeof token !== "string" || !token || token.length > 2048) throw new RequestError("Complete the security check and try again.");
  const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ secret: env.TURNSTILE_SECRET_KEY, response: token, remoteip: request.headers.get("cf-connecting-ip") || undefined }),
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new RequestError("Security check is temporarily unavailable.", 503);
  const result = await response.json() as { success?: boolean; hostname?: string; action?: string };
  if (!result.success || result.hostname !== new URL(siteUrl()).hostname || result.action !== action) throw new RequestError("Security check expired. Please try again.");
}
export function failure(cause: unknown, operation: string) {
  const known = cause instanceof RequestError;
  const status = known ? cause.status : cause instanceof SyntaxError ? 400 : 503;
  if (!known && status !== 400) console.error(JSON.stringify({ event: "request_failed", operation, requestId: crypto.randomUUID(), error: cause instanceof Error ? cause.name : "UnknownError" }));
  return Response.json({ error: known ? cause.message : status === 400 ? "Invalid request." : "The service is temporarily unavailable. Please try again." }, {
    status, headers: { "Cache-Control": "private, no-store", ...(status === 429 ? { "Retry-After": "60" } : {}) },
  });
}
