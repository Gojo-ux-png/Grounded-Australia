import { database } from "@/db/community";
import { siteUrl } from "./lib/runtime";
export const dynamic="force-dynamic";
export default async function sitemap() {
  const rows=await database().prepare("SELECT q.slug,COALESCE(q.updated_at,q.created_at) modified FROM questions q JOIN users u ON u.id=q.author_id WHERE q.hidden=0 AND u.demo=0 ORDER BY q.id DESC LIMIT 1000").all<{slug:string;modified:string}>();
  return [{url:siteUrl()},...rows.results.map(q=>({url:`${siteUrl()}/questions/${encodeURIComponent(q.slug)}`,lastModified:new Date(q.modified.includes("T")?q.modified:q.modified.replace(" ","T")+"Z")}))];
}
