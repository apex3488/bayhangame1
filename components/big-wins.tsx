"use client";

import { motion } from "motion/react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Flame } from "lucide-react";
import { useGame } from "./game-context";
import { formatCompact } from "./ui";
import { getSupabase } from "@/lib/supabase";
import { mediaUrl } from "@/lib/profile";

interface Win {
  id: string;
  game: string;
  bet: number;
  multiplier: number;
  payout: number;
  settled_at: string;
  game_name: string;
  user_id: string;
  avatar_version: number | null;
}

const REFRESH_MS = 30_000;

/** Live ticker of recent big wins (×3 and more) across all players. */
export function BigWins() {
  const { t } = useGame();
  const [wins, setWins] = useState<Win[]>([]);

  useEffect(() => {
    let alive = true;
    const load = () =>
      getSupabase()
        .rpc("big_wins", { p_limit: 15 })
        .then(({ data }) => alive && Array.isArray(data) && setWins(data as Win[]));
    load();
    const id = setInterval(load, REFRESH_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  if (wins.length === 0) return null;
  // The list is doubled so the marquee loops seamlessly.
  const loop = [...wins, ...wins];
  const duration = Math.max(20, wins.length * 5);

  return (
    <div className="panel relative mb-5 flex items-center overflow-hidden py-2.5">
      <div className="z-10 flex shrink-0 items-center gap-1.5 bg-[var(--surface)] pl-4 pr-3 text-[11px] font-bold uppercase tracking-wider text-[#ff7a45]">
        <motion.span animate={{ scale: [1, 1.25, 1] }} transition={{ duration: 1.4, repeat: Infinity }}>
          <Flame size={14} />
        </motion.span>
        {t("bigWins")}
      </div>
      <div className="relative min-w-0 flex-1 overflow-hidden [mask-image:linear-gradient(to_right,transparent,black_6%,black_94%,transparent)]">
        <motion.div className="flex w-max gap-2" animate={{ x: ["0%", "-50%"] }} transition={{ duration, repeat: Infinity, ease: "linear" }}>
          {loop.map((w, i) => {
            const avatar = mediaUrl(w.user_id, "avatar", w.avatar_version);
            const huge = Number(w.multiplier) >= 10;
            return (
              <Link
                key={`${w.id}-${i}`}
                href={`/players/${encodeURIComponent(w.game_name)}`}
                className="flex shrink-0 items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--bg-2)] px-2.5 py-1.5 text-xs transition-colors hover:border-[var(--border-strong)]"
              >
                <span className="grid h-6 w-6 place-items-center overflow-hidden rounded-full bg-[var(--surface-3)] text-[10px] font-bold">
                  {avatar ? (
                    // eslint-disable-next-line @next/next/no-img-element -- small avatar from Storage
                    <img src={avatar} alt="" className="h-full w-full object-cover" />
                  ) : (
                    w.game_name.slice(0, 1).toUpperCase()
                  )}
                </span>
                <span className="font-semibold">{w.game_name}</span>
                <span className="text-[var(--muted)]">{t(`game_${w.game}`)}</span>
                <span className={`rounded-md px-1.5 py-0.5 font-bold tabular ${huge ? "bg-[#ffc94d22] text-[var(--gold)]" : "bg-[var(--success-soft)] text-[var(--success)]"}`}>
                  ×{Number(w.multiplier).toFixed(2).replace(/\.00$/, "")}
                </span>
                <span className="font-semibold tabular text-[var(--success)]">+${formatCompact(Number(w.payout))}</span>
              </Link>
            );
          })}
        </motion.div>
      </div>
    </div>
  );
}
