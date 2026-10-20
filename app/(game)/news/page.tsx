"use client";

import { motion } from "motion/react";
import { useEffect, useState } from "react";
import { Newspaper, Pin } from "lucide-react";
import { useGame } from "@/components/game-context";
import { PageTitle, Reveal, Skeleton } from "@/components/ui";
import { fetchNews, newsImageUrl, type NewsPost } from "@/lib/social";

const LONG = 420;

export default function NewsPage() {
  const { t } = useGame();
  const [posts, setPosts] = useState<NewsPost[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetchNews(50).then(setPosts, () => setError(true));
  }, []);

  return (
    <div className="mx-auto max-w-3xl">
      <PageTitle title={t("news")} subtitle={t("newsSubtitle")} />
      {error && <p className="text-[var(--danger)]">{t("loadFailed")}</p>}
      {!posts && !error && (
        <div className="space-y-4">
          <Skeleton className="h-72 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      )}
      {posts && posts.length === 0 && (
        <div className="panel grid place-items-center gap-3 p-12 text-center text-[var(--muted)]">
          <Newspaper size={36} className="opacity-40" />
          {t("newsEmpty")}
        </div>
      )}
      <div className="space-y-5">
        {posts?.map((p, i) => (
          <Reveal key={p.id} delay={Math.min(i, 6) * 0.05}>
            <NewsCard post={p} />
          </Reveal>
        ))}
      </div>
    </div>
  );
}

function NewsCard({ post }: { post: NewsPost }) {
  const { t } = useGame();
  const [open, setOpen] = useState(post.body.length <= LONG);
  const img = newsImageUrl(post.image_path);
  return (
    <article className={`panel overflow-hidden ${post.pinned ? "ring-1 ring-[var(--accent)]/40" : ""}`}>
      {img && (
        <motion.div initial={{ scale: 1.04 }} animate={{ scale: 1 }} transition={{ duration: 0.8 }} className="overflow-hidden bg-[var(--bg-2)]">
          {/* eslint-disable-next-line @next/next/no-img-element -- admin-uploaded photo, already resized */}
          <img src={img} alt="" className="max-h-[460px] w-full object-cover" loading="lazy" />
        </motion.div>
      )}
      <div className="p-5 md:p-6">
        <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-[var(--muted)]">
          {post.pinned && (
            <span className="flex items-center gap-1 rounded-full bg-[var(--accent-soft)] px-2 py-0.5 font-semibold text-[var(--accent-2)]">
              <Pin size={11} /> {t("newsPinned")}
            </span>
          )}
          <span>{new Date(post.published_at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}</span>
          {post.author && <span>· {post.author}</span>}
        </div>
        <h2 className="font-display text-xl font-semibold leading-snug md:text-2xl">{post.title}</h2>
        <p className={`mt-3 whitespace-pre-line break-words text-sm leading-relaxed text-[var(--text)]/90 ${open ? "" : "line-clamp-6"}`}>{post.body}</p>
        {!open && (
          <button onClick={() => setOpen(true)} className="mt-2 text-sm font-semibold text-[var(--accent-2)] hover:underline">
            {t("readMore")}
          </button>
        )}
      </div>
    </article>
  );
}
