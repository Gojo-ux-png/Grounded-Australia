import { env } from "cloudflare:workers";
import { currentUserId, database } from "@/db/community";
import { failure } from "@/app/lib/runtime";
import { getMedia, uploadsEnabled } from "@/app/lib/media-storage";

export async function GET(request: Request, context: { params: Promise<{ key: string[] }> }) {
  try {
    if(!uploadsEnabled(env))return new Response("Not found",{status:404,headers:{"Cache-Control":"no-store"}});
    const path=(await context.params).key.join("/");
    if(!/^[a-zA-Z0-9-]+\/[a-zA-Z0-9-]+\.(png|jpg|webp)$/.test(path))return new Response("Not found",{status:404});
    const url=`/api/media/${path}`,db=database();
    const visible=await db.prepare(`SELECT 1 WHERE
      EXISTS (SELECT 1 FROM users WHERE avatar_url=?) OR
      EXISTS (SELECT 1 FROM questions WHERE image_url=? AND hidden=0) OR
      EXISTS (SELECT 1 FROM answers a JOIN questions q ON q.id=a.question_id WHERE a.image_url=? AND a.hidden=0 AND a.deleted=0 AND q.hidden=0)`)
      .bind(url,url,url).first();
    if(!visible) {
      const actor=await currentUserId(request);
      if(!actor || !await db.prepare("SELECT 1 FROM uploads WHERE key=? AND user_id=? AND created_at>datetime('now','-1 day')").bind(path,actor).first())return new Response("Not found",{status:404,headers:{"Cache-Control":"no-store"}});
    }
    return await getMedia(env,path);
  } catch(cause) { return failure(cause,"photo_read"); }
}
