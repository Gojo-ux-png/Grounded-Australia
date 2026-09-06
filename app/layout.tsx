import type { Metadata } from "next";
import { Geist } from "next/font/google";
import { headers } from "next/headers";
import "./globals.css";

const geist = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const image = `${protocol}://${host}/og.png`;
  return {
    title: { default: "Grounded Australia — Practical knowledge, rooted in place", template: "%s · Grounded Australia" },
    description: "Practical answers from Australian farmers, growers and verified agricultural experts.",
    openGraph: { title: "Grounded Australia", description: "Practical knowledge, rooted in place.", images: [{ url: image, width: 1536, height: 1024 }] },
    twitter: { card: "summary_large_image", title: "Grounded Australia", description: "Practical knowledge, rooted in place.", images: [image] },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en-AU"><body className={geist.variable}>{children}</body></html>;
}
