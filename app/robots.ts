import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: ["/login", "/register", "/rules"], disallow: ["/admin", "/api"] }],
    sitemap: "https://bayhangame1.vercel.app/sitemap.xml",
  };
}
