"use client";

import Link from "next/link";
import { motion } from "motion/react";
import { Bomb, ChartCandlestick, Cherry, CircleDot, Crosshair, Dices, Disc3, Goal, Rocket, Spade, TrendingUp, type LucideIcon } from "lucide-react";
import { useGame } from "@/components/game-context";
import { PageTitle, Reveal } from "@/components/ui";
import type { GameId } from "@/lib/game";

const GAMES: { id: GameId; icon: LucideIcon; from: string; to: string; tag: string }[] = [
  { id: "crash", icon: Rocket, from: "#ff6b2c", to: "#d6006e", tag: "×1000" },
  { id: "slots", icon: Cherry, from: "#ff3d71", to: "#7a1fff", tag: "×100" },
  { id: "mines", icon: Bomb, from: "#2f7bff", to: "#00d4ff", tag: "×18000" },
  { id: "spin", icon: Disc3, from: "#ffb020", to: "#ff4d61", tag: "×10" },
  { id: "casino", icon: Spade, from: "#10b981", to: "#0f766e", tag: "×10" },
  { id: "dice", icon: Dices, from: "#a855f7", to: "#6366f1", tag: "×5.5" },
  { id: "trade", icon: ChartCandlestick, from: "#22c55e", to: "#0ea5e9", tag: "×1.9" },
  { id: "updown", icon: TrendingUp, from: "#38bdf8", to: "#2f7bff", tag: "×1.9" },
  { id: "basketball", icon: Goal, from: "#ff8a3d", to: "#e11d48", tag: "×2" },
  { id: "darts", icon: Crosshair, from: "#f43f5e", to: "#9f1239", tag: "×5" },
  { id: "bowling", icon: CircleDot, from: "#64748b", to: "#2f7bff", tag: "×5" },
];

export default function GamesHub() {
  const { t } = useGame();
  return (
    <div>
      <PageTitle title={t("gamesTitle")} subtitle={t("gamesSubtitle")} />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 md:gap-4 xl:grid-cols-4">
        {GAMES.map((g, i) => {
          const Icon = g.icon;
          return (
            <Reveal key={g.id} delay={i * 0.04}>
              <Link href={`/games/${g.id}`}>
                <motion.div
                  whileHover={{ y: -6, rotateX: 4 }}
                  whileTap={{ scale: 0.97 }}
                  transition={{ type: "spring", stiffness: 300, damping: 20 }}
                  className="group relative aspect-[4/5] overflow-hidden rounded-3xl border border-white/10 p-4"
                  style={{ background: `linear-gradient(150deg, ${g.from}, ${g.to})`, transformPerspective: 800 }}
                >
                  <div className="absolute inset-0 bg-[radial-gradient(80%_60%_at_80%_10%,rgba(255,255,255,.35),transparent_60%)]" />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent" />
                  <motion.div
                    className="absolute -right-6 top-6 text-white/25"
                    animate={{ rotate: [0, 8, 0], y: [0, -6, 0] }}
                    transition={{ duration: 5 + i * 0.3, repeat: Infinity, ease: "easeInOut" }}
                  >
                    <Icon size={130} strokeWidth={1.4} />
                  </motion.div>
                  <span className="relative rounded-full bg-black/35 px-2.5 py-1 text-[11px] font-bold backdrop-blur">{g.tag}</span>
                  <div className="absolute inset-x-4 bottom-4">
                    <p className="font-display text-lg font-semibold leading-tight">{t(`game_${g.id}`)}</p>
                    <p className="mt-1 line-clamp-2 text-[11px] text-white/75">{t(`gamed_${g.id}`)}</p>
                  </div>
                  <div className="shine absolute inset-0 opacity-0 transition-opacity group-hover:opacity-100" />
                </motion.div>
              </Link>
            </Reveal>
          );
        })}
      </div>
    </div>
  );
}
