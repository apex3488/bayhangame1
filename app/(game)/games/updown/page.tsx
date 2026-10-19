"use client";

import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import { useGame } from "@/components/game-context";
import { GameRoom, PlayButton, useRound } from "@/components/game-room";

interface UpDownResult {
  from: number;
  to: number;
  direction: "up" | "down";
}

function NumberCard({ value, label, delay, tone }: { value: number | null; label: string; delay: number; tone?: "up" | "down" }) {
  return (
    <div style={{ perspective: 800 }} className="w-full">
      <AnimatePresence mode="wait">
        <motion.div
          key={value ?? "empty"}
          initial={{ rotateY: 90, opacity: 0 }}
          animate={{ rotateY: 0, opacity: 1 }}
          exit={{ rotateY: -90, opacity: 0 }}
          transition={{ delay: value === null ? 0 : delay, duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
          className={`flex aspect-[3/4] flex-col items-center justify-center rounded-3xl border ${
            value === null
              ? "border-dashed border-[var(--border-strong)] bg-[var(--bg-2)]"
              : tone === "up"
                ? "border-[var(--success)]/40 bg-gradient-to-b from-[#0b2a20] to-[#07120f]"
                : tone === "down"
                  ? "border-[var(--danger)]/40 bg-gradient-to-b from-[#2a0b12] to-[#12070a]"
                  : "border-[var(--border-strong)] bg-gradient-to-b from-[var(--surface-3)] to-[var(--surface)]"
          }`}
        >
          <span className="text-xs uppercase tracking-[0.2em] text-[var(--muted)]">{label}</span>
          <span className="font-display mt-2 text-6xl font-bold tabular md:text-7xl">{value ?? "?"}</span>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

export default function UpDownPage() {
  const { t } = useGame();
  const round = useRound<UpDownResult>("updown");
  const [dir, setDir] = useState<"up" | "down">("up");
  const [res, setRes] = useState<UpDownResult | null>(null);

  async function play() {
    setRes(null);
    const r = await round.play({ direction: dir });
    if (!r) return;
    setRes(r.result);
    setTimeout(() => round.reveal(r), 1500);
  }

  const tone = res ? (res.to > res.from ? "up" : "down") : undefined;

  const stage = (
    <div className="py-8">
      <div className="mx-auto grid max-w-lg grid-cols-[1fr_auto_1fr] items-center gap-4">
        <NumberCard value={res?.from ?? null} label="1–100" delay={0.1} />
        <motion.div
          key={res ? `${res.from}-${res.to}` : "idle"}
          initial={{ scale: 0, rotate: -90 }}
          animate={{ scale: res ? 1 : 0.8, rotate: 0 }}
          transition={{ delay: res ? 0.7 : 0, type: "spring" }}
          className={`grid h-12 w-12 place-items-center rounded-full ${
            tone === "up" ? "bg-[var(--success)] text-black" : tone === "down" ? "bg-[var(--danger)] text-white" : "bg-[var(--surface-3)] text-[var(--muted)]"
          }`}
        >
          {tone === "down" ? <ArrowDown size={22} /> : <ArrowUp size={22} />}
        </motion.div>
        <NumberCard value={res?.to ?? null} label="NEXT" delay={0.9} tone={tone} />
      </div>
      <div className="mx-auto mt-8 h-2 max-w-lg overflow-hidden rounded-full bg-[var(--surface-3)]">
        {res && (
          <motion.div
            initial={{ width: `${res.from}%` }}
            animate={{ width: `${res.to}%` }}
            transition={{ delay: 1, duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
            className={`h-full ${tone === "up" ? "bg-[var(--success)]" : "bg-[var(--danger)]"}`}
          />
        )}
      </div>
    </div>
  );

  const controls = (
    <div className="grid grid-cols-2 gap-2">
      {(["up", "down"] as const).map((d) => (
        <motion.button
          key={d}
          whileTap={{ scale: 0.95 }}
          disabled={round.busy}
          onClick={() => setDir(d)}
          className={`flex items-center justify-center gap-2 rounded-2xl py-3.5 text-sm font-semibold transition-colors ${
            dir === d
              ? d === "up"
                ? "bg-[var(--success)] text-black"
                : "bg-[var(--danger)] text-white"
              : "bg-[var(--surface-3)] text-[var(--muted)] hover:text-white"
          }`}
        >
          {d === "up" ? <ArrowUp size={16} /> : <ArrowDown size={16} />}
          {t(d)}
        </motion.button>
      ))}
    </div>
  );

  return <GameRoom game="updown" round={round} accent="#38bdf8" stage={stage} controls={controls} action={<PlayButton onClick={play} busy={round.busy} label={t("play")} />} />;
}
