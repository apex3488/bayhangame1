import type { Metadata, Viewport } from "next";
import { Manrope, Unbounded } from "next/font/google";
import "./globals.css";

const manrope = Manrope({ subsets: ["latin", "cyrillic"], variable: "--font-manrope", display: "swap" });
const unbounded = Unbounded({ subsets: ["latin", "cyrillic"], variable: "--font-unbounded", display: "swap" });

const SITE = "https://bayhangame1.vercel.app";
const DESCRIPTION =
  "BAYHAN GAME — экономическая онлайн-игра: работай, открывай бизнес, покупай машины и острова, играй в Crash и Мины, соревнуйся в рейтинге. Только игровая валюта.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE),
  title: { default: "BAYHAN GAME — экономическая онлайн-игра", template: "%s · BAYHAN GAME" },
  description: DESCRIPTION,
  applicationName: "BAYHAN GAME",
  keywords: ["BAYHAN", "BAYHAN GAME", "экономическая игра", "онлайн игра", "симулятор бизнеса", "Crash", "Мины"],
  authors: [{ name: "BAYHAN STUDIO", url: "https://t.me/bayhan_studio" }],
  openGraph: {
    type: "website",
    siteName: "BAYHAN GAME",
    title: "BAYHAN GAME — экономическая онлайн-игра",
    description: DESCRIPTION,
    url: SITE,
    locale: "ru_RU",
  },
  twitter: { card: "summary_large_image", title: "BAYHAN GAME", description: DESCRIPTION },
  appleWebApp: { capable: true, title: "BAYHAN", statusBarStyle: "black-translucent" },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Lets the page extend under the iPhone notch / home indicator; insets are padded in CSS.
  viewportFit: "cover",
  themeColor: "#05060a",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru" className={`${manrope.variable} ${unbounded.variable}`}>
      <body>{children}</body>
    </html>
  );
}
