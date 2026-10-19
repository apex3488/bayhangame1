"use client";

import { animate, motion, useMotionValue, useTransform } from "motion/react";
import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import { useGame } from "@/components/game-context";
import { GameRoom, PlayButton, useRound } from "@/components/game-room";

interface TradeResult {
  open: number;
  close: number;
  direction: "up" | "down";
  path: number[];
}

const W = 600;
const H = 260;

function Ticker({ from, to, run }: { from: number; to: number; run: number }) {
  const mv = useMotionValue(from);
  const text = useTransform(mv, (v) => v.toLocaleString("en-US", { maximumFractionDigits: 0 }));
  useEffect(() => {
    mv.set(from);
    if (!run) return;
    const c = animate(mv, to, { duration: 2.4, ease: "linear" });
    return () => c.stop();
  }, [from, to, run, mv]);
  return <motion.span className="tabular">{text}</motion.span>;
}

export default function TradePage() {
  const { t } = useGame();
  const round = useRound<TradeResult>("trade");
  const [dir, setDir] = useState<"up" | "down">("up");
  const [res, setRes] = useState<TradeResult | null>(null);
  const [run, setRun] = useState(0);

  async function play() {
    setRes(null);
    const r = await round.play({ direction: dir });
    if (!r) return;
    setRes(r.result);
    setRun(Date.now());
    setTimeout(() => round.reveal(r), 2600);
  }

  let line = "";
  let area = "";
  let entryY = H / 2;
  let last: [number, number] = [W, H / 2];
  if (res) {
    const pts = res.path.map(Number);
    const min = Math.min(...pts, res.open) - 20;
    const max = Math.max(...pts, res.open) + 20;
    const y = (v: number) => H - 20 - ((v - min) / (max - min)) * (H - 40);
    const xy = pts.map((v, i) => [(i / (pts.length - 1)) * (W - 60) + 10, y(v)] as [number, number]);
    line = xy.map(([px, py], i) => `${i ? "L" : "M"}${px},${py}`).join(" ");
    area = `${line} L${xy[xy.length - 1][0]},${H} L10,${H} Z`;
    entryY = y(res.open);
    last = xy[xy.length - 1];
  }
  const up = res ? res.close > res.open : true;
  const color = up ? "#2fe0a0" : "#ff4d61";

  const stage = (
    <div className="py-4">
      <div className="mb-4 flex items-end justify-between px-1">
        <div>
          <p className="text-xs text-[var(--muted)]">BAYHAN / USD</p>
          <p className="font-display text-3xl font-bold" style={{ color: res ? color : undefined }}>
            {res ? <Ticker from={res.open} to={res.close} run={run} /> : "—"}
          </p>
        </div>
        {res && (
          <motion.span
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 2.4 }}
            className="rounded-full px-3 py-1 text-sm font-bold tabular"
            style={{ background: `${color}22`, color }}
          >
            {res.close > res.open ? "+" : ""}
            {(((res.close - res.open) / res.open) * 100).toFixed(2)}%
          </motion.span>
        )}
      </div>
      <div className="grid-bg relative overflow-hidden rounded-3xl border border-[var(--border)] bg-[#060912]">
        <svg viewBox={`0 0 ${W} ${H}`} className="block h-64 w-full" preserveAspectRatio="none">
          {[0.25, 0.5, 0.75].map((f) => (
            <line key={f} x1="0" x2={W} y1={H * f} y2={H * f} stroke="#141b2c" />
          ))}
          {res && (
            <g key={run}>
              <line x1="0" x2={W} y1={entryY} y2={entryY} stroke="#5a6178" strokeDasharray="6 6" />
              <defs>
                <linearGradient id="trade-fill" x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0%" stopColor={color} stopOpacity="0.3" />
                  <stop offset="100%" stopColor={color} stopOpacity="0" />
                </linearGradient>
              </defs>
              <motion.path d={area} fill="url(#trade-fill)" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 2.2, duration: 0.5 }} />
              <motion.path
                d={line}
                fill="none"
                stroke={color}
                strokeWidth="3"
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
                initial={{ pathLength: 0 }}
                animate={{ pathLength: 1 }}
                transition={{ duration: 2.4, ease: "linear" }}
              />
              <motion.circle cx={last[0]} cy={last[1]} r="7" fill={color} initial={{ scale: 0 }} animate={{ scale: [0, 1.6, 1] }} transition={{ delay: 2.4 }} />
            </g>
          )}
        </svg>
        {!res && (
          <div className="absolute inset-0 grid place-items-center text-sm text-[var(--muted)]">
            {round.busy ? (
              <motion.span animate={{ opacity: [0.3, 1, 0.3] }} transition={{ duration: 1, repeat: Infinity }}>
                ● LIVE
              </motion.span>
            ) : (
              t("rules_trade")
            )}
          </div>
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
          className={`flex items-center justify-center gap-2 rounded-2xl py-3.5 text-sm font-bold transition-colors ${
            dir === d ? (d === "up" ? "bg-[var(--success)] text-black" : "bg-[var(--danger)] text-white") : "bg-[var(--surface-3)] text-[var(--muted)] hover:text-white"
          }`}
        >
          {d === "up" ? <ArrowUp size={16} /> : <ArrowDown size={16} />}
          {d === "up" ? "LONG" : "SHORT"}
        </motion.button>
      ))}
    </div>
  );

  return <GameRoom game="trade" round={round} accent="#22c55e" stage={stage} controls={controls} action={<PlayButton onClick={play} busy={round.busy} label={t("play")} />} />;
}
