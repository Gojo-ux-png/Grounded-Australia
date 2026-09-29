import { env } from "cloudflare:workers";
import { currentUserId, database } from "@/db/community";
import { readLimited, sameOrigin } from "@/app/lib/server-input";
import { requireVerified } from "@/db/account-security";
import { failure, limit, RequestError } from "@/app/lib/runtime";
import { putMedia, uploadsEnabled } from "@/app/lib/media-storage";
const MAX_IMAGE_BYTES=5*1024*1024;
export async function POST(request: Request) {
  if(!sameOrigin(request)) return Response.json({error:"Upload from Grounded."},{status:403});
  try {
    if(!uploadsEnabled(env)) throw new RequestError("Photo uploads are not enabled yet. You can still publish your text.",503);
  const actor=await currentUserId(request);
  if(!actor) return Response.json({error:"Sign in to upload an image."},{status:401});
    await requireVerified(actor);
    await limit(env.UPLOAD_LIMITER,`upload:${actor}`);
    const bytes=await readLimited(request,MAX_IMAGE_BYTES+65536);
    const form=await new Response(bytes,{headers:{"content-type":request.headers.get("content-type") || ""}}).formData();
    const file=form.get("image");
    if(!(file instanceof File) || !file.size || file.size>MAX_IMAGE_BYTES) throw new RequestError("Choose a JPEG, PNG or WebP photo smaller than 5 MB.");
    const data=new Uint8Array(await file.arrayBuffer());
    const ascii=(a:number,b:number)=>String.fromCharCode(...data.slice(a,b));
    let mime="",extension="";
    if(data.length>32 && [137,80,78,71,13,10,26,10].every((n,i)=>data[i]===n) && ascii(12,16)==="IHDR") { mime="image/png"; extension="png"; }
    else if(data.length>12 && data[0]===255 && data[1]===216 && data[2]===255 && data.at(-2)===255 && data.at(-1)===217) { mime="image/jpeg"; extension="jpg"; }
    else if(data.length>20 && ascii(0,4)==="RIFF" && ascii(8,12)==="WEBP" && ["VP8 ","VP8L","VP8X"].includes(ascii(12,16))) { mime="image/webp"; extension="webp"; }
    if(!mime || file.type!==mime) throw new RequestError("The photo format could not be verified. Use JPEG, PNG or WebP; SVG is not accepted.");
    const key=`${actor}/${crypto.randomUUID()}.${extension}`;
    const db=database();
    const reserved=await db.prepare("INSERT INTO uploads (key,user_id) SELECT ?,? WHERE (SELECT COUNT(*) FROM uploads WHERE user_id=? AND created_at>=datetime('now','-1 day'))<100").bind(key,actor,actor).run();
    if(!reserved.meta.changes)throw new RequestError("Your daily photo limit has been reached. Please try again tomorrow.",429);
    try { await putMedia(env,key,data,mime); }
    catch(cause) { await db.prepare("DELETE FROM uploads WHERE key=?").bind(key).run();throw cause; }
    return Response.json({url:`/api/media/${key}`},{status:201});
  } catch(cause) { return failure(cause,"photo_upload"); }
}
