"use client";

import Link from "next/link";
import { motion } from "motion/react";
import { useCallback, useEffect, useState } from "react";
import { ArrowDownLeft, ArrowUpRight, Briefcase, Gamepad2, Gift, Send, Trophy } from "lucide-react";
import { useGame } from "@/components/game-context";
import { Burst, Button, Money, Reveal, Skeleton, formatUsd, useCountdown } from "@/components/ui";
import {
  claimDaily,
  fetchBalanceHistory,
  fetchDailyStatus,
  fetchRecentLedger,
  newIdempotencyKey,
  type DailyStatus,
  type LedgerRow,
} from "@/lib/game";

export default function HomePage() {
  const { t, snapshot } = useGame();
  const [ledger, setLedger] = useState<LedgerRow[] | null>(null);
  const [history, setHistory] = useState<{ at: string; balance: number }[] | null>(null);
  const [error, setError] = useState(false);

  const load = useCallback(() => {
    setError(false);
    Promise.all([fetchRecentLedger(8), fetchBalanceHistory(40)])
      .then(([l, h]) => {
        setLedger(l);
        setHistory(h);
      })
      .catch(() => setError(true));
  }, []);

  useEffect(load, [load]);

  return (
    <div className="space-y-5">
      <div className="grid gap-5 xl:grid-cols-[1.6fr_1fr]">
        <Reveal>
          <section className="panel panel-glow relative overflow-hidden p-6 md:p-8">
            <div className="grid-bg pointer-events-none absolute inset-0 opacity-60 [mask-image:linear-gradient(to_bottom,black,transparent)]" />
            <div className="relative">
              <p className="text-sm text-[var(--muted)]">
                {t("welcome")}
                {snapshot ? `, ${snapshot.game_name}` : ""}
              </p>
              <p className="mt-5 text-xs font-medium uppercase tracking-[0.2em] text-[var(--muted)]">{t("capital")}</p>
              {snapshot ? (
                <Money value={snapshot.total_capital} className="font-display mt-2 block text-4xl font-semibold md:text-5xl" />
              ) : (
                <Skeleton className="mt-3 h-12 w-64" />
              )}
              <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4">
                <Tile label={t("wallet")} value={snapshot?.cash} />
                <Tile label={t("bank")} value={snapshot ? Number(snapshot.bank) + Number(snapshot.assets.deposits) : undefined} />
                <Tile label={t("btc")} value={snapshot?.assets.btc_usd} />
                <Tile label={t("assets")} value={snapshot?.assets_value} />
              </div>
              <div className="mt-3 grid grid-cols-2 gap-3">
                <Tile label={t("incomeToday")} value={snapshot?.income_today} tone="up" />
                <Tile label={t("spentToday")} value={snapshot?.spent_today} tone="down" />
              </div>
              <div className="mt-6">
                <p className="mb-2 text-xs text-[var(--muted)]">{t("capitalChart")}</p>
                {history ? <BalanceChart points={history.map((p) => Number(p.balance))} /> : <Skeleton className="h-28 w-full" />}
              </div>
            </div>
          </section>
        </Reveal>

        <div className="grid gap-5">
          <Reveal delay={0.08}>
            <DailyCard />
          </Reveal>
          <Reveal delay={0.14}>
            <section className="panel p-5">
              <p className="mb-3 text-xs font-medium uppercase tracking-[0.18em] text-[var(--muted)]">{t("quickActions")}</p>
              <div className="grid grid-cols-2 gap-3">
                <Quick href="/work" icon={Briefcase} label={t("work")} hue="from-[#1b4dff]/30" />
                <Quick href="/games" icon={Gamepad2} label={t("games")} hue="from-[#7a3cff]/30" />
                <Quick href="/transfer" icon={Send} label={t("transfer")} hue="from-[#00b3a4]/30" />
                <Quick href="/leaderboard" icon={Trophy} label={t("leaderboard")} hue="from-[#ffb020]/25" />
              </div>
            </section>
          </Reveal>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[1fr_1.4fr]">
        <Reveal delay={0.18}>
          <section className="panel grid grid-cols-2 gap-3 p-5">
            <Stat label={t("level")} value={snapshot ? String(snapshot.level) : "–"} />
            <Stat label={t("xp")} value={snapshot ? String(snapshot.xp) : "–"} />
            <Stat label={t("shiftsDone")} value={snapshot ? String(snapshot.shifts_done) : "–"} />
            <Stat label={t("gamesPlayed")} value={snapshot ? String(snapshot.games_played) : "–"} />
          </section>
        </Reveal>
        <Reveal delay={0.22}>
          <section className="panel p-5">
            <h2 className="mb-3 text-sm font-semibold">{t("history")}</h2>
            {error ? (
              <div className="flex items-center justify-between text-sm text-[var(--danger)]">
                {t("loadFailed")}
                <Button variant="ghost" onClick={load} className="py-2">
                  {t("retry")}
                </Button>
              </div>
            ) : ledger === null ? (
              <div className="space-y-2">
                {[0, 1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-11 w-full" />
                ))}
              </div>
            ) : ledger.length === 0 ? (
              <p className="text-sm text-[var(--muted)]">{t("empty")}</p>
            ) : (
              <ul className="space-y-1.5">
                {ledger.map((r, i) => (
                  <motion.li
                    key={r.id}
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.03 * i }}
                    className="flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-[var(--surface-3)]/50"
                  >
                    <span
                      className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${
                        r.direction === "credit" ? "bg-[var(--success-soft)] text-[var(--success)]" : "bg-[var(--danger-soft)] text-[var(--danger)]"
                      }`}
                    >
                      {r.direction === "credit" ? <ArrowDownLeft size={15} /> : <ArrowUpRight size={15} />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm">{r.reason}</span>
                      <span className="text-xs text-[var(--dim)]">{new Date(r.created_at).toLocaleString()}</span>
                    </span>
                    <span className={`tabular text-sm font-semibold ${r.direction === "credit" ? "text-[var(--success)]" : "text-[var(--danger)]"}`}>
                      {r.direction === "credit" ? "+" : "−"}
                      {formatUsd(Number(r.amount))}
                    </span>
                  </motion.li>
                ))}
              </ul>
            )}
          </section>
        </Reveal>
      </div>
    </div>
  );
}

function Tile({ label, value, tone }: { label: string; value?: number; tone?: "up" | "down" }) {
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-2)]/70 p-3">
      <p className="text-[11px] text-[var(--muted)]">{label}</p>
      {value === undefined ? (
        <Skeleton className="mt-2 h-5 w-20" />
      ) : (
        <Money
          value={Number(value)}
          digits={0}
          className={`mt-1 block text-sm font-semibold ${tone === "up" ? "text-[var(--success)]" : tone === "down" ? "text-[var(--danger)]" : ""}`}
        />
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-[var(--bg-2)]/70 p-4">
      <p className="text-xs text-[var(--muted)]">{label}</p>
      <p className="font-display mt-1 text-2xl font-semibold tabular">{value}</p>
    </div>
  );
}

function Quick({ href, icon: Icon, label, hue }: { href: string; icon: typeof Briefcase; label: string; hue: string }) {
  return (
    <Link href={href}>
      <motion.div
        whileHover={{ y: -3 }}
        whileTap={{ scale: 0.97 }}
        className={`group relative overflow-hidden rounded-2xl border border-[var(--border)] bg-gradient-to-br ${hue} to-transparent p-4`}
      >
        <Icon size={22} className="text-white/90 transition-transform group-hover:scale-110" />
        <p className="mt-6 text-sm font-semibold">{label}</p>
      </motion.div>
    </Link>
  );
}

/** Area chart of bank balance after each journal entry. */
function BalanceChart({ points }: { points: number[] }) {
  if (points.length < 2) {
    return <div className="grid h-28 place-items-center rounded-xl bg-[var(--bg-2)]/60 text-xs text-[var(--dim)]">—</div>;
  }
  const w = 600;
  const h = 120;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const xy = points.map((p, i) => [(i / (points.length - 1)) * w, h - 8 - ((p - min) / span) * (h - 20)] as const);
  const line = xy.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `${line} L${w},${h} L0,${h} Z`;
  const [lx, ly] = xy[xy.length - 1];
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-28 w-full overflow-visible" preserveAspectRatio="none">
      <defs>
        <linearGradient id="bal-fill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="#2f7bff" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#2f7bff" stopOpacity="0" />
        </linearGradient>
      </defs>
      <motion.path d={area} fill="url(#bal-fill)" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.5, duration: 0.8 }} />
      <motion.path
        d={line}
        fill="none"
        stroke="#5aa2ff"
        strokeWidth="2.5"
        vectorEffect="non-scaling-stroke"
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 1.4, ease: [0.16, 1, 0.3, 1] }}
      />
      <motion.circle cx={lx} cy={ly} r="5" fill="#5aa2ff" initial={{ scale: 0 }} animate={{ scale: [0, 1.4, 1] }} transition={{ delay: 1.3 }} />
    </svg>
  );
}

function DailyCard() {
  const { t, refresh, toast, toastError } = useGame();
  const [status, setStatus] = useState<DailyStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [burst, setBurst] = useState(0);
  const { left, label } = useCountdown(status && !status.can_claim ? status.next_at : null);

  const load = useCallback(() => {
    fetchDailyStatus().then(setStatus).catch(() => setStatus(null));
  }, []);
  useEffect(load, [load]);
  useEffect(() => {
    if (status && !status.can_claim && left === 0) load();
  }, [left, status, load]);

  async function claim() {
    setBusy(true);
    try {
      const r = await claimDaily(newIdempotencyKey());
      setBurst(Date.now());
      toast(`${t("dailyTitle")}: +${formatUsd(Number(r.reward ?? 0))}`, "success");
      await refresh();
      load();
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  }

  const streak = status?.streak ?? 0;
  return (
    <section className="panel relative overflow-hidden p-5">
      <div className="absolute -right-10 -top-10 h-40 w-40 rounded-full bg-[var(--gold)]/10 blur-3xl" />
      <div className="relative flex items-center justify-between">
        <div className="flex items-center gap-3">
          <motion.div
            animate={status?.can_claim ? { rotate: [0, -8, 8, -4, 0] } : {}}
            transition={{ duration: 1.2, repeat: Infinity, repeatDelay: 1.6 }}
            className="grid h-11 w-11 place-items-center rounded-2xl bg-gradient-to-br from-[var(--gold)] to-[#ff8a3d] text-[#2a1600]"
          >
            <Gift size={20} />
          </motion.div>
          <div>
            <p className="text-sm font-semibold">{t("dailyTitle")}</p>
            <p className="text-xs text-[var(--muted)]">
              {t("dailyStreak")}: {streak}/7
            </p>
          </div>
        </div>
        {status && <Money value={Number(status.reward)} digits={0} className="font-display text-lg font-semibold text-[var(--gold)]" />}
      </div>
      <div className="relative mt-4 grid grid-cols-7 gap-1.5">
        {Array.from({ length: 7 }, (_, i) => {
          const day = i + 1;
          const done = status ? (status.can_claim ? day < streak : day <= streak) : false;
          const current = status?.can_claim && day === streak;
          return (
            <motion.div
              key={day}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.04 * i }}
              className={`rounded-xl py-2 text-center text-[11px] font-semibold ${
                done
                  ? "bg-[var(--gold)]/20 text-[var(--gold)]"
                  : current
                    ? "bg-[var(--accent-soft)] text-white ring-1 ring-[var(--accent)]"
                    : "bg-[var(--bg-2)] text-[var(--dim)]"
              }`}
            >
              {day}
            </motion.div>
          );
        })}
      </div>
      <div className="relative mt-4">
        <Burst trigger={burst} />
        {status === null ? (
          <Skeleton className="h-11 w-full" />
        ) : status.can_claim ? (
          <Button onClick={claim} loading={busy} disabled={busy} className="shine w-full bg-gradient-to-r from-[var(--gold)] to-[#ff8a3d] text-[#2a1600] hover:bg-none">
            {t("dailyClaim")}
          </Button>
        ) : (
          <div className="flex items-center justify-between rounded-2xl bg-[var(--bg-2)] px-4 py-3 text-sm">
            <span className="text-[var(--muted)]">{t("dailyNext")}</span>
            <span className="tabular font-semibold">{label}</span>
          </div>
        )}
      </div>
    </section>
  );
}
