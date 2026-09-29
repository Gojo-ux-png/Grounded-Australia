import Community from "../community";
import { pageData } from "@/db/page-data";
export const dynamic = "force-dynamic";
export const metadata = { title: "Points & rewards" };
export default async function RewardsPage() {
  return <Community view="rewards" initialData={await pageData("rewards")}/>;
}
