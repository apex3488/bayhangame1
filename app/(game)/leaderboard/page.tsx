"use client";

import Link from "next/link";
import { motion } from "motion/react";
import { useEffect, useState } from "react";
import { Crown } from "lucide-react";
import { useGame } from "@/components/game-context";
import { PageTitle, Skeleton, formatUsd } from "@/components/ui";
import { fetchLeaderboard, type LeaderRow } from "@/lib/game";
import { fetchCorpLeaderboard } from "@/lib/economy";
import { Tabs } from "@/components/forms";
import { Avatar } from "@/components/cosmetic-view";
import { mediaUrl } from "@/lib/profile";

const profileHref = (name: string) => `/players/${encodeURIComponent(name)}`;

const PODIUM = ["#ffc94d", "#cbd5e1", "#e2a06b"];

export default function LeaderboardPage() {
  const { t, snapshot } = useGame();
  const [rows, setRows] = useState<LeaderRow[] | null>(null);
  const [error, setError] = useState(false);
  const [tab, setTab] = useState<"players" | "corps">("players");
  const [corps, setCorps] = useState<Awaited<ReturnType<typeof fetchCorpLeaderboard>> | null>(null);

  useEffect(() => {
    fetchLeaderboard(50).then(setRows).catch(() => setError(true));
    fetchCorpLeaderboard().then(setCorps).catch(() => setCorps([]));
  }, []);

  const top = rows?.slice(0, 3) ?? [];
  const rest = rows?.slice(3) ?? [];

  if (tab === "corps") {
    return (
      <div>
        <PageTitle title={t("leaderboard")} subtitle={t("corpRating")} />
        <Tabs id="lb" value={tab} onChange={setTab} tabs={[{ id: "players", label: t("capital") }, { id: "corps", label: t("corpRating") }]} />
        {!corps ? (
          <Skeleton className="h-64 w-full" />
        ) : corps.length === 0 ? (
          <p className="text-[var(--muted)]">{t("empty")}</p>
        ) : (
          <ol className="panel divide-y divide-[var(--border)] overflow-hidden">
            {corps.map((c, i) => (
              <motion.li key={c.name} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.03 * i }} className="flex items-center gap-4 px-5 py-3.5 text-sm">
                <span className={`tabular w-8 font-display font-bold ${i < 3 ? "" : "text-[var(--muted)]"}`} style={i < 3 ? { color: PODIUM[i] } : undefined}>
                  {c.rank}
                </span>
                <span className="flex-1 truncate font-medium">{c.name}</span>
                <span className="text-xs text-[var(--muted)]">
                  {t("corpLevel")} {c.level} · {c.members} 👥
                </span>
                <span className="tabular font-semibold">{c.prestige} ★</span>
              </motion.li>
            ))}
          </ol>
        )}
      </div>
    );
  }

  return (
    <div>
      <PageTitle title={t("leaderboard")} subtitle={t("capital")} />
      <Tabs id="lb" value={tab} onChange={setTab} tabs={[{ id: "players", label: t("capital") }, { id: "corps", label: t("corpRating") }]} />
      {error && <p className="text-[var(--danger)]">{t("loadFailed")}</p>}
      {!rows && !error && <Skeleton className="h-64 w-full" />}
      {rows && rows.length === 0 && <p className="text-[var(--muted)]">{t("empty")}</p>}

      {top.length > 0 && (
        <div className="mb-6 grid grid-cols-3 items-end gap-3">
          {[1, 0, 2].map((idx) => {
            const r = top[idx];
            if (!r) return <div key={`empty-${idx}`} />;
            const h = idx === 0 ? 180 : idx === 1 ? 140 : 120;
            return (
              <motion.div
                key={`podium-${idx}`}
                initial={{ opacity: 0, y: 40 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.15 * (idx === 0 ? 2 : idx === 1 ? 1 : 0), type: "spring", stiffness: 200, damping: 20 }}
                className="flex flex-col items-center"
              >
                {idx === 0 && (
                  <motion.div animate={{ y: [0, -4, 0] }} transition={{ duration: 2, repeat: Infinity }}>
                    <Crown className="mb-2 text-[var(--gold)]" size={28} />
                  </motion.div>
                )}
                <Link href={profileHref(r.game_name)} className="mb-2 flex w-full flex-col items-center gap-2 transition-transform hover:scale-105">
                  <Avatar name={r.game_name} loadout={{}} size={idx === 0 ? 72 : 56} src={mediaUrl(r.user_id, "avatar", r.avatar_version)} />
                  <span className="w-full truncate text-center text-sm font-semibold">{r.game_name}</span>
                </Link>
                <p className="tabular mb-2 text-xs text-[var(--muted)]">{formatUsd(Number(r.total_capital), 0)}</p>
                <div
                  className="font-display flex w-full items-start justify-center rounded-t-2xl pt-3 text-3xl font-bold"
                  style={{ height: h, background: `linear-gradient(180deg, ${PODIUM[idx]}55, ${PODIUM[idx]}08)`, color: PODIUM[idx] }}
                >
                  {r.rank}
                </div>
              </motion.div>
            );
          })}
        </div>
      )}

      {rest.length > 0 && (
        <ol className="panel divide-y divide-[var(--border)] overflow-hidden">
          {rest.map((r, i) => (
            <motion.li
              key={r.rank}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.02 * i }}
              className={`flex items-center gap-4 px-5 py-3.5 text-sm ${snapshot?.game_name === r.game_name ? "bg-[var(--accent-soft)]" : ""}`}
            >
              <span className="tabular w-8 text-[var(--muted)]">{r.rank}</span>
              <Link href={profileHref(r.game_name)} className="flex min-w-0 flex-1 items-center gap-3 hover:text-white">
                <Avatar name={r.game_name} loadout={{}} size={32} src={mediaUrl(r.user_id, "avatar", r.avatar_version)} />
                <span className="truncate font-medium hover:underline">{r.game_name}</span>
              </Link>
              <span className="text-xs text-[var(--muted)]">
                {t("level")} {r.level}
              </span>
              <span className="tabular font-semibold">{formatUsd(Number(r.total_capital), 0)}</span>
            </motion.li>
          ))}
        </ol>
      )}
    </div>
  );
}
