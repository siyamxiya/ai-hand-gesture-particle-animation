import type { Metadata } from "next";
import "./globals.css";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: "我爱中国｜大工粒子光场",
  description: "以手势唤醒粒子，在光影中汇聚 I Love China、我爱中国、大工与 2026。",
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
  openGraph: {
    title: "我爱中国｜大工粒子光场",
    description: "双指唤醒，指尖汇聚 I Love China、我爱中国、大工与 2026。",
    images: [{ url: "/og.png", width: 1600, height: 900, alt: "我爱中国与大工粒子光场" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "我爱中国｜大工粒子光场",
    description: "双指唤醒，指尖汇聚 I Love China、我爱中国、大工与 2026。",
    images: ["/og.png"],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
