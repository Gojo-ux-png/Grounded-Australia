import Community from "../../community";

export default async function Question({ params }: { params: Promise<{ slug: string }> }) {
  return <Community view="question" slug={(await params).slug} />;
}
