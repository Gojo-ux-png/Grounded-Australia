import { env } from "cloudflare:workers";
import { checkMedia } from "@/app/lib/media-storage";
export async function GET() {
  let phase="database";
  try {
    await env.DB.prepare("SELECT email_verified_at FROM accounts LIMIT 1").first();
    await env.DB.prepare("SELECT id FROM account_tokens LIMIT 1").first();
    phase="storage";
    await checkMedia(env);
    return Response.json({status:"ok"},{headers:{"Cache-Control":"no-store"}});
  } catch(cause) {
    const detail=cause instanceof Error && /^(Image storage unavailable|Private image storage configuration required|Storage configuration unavailable|Storage response too large)/.test(cause.message)?cause.message:undefined;
    console.error(JSON.stringify({event:"healthcheck_failed",phase,error:cause instanceof Error?cause.name:"UnknownError",detail}));
    return Response.json({status:"unavailable"},{status:503,headers:{"Cache-Control":"no-store"}});
  }
}
