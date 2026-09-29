import { headers } from "next/headers";
import { snapshot } from "./community";
import type { Snapshot } from "@/app/lib/community-model";
export async function pageData(view:string, extra:Record<string,string>={}) {
  const query=new URLSearchParams({view,...extra});
  try { return await snapshot(new Request(`http://localhost/api/community?${query}`,{headers:await headers()})) as unknown as Snapshot; }
  catch(cause) { console.error("Public page data unavailable",cause); return null; }
}
