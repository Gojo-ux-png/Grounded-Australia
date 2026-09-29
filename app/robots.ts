import { env } from "cloudflare:workers";
import { siteUrl } from "./lib/runtime";
export default function robots() {
  return {rules:env.APP_ENV==="production"&&env.REGISTRATION_OPEN==="true"?[{userAgent:"*",allow:"/",disallow:["/api/","/auth","/me","/moderation","/ask","/search"]}]:[{userAgent:"*",disallow:"/"}],sitemap:`${siteUrl()}/sitemap.xml`};
}
