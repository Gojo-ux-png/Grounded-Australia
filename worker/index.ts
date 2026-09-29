import { maintain } from "./maintenance";
import handler from "vinext/server/app-router-entry";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    try {
      const local = env.APP_ENV === "local";
      const origin = new URL(env.SITE_URL);
      if (local && !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) return new Response("Deployment is not configured.", { status: 503 });
      if (!local) {
        if (origin.protocol !== "https:" || origin.hostname === "example.com" || origin.hostname.endsWith(".example.com") || (env.TURNSTILE_SITE_KEY && !env.TURNSTILE_SECRET_KEY)) return new Response("Deployment is not configured.", { status: 503 });
        if (url.origin !== origin.origin) {
          if (["GET", "HEAD"].includes(request.method)) { const target=new URL(origin);target.pathname=url.pathname;target.search=url.search;return Response.redirect(target,308); }
          return new Response("Use the configured site address.", { status: 421 });
        }
      }
      if (!url.pathname.startsWith("/assets/") && !(await env.READ_LIMITER.limit({ key: request.headers.get("cf-connecting-ip") || "local" })).success) {
        return Response.json({ error: "Too many requests. Please try again shortly." }, { status: 429, headers: { "Retry-After": "60", "Cache-Control": "no-store" } });
      }
      const response = await handler.fetch(request, env, ctx);
      const secured = new Response(response.body, response);
      secured.headers.set("X-Content-Type-Options", "nosniff");
      secured.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
      secured.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
      secured.headers.set("X-Frame-Options", "DENY");
      if (!local) {
        secured.headers.set("Strict-Transport-Security", "max-age=31536000");
        if (env.APP_ENV !== "production" || env.REGISTRATION_OPEN !== "true") secured.headers.set("X-Robots-Tag", "noindex, nofollow");
      }
      if ((secured.headers.get("content-type") || "").includes("text/html") || (url.pathname.startsWith("/api/") && !url.pathname.startsWith("/api/media/"))) secured.headers.set("Cache-Control", "private, no-store");
      return secured;
    } catch {
      console.error(JSON.stringify({ event: "worker_request_failed", requestId: crypto.randomUUID(), path: url.pathname }));
      return Response.json({ error: "The service is temporarily unavailable." }, { status: 503, headers: { "Cache-Control": "no-store" } });
    }
  },
  async scheduled(_controller,env,ctx) { ctx.waitUntil(maintain(env)); },
} satisfies ExportedHandler<CloudflareEnv>;
