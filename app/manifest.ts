import type { MetadataRoute } from "next";

/** Installable web app (Add to Home Screen) with the official BAYHAN GAME icon. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "BAYHAN GAME",
    short_name: "BAYHAN",
    description: "Экономическая онлайн-игра: работа, бизнес, активы, игры и рейтинг.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#05060a",
    theme_color: "#05060a",
    lang: "ru",
    categories: ["games", "entertainment"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
