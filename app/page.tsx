import Community from "./community";
import { pageData } from "@/db/page-data";
export const dynamic="force-dynamic";
export default async function Home({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}) {
  const params=Object.fromEntries(Object.entries(await searchParams).filter((entry):entry is [string,string]=>typeof entry[1]==="string"));
  return <Community view="home" initialSearch={new URLSearchParams(params).toString()} initialData={await pageData("home",params)}/>;
}
