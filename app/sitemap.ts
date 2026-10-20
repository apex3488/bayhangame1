import type { MetadataRoute } from "next";

const SITE = "https://bayhangame1.vercel.app";

/** Only public pages: everything else needs an account. */
export default function sitemap(): MetadataRoute.Sitemap {
  return ["/login", "/register", "/rules"].map((p) => ({ url: `${SITE}${p}`, changeFrequency: "weekly", priority: p === "/register" ? 1 : 0.6 }));
}
