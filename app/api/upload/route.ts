import { env } from "cloudflare:workers";
import { currentUserId } from "@/db/community";

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export async function POST(request: Request) {
  const actor = await currentUserId(request);
  if (!actor) return Response.json({ error: "Sign in to upload an image." }, { status: 401 });
  const form = await request.formData();
  const file = form.get("image");
  if (!(file instanceof File) || !file.type.startsWith("image/") || file.size > MAX_IMAGE_BYTES) {
    return Response.json({ error: "Choose an image smaller than 5 MB." }, { status: 400 });
  }
  const extension = file.type.split("/")[1]?.replace("jpeg", "jpg").replace(/[^a-z0-9]/g, "") || "jpg";
  const key = `${actor}/${crypto.randomUUID()}.${extension}`;
  await env.MEDIA.put(key, file.stream(), { httpMetadata: { contentType: file.type } });
  return Response.json({ url: `/api/media/${key}` }, { status: 201 });
}
