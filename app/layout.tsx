import type { Metadata } from "next";
import { Geist } from "next/font/google";
import "./globals.css";
import { siteUrl } from "./lib/runtime";

const geist = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });

export async function generateMetadata(): Promise<Metadata> {
  const origin = siteUrl();
  const image = `${origin}/og.png`;
  return {
    metadataBase: new URL(origin),
    title: { default: "Grounded Australia — Practical knowledge, rooted in place", template: "%s · Grounded Australia" },
    description: "Practical answers from Australian farmers, growers and verified agricultural experts.",
    openGraph: { title: "Grounded Australia", description: "Practical knowledge, rooted in place.", images: [{ url: image, width: 1536, height: 1024 }] },
    twitter: { card: "summary_large_image", title: "Grounded Australia", description: "Practical knowledge, rooted in place.", images: [image] },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en-AU"><body className={geist.variable}>{children}</body></html>;
}
