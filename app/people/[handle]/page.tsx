import Community from "../../community";

export default async function Profile({ params }: { params: Promise<{ handle: string }> }) {
  return <Community view="profile" handle={(await params).handle} />;
}
