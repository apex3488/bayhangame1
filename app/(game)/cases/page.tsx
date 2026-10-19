"use client";

import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { Package } from "lucide-react";
import { useGame } from "@/components/game-context";
import { useCelebrate } from "@/components/victory";
import { useAction } from "@/components/use-action";
import { RARITY_COLOR } from "@/components/cosmetic-view";
import { Burst, Button, PageTitle, Reveal, formatCompact, formatUsd } from "@/components/ui";
import { fetchCaseRewards, fetchCases, openCase, type CaseReward, type CaseRow } from "@/lib/economy";

const TILE = 120;
const GAP = 8;
const WIN = 40;
const RES_ICON: Record<string, string> = { wood: "🪵", stone: "🪨", iron: "⛓️", diamond: "💎", energy: "⚡" };

function rewardLabel(r: CaseReward, t: (k: string) => string) {
  if (r.reward_type === "usd") return `$${formatCompact(Number(r.amount))}`;
  if (r.reward_type === "btc") return `${Number(r.amount)} ₿`;
  return `${RES_ICON[r.resource_code ?? ""] ?? ""} ${Number(r.amount)} ${t(`res_${r.resource_code}`)}`;
}

export default function CasesPage() {
  const { t } = useGame();
  const { busy, run } = useAction();
  const celebrate = useCelebrate();
  const [cases, setCases] = useState<CaseRow[]>([]);
  const [rewards, setRewards] = useState<CaseReward[]>([]);
  const [selected, setSelected] = useState("starter");
  const [strip, setStrip] = useState<CaseReward[]>([]);
  const [x, setX] = useState(0);
  const [spinId, setSpinId] = useState(0);
  const [won, setWon] = useState<CaseReward | null>(null);
  const [rolling, setRolling] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    Promise.all([fetchCases(), fetchCaseRewards()]).then(([c, r]) => {
      setCases(c);
      setRewards(r);
    });
  }, []);

  const pool = rewards.filter((r) => r.case_code === selected);
  const totalW = pool.reduce((s, r) => s + r.weight, 0);
  const pick = () => {
    let roll = Math.random() * totalW;
    for (const r of pool) if ((roll -= r.weight) < 0) return r;
    return pool[0];
  };

  async function open() {
    const c = cases.find((x) => x.code === selected);
    if (!c) return;
    setWon(null);
    const res = await run("open", (k) => openCase(selected, k));
    if (!res) return;
    const reward = res.reward;
    setStrip(Array.from({ length: WIN + 5 }, (_, i) => (i === WIN ? reward : pick())));
    setX(0);
    setSpinId((n) => n + 1);
    setRolling(true);
    const w = box.current?.clientWidth ?? 600;
    requestAnimationFrame(() => setX(-(WIN * (TILE + GAP)) + w / 2 - TILE / 2 + (Math.random() - 0.5) * TILE * 0.5));
    setTimeout(() => {
      setWon(reward);
      setRolling(false);
      // A cash reward worth more than the case is a win.
      if (reward.reward_type === "usd" && Number(reward.amount) > Number(c.price)) {
        celebrate({ amount: Number(reward.amount) - Number(c.price), multiplier: Math.round((Number(reward.amount) / Number(c.price)) * 100) / 100 });
      }
    }, 4600);
  }

  const current = cases.find((c) => c.code === selected);

  return (
    <div>
      <PageTitle title={t("cases")} subtitle={t("casesSubtitle")} />
      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        {cases.map((c, i) => {
          const color = RARITY_COLOR[c.rarity] ?? "#94a3b8";
          return (
            <Reveal key={c.code} delay={i * 0.05}>
              <motion.button
                whileHover={{ y: -4 }}
                whileTap={{ scale: 0.97 }}
                disabled={rolling}
                onClick={() => setSelected(c.code)}
                className={`relative w-full overflow-hidden rounded-3xl border p-4 text-left transition-colors ${
                  selected === c.code ? "border-transparent" : "border-[var(--border)]"
                }`}
                style={{ background: `linear-gradient(160deg, ${color}33, #0b1020)`, boxShadow: selected === c.code ? `0 0 0 2px ${color}, 0 20px 50px -20px ${color}` : undefined }}
              >
                <motion.div animate={selected === c.code ? { rotate: [0, -6, 6, 0], y: [0, -4, 0] } : {}} transition={{ duration: 2, repeat: Infinity }} className="mb-6 inline-block" style={{ color }}>
                  <Package size={44} strokeWidth={1.5} />
                </motion.div>
                <p className="font-display font-semibold">{t(`case_${c.code}`)}</p>
                <p className="text-sm font-bold tabular" style={{ color }}>
                  {formatUsd(Number(c.price), 0)}
                </p>
              </motion.button>
            </Reveal>
          );
        })}
      </div>

      <div className="panel relative mb-5 overflow-hidden p-4 md:p-6">
        <div ref={box} className="relative overflow-hidden rounded-3xl border border-[var(--border)] bg-[#070a12] py-5">
          <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-24 bg-gradient-to-r from-[#070a12] to-transparent" />
          <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-24 bg-gradient-to-l from-[#070a12] to-transparent" />
          <div className="absolute inset-y-2 left-1/2 z-20 w-[3px] -translate-x-1/2 rounded-full bg-[var(--gold)] shadow-[0_0_16px_var(--gold)]" />
          {strip.length === 0 ? (
            <div className="flex h-[120px] items-center justify-center gap-3 px-6">
              {pool.slice(0, 6).map((r) => (
                <RewardTile key={r.id} r={r} t={t} dim />
              ))}
            </div>
          ) : (
            <motion.div key={spinId} className="flex" style={{ gap: GAP, paddingLeft: GAP }} initial={{ x: 0 }} animate={{ x }}
              transition={{ duration: 4.4, ease: [0.1, 0.75, 0.15, 1] }}>
              {strip.map((r, i) => (
                <RewardTile key={i} r={r} t={t} highlight={!!won && i === WIN} />
              ))}
            </motion.div>
          )}
        </div>
        <Burst trigger={won ? spinId : 0} count={36} />
        <AnimatePresence>
          {won && (
            <motion.div initial={{ opacity: 0, y: 10, scale: 0.95 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0 }}
              className="mt-4 flex items-center justify-center gap-3 text-center">
              <span className="text-sm text-[var(--muted)]">{t("youGot")}:</span>
              <span className="font-display text-2xl font-bold" style={{ color: RARITY_COLOR[won.rarity] }}>
                {rewardLabel(won, t)}
              </span>
            </motion.div>
          )}
        </AnimatePresence>
        <div className="mx-auto mt-5 max-w-sm">
          <Button onClick={open} disabled={busy !== null || rolling || !current} loading={busy === "open"} className="shine w-full py-4 text-base">
            {t("openCase")} · {current ? formatUsd(Number(current.price), 0) : ""}
          </Button>
        </div>
      </div>

      <div className="panel p-5">
        <p className="mb-3 text-sm font-semibold">{t("possibleRewards")}</p>
        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {pool.map((r) => (
            <li key={r.id} className="flex items-center justify-between rounded-2xl bg-[var(--bg-2)] px-4 py-3 text-sm">
              <span className="font-semibold" style={{ color: RARITY_COLOR[r.rarity] }}>
                {rewardLabel(r, t)}
              </span>
              <span className="tabular text-[var(--muted)]">{((r.weight / totalW) * 100).toFixed(1)}%</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function RewardTile({ r, t, highlight, dim }: { r: CaseReward; t: (k: string) => string; highlight?: boolean; dim?: boolean }) {
  const color = RARITY_COLOR[r.rarity] ?? "#94a3b8";
  return (
    <div
      className={`grid shrink-0 place-items-center rounded-2xl border border-white/10 px-2 text-center ${dim ? "opacity-60" : ""}`}
      style={{
        width: TILE,
        height: TILE,
        background: `linear-gradient(160deg, ${color}44, #0b1020 70%)`,
        boxShadow: highlight ? `0 0 0 3px var(--gold), 0 0 40px ${color}` : `inset 0 -3px 0 ${color}`,
      }}
    >
      <span className="font-display text-sm font-bold leading-tight">{rewardLabel(r, t)}</span>
    </div>
  );
}
