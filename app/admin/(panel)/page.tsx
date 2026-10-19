"use client";

import { motion } from "motion/react";
import { useEffect, useState } from "react";
import { Activity, Coins, Gamepad2, ShieldAlert, Users } from "lucide-react";
import { useGame } from "@/components/game-context";
import { PageTitle, Reveal, Skeleton, formatCompact, formatUsd } from "@/components/ui";
import { adminDailyStats, adminDashboard, type Dashboard } from "@/lib/admin";

type Day = Awaited<ReturnType<typeof adminDailyStats>>[number];

export default function AdminDashboard() {
  const { t, toastError } = useGame();
  const [d, setD] = useState<Dashboard | null>(null);
  const [days, setDays] = useState<Day[]>([]);

  useEffect(() => {
    adminDashboard().then(setD).catch(toastError);
    adminDailyStats(14).then(setDays).catch(toastError);
  }, [toastError]);

  if (!d) return <Skeleton className="h-96" />;
  const house = Number(d.bets_24h) - Number(d.payouts_24h);

  return (
    <div className="space-y-5">
      <PageTitle title={t("a_dashboard")} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Card icon={Users} label={t("a_playersTotal")} value={formatCompact(d.players_total)} hue="#2f7bff" />
        <Card icon={Users} label={t("a_new24h")} value={`+${d.players_new_24h}`} sub={`${t("a_new7d")}: +${d.players_new_7d}`} hue="#22c55e" />
        <Card icon={Activity} label={t("a_active24h")} value={String(d.players_active_24h)} hue="#38bdf8" />
        <Card icon={ShieldAlert} label={t("a_blocked")} value={String(d.players_blocked)} hue="#ff4d61" />
        <Card icon={Activity} label={t("a_adminActions24h")} value={String(d.admin_actions_24h)} hue="#a855f7" />
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <Reveal className="lg:col-span-2">
          <div className="panel p-5">
            <p className="mb-1 text-sm font-semibold">{t("a_registrations")}</p>
            <p className="mb-4 text-xs text-[var(--muted)]">{t("a_last14")}</p>
            <Bars data={days.map((x) => ({ label: x.day.slice(5), a: Number(x.registrations) }))} color="#2f7bff" />
            <p className="mb-1 mt-6 text-sm font-semibold">{t("a_gameVolume")}</p>
            <Bars data={days.map((x) => ({ label: x.day.slice(5), a: Number(x.bets), b: Number(x.payouts) }))} color="#a855f7" color2="#2fe0a0" money />
            <div className="mt-2 flex gap-4 text-[11px] text-[var(--muted)]">
              <span className="flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-[#a855f7]" /> {t("a_bets24h").split(" ")[0]}</span>
              <span className="flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-[#2fe0a0]" /> {t("a_payouts24h").split(" ")[0]}</span>
            </div>
          </div>
        </Reveal>
        <Reveal delay={0.05}>
          <div className="panel space-y-3 p-5">
            <p className="flex items-center gap-2 text-sm font-semibold"><Coins size={16} className="text-[var(--gold)]" /> {t("a_moneySupply")}</p>
            <Row label={t("a_wallets")} value={formatUsd(Number(d.money_cash), 0)} />
            <Row label={t("a_banks")} value={formatUsd(Number(d.money_bank), 0)} />
            <Row label={t("a_deposits")} value={formatUsd(Number(d.money_deposits), 0)} />
            <Row label="BTC" value={`${Number(d.money_btc).toFixed(4)} ₿`} />
            <div className="border-t border-[var(--border)] pt-3" />
            <Row label={t("a_ops24h")} value={String(d.ops_24h)} />
            <Row label={t("a_transfers24h")} value={`${formatUsd(Number(d.transfers_24h), 0)} · ${d.transfers_count_24h}`} />
            <Row label={t("a_shifts24h")} value={String(d.shifts_24h)} />
            <Row label={t("a_issued24h")} value={formatUsd(Number(d.income_issued_24h), 0)} />
          </div>
        </Reveal>
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <Reveal delay={0.08}>
          <div className="panel space-y-3 p-5">
            <p className="flex items-center gap-2 text-sm font-semibold"><Gamepad2 size={16} className="text-[#a855f7]" /> {t("a_rounds24h")}: {d.rounds_24h}</p>
            <Row label={t("a_bets24h")} value={formatUsd(Number(d.bets_24h), 0)} />
            <Row label={t("a_payouts24h")} value={formatUsd(Number(d.payouts_24h), 0)} />
            <Row label={t("a_houseResult")} value={formatUsd(house, 0)} tone={house >= 0 ? "up" : "down"} />
          </div>
        </Reveal>
        <Reveal delay={0.1} className="lg:col-span-2">
          <div className="panel overflow-hidden">
            <p className="px-5 pt-5 text-sm font-semibold">{t("a_gamesWeek")}</p>
            {d.games.length === 0 ? (
              <p className="p-5 text-sm text-[var(--muted)]">{t("a_noData")}</p>
            ) : (
              <table className="mt-3 w-full text-sm">
                <tbody className="divide-y divide-[var(--border)]">
                  {d.games.map((g) => (
                    <tr key={g.game}>
                      <td className="px-5 py-2.5 font-medium">{t(`game_${g.game}`)}</td>
                      <td className="px-3 py-2.5 text-right tabular text-[var(--muted)]">{g.rounds}</td>
                      <td className="px-3 py-2.5 text-right tabular">{formatUsd(Number(g.bets), 0)}</td>
                      <td className={`px-5 py-2.5 text-right tabular ${Number(g.bets) - Number(g.payouts) >= 0 ? "text-[var(--success)]" : "text-[var(--danger)]"}`}>
                        {formatUsd(Number(g.bets) - Number(g.payouts), 0)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </Reveal>
      </div>
    </div>
  );
}

function Card({ icon: Icon, label, value, sub, hue }: { icon: typeof Users; label: string; value: string; sub?: string; hue: string }) {
  return (
    <Reveal>
      <div className="panel relative overflow-hidden p-4">
        <div className="absolute -right-8 -top-8 h-24 w-24 rounded-full opacity-25 blur-2xl" style={{ background: hue }} />
        <p className="relative flex items-center gap-1.5 text-[11px] text-[var(--muted)]"><Icon size={13} style={{ color: hue }} /> {label}</p>
        <p className="font-display relative mt-2 text-2xl font-semibold tabular">{value}</p>
        {sub && <p className="relative mt-1 text-[11px] text-[var(--muted)]">{sub}</p>}
      </div>
    </Reveal>
  );
}

function Row({ label, value, tone }: { label: string; value: string; tone?: "up" | "down" }) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="text-[var(--muted)]">{label}</span>
      <span className={`tabular font-semibold ${tone === "up" ? "text-[var(--success)]" : tone === "down" ? "text-[var(--danger)]" : ""}`}>{value}</span>
    </div>
  );
}

/** Simple animated bar chart; `b` draws a second, narrower bar. */
function Bars({ data, color, color2, money }: { data: { label: string; a: number; b?: number }[]; color: string; color2?: string; money?: boolean }) {
  const max = Math.max(1, ...data.map((d) => Math.max(d.a, d.b ?? 0)));
  return (
    <div className="flex h-36 items-end gap-1.5">
      {data.map((d, i) => (
        <div key={d.label} className="group relative flex h-full flex-1 flex-col items-center justify-end gap-1">
          <div className="pointer-events-none absolute -top-1 z-10 hidden -translate-y-full whitespace-nowrap rounded-lg bg-black/80 px-2 py-1 text-[10px] group-hover:block">
            {money ? `${formatCompact(d.a)} / ${formatCompact(d.b ?? 0)}` : d.a}
          </div>
          <div className="flex h-full w-full items-end justify-center gap-0.5">
            <motion.div className="w-full max-w-[18px] rounded-t-md" style={{ background: color }} initial={{ height: 0 }} animate={{ height: `${(d.a / max) * 100}%` }} transition={{ delay: i * 0.03, duration: 0.6 }} />
            {d.b !== undefined && (
              <motion.div className="w-full max-w-[18px] rounded-t-md" style={{ background: color2 }} initial={{ height: 0 }} animate={{ height: `${(d.b / max) * 100}%` }} transition={{ delay: i * 0.03 + 0.1, duration: 0.6 }} />
            )}
          </div>
          <span className="text-[9px] text-[var(--dim)]">{d.label}</span>
        </div>
      ))}
    </div>
  );
}
