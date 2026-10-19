"use client";

import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useState } from "react";
import { Pickaxe, Timer } from "lucide-react";
import { useGame } from "@/components/game-context";
import { useAction } from "@/components/use-action";
import { Button, PageTitle, Reveal, formatUsd, useCountdown } from "@/components/ui";
import { fetchLastMining, fetchMyResources, fetchResources, fetchSettings, mineResources, sellResource, shopBuy, type Resource } from "@/lib/economy";

const RES_STYLE: Record<string, { icon: string; hue: string }> = {
  wood: { icon: "🪵", hue: "#a16207" },
  stone: { icon: "🪨", hue: "#78716c" },
  iron: { icon: "⛓️", hue: "#94a3b8" },
  diamond: { icon: "💎", hue: "#38bdf8" },
  energy: { icon: "⚡", hue: "#facc15" },
};

export default function MiningPage() {
  const { t } = useGame();
  const { busy, run } = useAction();
  const [resources, setResources] = useState<Resource[]>([]);
  const [inv, setInv] = useState<Record<string, number>>({});
  const [nextAt, setNextAt] = useState<string | null>(null);
  const [drop, setDrop] = useState<{ id: number; rewards: Record<string, number> } | null>(null);
  const [swing, setSwing] = useState(0);
  const { left, label } = useCountdown(nextAt);

  const load = useCallback(async () => {
    const [r, mine, last, s] = await Promise.all([fetchResources(), fetchMyResources(), fetchLastMining(), fetchSettings()]);
    setResources(r);
    setInv(Object.fromEntries(mine.map((m) => [m.code, Number(m.amount)])));
    setNextAt(last ? new Date(new Date(last).getTime() + (s.mining_cooldown ?? 60) * 1000).toISOString() : null);
  }, []);
  useEffect(() => {
    load().catch(() => {});
  }, [load]);

  async function mine() {
    setSwing((n) => n + 1);
    const r = await run("mine", () => mineResources(), (res) => (res.total === 0 ? t("minedNothing") : null));
    if (r) {
      setDrop({ id: Date.now(), rewards: r.rewards });
      setNextAt(r.next_at);
      load();
    }
  }

  return (
    <div>
      <PageTitle title={t("mining")} subtitle={t("miningSubtitle")} />
      <div className="grid gap-5 lg:grid-cols-[1.1fr_1fr]">
        <Reveal>
          <div className="panel relative flex min-h-[340px] flex-col items-center justify-center overflow-hidden p-6">
            <div className="grid-bg absolute inset-0 opacity-50" />
            <svg viewBox="0 0 300 160" className="relative w-full max-w-md">
              <defs>
                <linearGradient id="rock" x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0" stopColor="#44403c" />
                  <stop offset="1" stopColor="#1c1917" />
                </linearGradient>
              </defs>
              <motion.path
                key={`rock-${swing}`}
                d="M40,150 L70,80 L120,60 L170,70 L220,55 L260,100 L270,150 Z"
                fill="url(#rock)"
                animate={swing ? { x: [0, -3, 3, -2, 0] } : {}}
                transition={{ delay: 0.25, duration: 0.3 }}
              />
              {[[110, 100, "#38bdf8"], [180, 95, "#facc15"], [150, 125, "#94a3b8"], [215, 120, "#a16207"]].map(([x, y, c], i) => (
                <motion.circle key={i} cx={x as number} cy={y as number} r="5" fill={c as string}
                  animate={{ opacity: [0.3, 1, 0.3] }} transition={{ duration: 2 + i * 0.5, repeat: Infinity }} />
              ))}
              {swing > 0 &&
                Array.from({ length: 10 }, (_, i) => (
                  <motion.circle key={`${swing}-${i}`} cx="160" cy="70" r="3" fill="#fbbf24"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: [0, 1, 0], x: Math.cos(i * 0.63) * 50, y: -Math.abs(Math.sin(i * 0.63)) * 45 }}
                    transition={{ delay: 0.25, duration: 0.6 }} />
                ))}
            </svg>
            <motion.div
              key={`axe-${swing}`}
              className="pointer-events-none absolute right-[22%] top-[14%] text-white"
              initial={{ rotate: -50 }}
              animate={swing ? { rotate: [-50, 30, -50] } : { rotate: -50 }}
              transition={{ duration: 0.5, ease: "easeIn" }}
              style={{ transformOrigin: "80% 80%" }}
            >
              <Pickaxe size={64} strokeWidth={1.6} />
            </motion.div>

            <AnimatePresence>
              {drop && (
                <motion.div key={drop.id} className="absolute inset-x-0 top-6 flex justify-center gap-2" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                  {Object.entries(drop.rewards).map(([code, n], i) => (
                    <motion.span
                      key={code}
                      initial={{ y: 60, opacity: 0, scale: 0.5 }}
                      animate={{ y: 0, opacity: 1, scale: 1 }}
                      transition={{ delay: 0.35 + i * 0.12, type: "spring", stiffness: 300, damping: 16 }}
                      className="rounded-full bg-black/60 px-3 py-1.5 text-sm font-bold backdrop-blur"
                    >
                      {RES_STYLE[code]?.icon} +{n}
                    </motion.span>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>

            <div className="relative mt-6 w-full max-w-xs">
              {left > 0 ? (
                <div className="flex items-center justify-center gap-2 rounded-2xl bg-[var(--bg-2)] py-4 text-sm text-[var(--muted)]">
                  <Timer size={16} /> {t("mineAgain")} <span className="tabular font-semibold text-white">{label}</span>
                </div>
              ) : (
                <Button onClick={mine} loading={busy === "mine"} disabled={busy !== null} className="shine w-full py-4 text-base">
                  <Pickaxe size={18} /> {t("mine")}
                </Button>
              )}
            </div>
          </div>
        </Reveal>

        <Reveal delay={0.05}>
          <div className="panel p-5">
            <p className="mb-4 text-sm font-semibold">{t("inventory")}</p>
            <ul className="space-y-2">
              {resources.map((r) => (
                <ResourceRow
                  key={r.code}
                  r={r}
                  amount={inv[r.code] ?? 0}
                  busy={busy}
                  onSell={async (n) => {
                    await run(`sell-${r.code}`, (k) => sellResource(r.code, n, k), (res) => `+${formatUsd(Number(res.usd))}`);
                    load();
                  }}
                  onBuy={async (n) => {
                    await run(`buy-${r.code}`, (k) => shopBuy(`buy_${r.code}`, n, k), (res) => `−${formatUsd(Number(res.total))}`);
                    load();
                  }}
                />
              ))}
            </ul>
          </div>
        </Reveal>
      </div>
    </div>
  );
}

function ResourceRow({ r, amount, busy, onSell, onBuy }: { r: Resource; amount: number; busy: string | null; onSell: (n: number) => void; onBuy: (n: number) => void }) {
  const { t } = useGame();
  const [qty, setQty] = useState(1);
  const st = RES_STYLE[r.code] ?? { icon: "◆", hue: "#94a3b8" };
  return (
    <li className="rounded-2xl bg-[var(--bg-2)] p-3">
      <div className="flex items-center gap-3">
        <span className="grid h-11 w-11 place-items-center rounded-xl text-xl" style={{ background: `${st.hue}22` }}>
          {st.icon}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">{t(`res_${r.code}`)}</p>
          <p className="text-[11px] text-[var(--muted)]">
            {t("chance")} {r.mine_chance}% · {r.mine_min}–{r.mine_max}
          </p>
        </div>
        <motion.span key={amount} initial={{ scale: 1.4, color: "#2fe0a0" }} animate={{ scale: 1, color: "#f3f5fb" }} className="font-display text-xl font-semibold tabular">
          {amount}
        </motion.span>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <input
          type="number"
          min={1}
          value={qty}
          onChange={(e) => setQty(Math.max(1, Math.floor(Number(e.target.value) || 1)))}
          className="tabular w-20 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-2 py-2 text-center text-sm outline-none focus:border-[var(--accent)]"
        />
        <Button variant="outline" className="flex-1 px-2 py-2 text-xs" disabled={busy !== null || amount < qty} loading={busy === `sell-${r.code}`} onClick={() => onSell(qty)}>
          {t("sell")} · {formatUsd(Number(r.sell_price) * qty, 0)}
        </Button>
        <Button variant="ghost" className="flex-1 px-2 py-2 text-xs" disabled={busy !== null} loading={busy === `buy-${r.code}`} onClick={() => onBuy(qty)}>
          {t("buy")} · {formatUsd(Number(r.buy_price) * qty, 0)}
        </Button>
      </div>
    </li>
  );
}
