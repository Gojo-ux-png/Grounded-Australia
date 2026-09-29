import Community from "../../community";
import { pageData } from "@/db/page-data";
import { database } from "@/db/community";
import { notFound } from "next/navigation";
import { siteUrl } from "@/app/lib/runtime";
import type { Metadata } from "next";
export const dynamic="force-dynamic";
export async function generateMetadata({params}:{params:Promise<{slug:string}>}):Promise<Metadata> {
  const {slug}=await params;
  try {
    const question=await database().prepare("SELECT title,body FROM questions WHERE slug=? AND hidden=0").bind(slug).first<{title:string;body:string}>();
    if(question)return {alternates:{canonical:`${siteUrl()}/questions/${encodeURIComponent(slug)}`},title:question.title,description:question.body.slice(0,180),openGraph:{title:question.title,description:question.body.slice(0,180),images:[]},twitter:{title:question.title,description:question.body.slice(0,180),images:[]}};
  } catch {}
  return {title:"Question unavailable",robots:{index:false}};
}
export default async function Question({params}:{params:Promise<{slug:string}>}) {
  const {slug}=await params;
  const data=await pageData("question",{slug});
  if(data && !data.questions.length)notFound();
  return <Community view="question" slug={slug} initialData={data}/>;
}
