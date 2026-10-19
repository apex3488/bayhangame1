"use client";

import Link from "next/link";
import { motion } from "motion/react";
import { useCallback, useEffect, useState } from "react";
import { Building, Check, ChevronDown, ChevronUp, Crown, LogOut, UserMinus, Users } from "lucide-react";
import { useAsk, useGame } from "@/components/game-context";
import { useAction } from "@/components/use-action";
import { AmountForm, TextForm } from "@/components/forms";
import { Button, Money, PageTitle, Reveal, Skeleton, formatCompact, formatUsd } from "@/components/ui";
import {
  corpBuyBuilding,
  corpClaimTask,
  corpCreate,
  corpDeposit,
  corpInvite,
  corpLeave,
  corpManage,
  corpRespond,
  corpWithdraw,
  fetchCorporation,
  type MyCorporation,
} from "@/lib/economy";

const CAN_INVITE = ["president", "vp", "manager"];
const CAN_WITHDRAW = ["president", "financier"];
const CAN_BUILD = ["president", "vp", "financier"];
const CAN_TASKS = ["president", "vp", "manager"];

export default function CorporationPage() {
  const { t, snapshot } = useGame();
  const { busy, run } = useAction();
  const ask = useAsk();
  const [data, setData] = useState<MyCorporation | null>(null);
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");

  const load = useCallback(() => {
    fetchCorporation().then(setData).catch(() => {});
  }, []);
  useEffect(load, [load]);

  const act = async <T,>(id: string, fn: (k: string) => Promise<T>, msg?: (r: T) => string) => {
    const r = await run(id, fn, msg);
    load();
    return r;
  };

  if (!data) return <Skeleton className="h-96" />;

  if (!data.member) {
    return (
      <div className="mx-auto max-w-3xl">
        <PageTitle title={t("corporation")} subtitle={t("corpSubtitle")} />
        {data.invites && data.invites.length > 0 && (
          <Reveal>
            <div className="panel mb-5 p-5">
              <p className="mb-3 text-sm font-semibold">{t("invites")}</p>
              <ul className="space-y-2">
                {data.invites.map((i) => (
                  <li key={i.id} className="flex items-center justify-between gap-3 rounded-2xl bg-[var(--bg-2)] px-4 py-3">
                    <span className="text-sm">
                      <span className="font-semibold">{i.corp}</span> <span className="text-[var(--muted)]">· {i.from}</span>
                    </span>
                    <div className="flex gap-2">
                      <Button variant="success" className="px-3 py-1.5 text-xs" disabled={busy !== null} onClick={() => act(`a${i.id}`, () => corpRespond(i.id, true))}>
                        {t("accept")}
                      </Button>
                      <Button variant="ghost" className="px-3 py-1.5 text-xs" disabled={busy !== null} onClick={() => act(`d${i.id}`, () => corpRespond(i.id, false))}>
                        {t("decline")}
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </Reveal>
        )}
        <Reveal delay={0.05}>
          <form
            className="panel relative space-y-4 overflow-hidden p-6"
            onSubmit={async (e) => {
              e.preventDefault();
              await act("create", (k) => corpCreate(name.trim(), desc.trim(), k), () => t("corpCreate"));
            }}
          >
            <div className="absolute -right-10 -top-10 h-40 w-40 rounded-full bg-[#6366f1]/25 blur-3xl" />
            <div className="relative flex items-center gap-3">
              <div className="grid h-12 w-12 place-items-center rounded-2xl bg-gradient-to-br from-[#6366f1] to-[#2f7bff]">
                <Users size={22} />
              </div>
              <div>
                <p className="font-display text-lg font-semibold">{t("corpCreate")}</p>
                <p className="text-xs text-[var(--muted)]">
                  {t("corpCost")}: <span className="font-semibold text-[var(--gold)]">{formatUsd(Number(data.create_cost ?? 0), 0)}</span>
                </p>
              </div>
            </div>
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={24} placeholder={t("corpName")}
              className="relative w-full rounded-2xl border border-[var(--border)] bg-[var(--bg-2)] px-4 py-3 outline-none focus:border-[var(--accent)]" />
            <textarea value={desc} onChange={(e) => setDesc(e.target.value)} maxLength={200} placeholder={t("corpDescription")} rows={3}
              className="relative w-full resize-none rounded-2xl border border-[var(--border)] bg-[var(--bg-2)] px-4 py-3 outline-none focus:border-[var(--accent)]" />
            <Button className="relative w-full" disabled={busy !== null || name.trim().length < 3} loading={busy === "create"}>
              {t("corpCreate")}
            </Button>
          </form>
        </Reveal>
      </div>
    );
  }

  const c = data.corp!;
  const role = data.role!;
  const prestigeInLevel = c.prestige % 100;

  return (
    <div>
      <Reveal>
        <div className="panel panel-glow relative mb-5 overflow-hidden p-6 md:p-8">
          <div className="grid-bg absolute inset-0 opacity-50 [mask-image:linear-gradient(to_bottom,black,transparent)]" />
          <div className="relative flex flex-wrap items-end justify-between gap-6">
            <div className="flex items-center gap-4">
              <motion.div animate={{ rotate: [0, 4, -4, 0] }} transition={{ duration: 6, repeat: Infinity }} className="grid h-16 w-16 place-items-center rounded-3xl bg-gradient-to-br from-[#6366f1] to-[#2f7bff] font-display text-2xl font-bold">
                {c.name.slice(0, 2).toUpperCase()}
              </motion.div>
              <div>
                <h1 className="font-display text-3xl font-semibold">{c.name}</h1>
                <p className="text-sm text-[var(--muted)]">{c.description || "—"}</p>
                <p className="mt-1 text-xs font-semibold text-[var(--accent-2)]">{t(`role_${role}`)}</p>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <Stat label={t("treasury")} value={<Money value={Number(c.treasury)} digits={0} />} />
              <Stat label={t("prestige")} value={String(c.prestige)} />
              <Stat label={t("corpLevel")} value={String(c.level)} />
            </div>
          </div>
          <div className="relative mt-5 h-2 overflow-hidden rounded-full bg-[var(--surface-3)]">
            <motion.div className="h-full rounded-full bg-gradient-to-r from-[#6366f1] to-[var(--accent-2)]" initial={{ width: 0 }} animate={{ width: `${prestigeInLevel}%` }} transition={{ duration: 1.2 }} />
          </div>
        </div>
      </Reveal>

      <div className="grid gap-5 lg:grid-cols-2">
        <Reveal delay={0.05}>
          <div className="panel space-y-5 p-5">
            <AmountForm label={t("depositToTreasury")} action={t("depositToTreasury")} max={Number(snapshot?.cash ?? 0)} busy={busy === "dep"} variant="success"
              onSubmit={(a) => act("dep", (k) => corpDeposit(a, k), () => `${t("depositToTreasury")}: ${formatUsd(a)}`)} />
            {CAN_WITHDRAW.includes(role) && (
              <AmountForm label={t("withdrawFromTreasury")} action={t("withdrawFromTreasury")} max={Number(c.treasury)} busy={busy === "wd"} variant="outline"
                onSubmit={(a) => act("wd", (k) => corpWithdraw(a, k), () => `${t("withdrawFromTreasury")}: ${formatUsd(a)}`)} />
            )}
            {CAN_INVITE.includes(role) && (
              <TextForm label={t("invite")} placeholder={t("invitePlaceholder")} action={t("invite")} maxLength={20} busy={busy === "inv"}
                onSubmit={(n) => act("inv", () => corpInvite(n), () => `${t("invite")}: ${n}`)} />
            )}
          </div>
        </Reveal>

        <Reveal delay={0.08}>
          <div className="panel p-5">
            <p className="mb-3 text-sm font-semibold">
              {t("members")} · {data.members?.length}
            </p>
            <ul className="space-y-1.5">
              {data.members?.map((m) => (
                <li key={m.user_id} className="flex items-center gap-3 rounded-2xl bg-[var(--bg-2)] px-3 py-2.5">
                  {m.role === "president" ? <Crown size={16} className="text-[var(--gold)]" /> : <span className="w-4" />}
                  <Link href={`/players/${encodeURIComponent(m.game_name)}`} className="min-w-0 flex-1 truncate text-sm font-medium hover:underline">{m.game_name}</Link>
                  <span className="text-[11px] text-[var(--muted)]">{t(`role_${m.role}`)}</span>
                  {role === "president" && m.role !== "president" && (
                    <span className="flex gap-1">
                      <IconBtn title={t("promote")} onClick={() => act(`p${m.user_id}`, () => corpManage(m.user_id, "promote"))}><ChevronUp size={14} /></IconBtn>
                      <IconBtn title={t("demote")} onClick={() => act(`d${m.user_id}`, () => corpManage(m.user_id, "demote"))}><ChevronDown size={14} /></IconBtn>
                      <IconBtn title={t("kick")} danger onClick={async () => (await ask(`${t("kick")} ${m.game_name}?`, { danger: true })) && act(`k${m.user_id}`, () => corpManage(m.user_id, "kick"))}><UserMinus size={14} /></IconBtn>
                    </span>
                  )}
                </li>
              ))}
            </ul>
            {role !== "president" && (
              <button onClick={async () => (await ask(`${t("leave")}?`, { danger: true })) && act("leave", () => corpLeave())} className="mt-4 inline-flex items-center gap-1.5 text-xs text-[var(--muted)] hover:text-[var(--danger)]">
                <LogOut size={13} /> {t("leave")}
              </button>
            )}
          </div>
        </Reveal>

        <Reveal delay={0.1}>
          <div className="panel p-5">
            <p className="mb-3 text-sm font-semibold">{t("buildings")}</p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {data.buildings?.map((b, i) => (
                <motion.div key={b.code} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}
                  className={`rounded-2xl border p-3 ${b.owned ? "border-[#6366f1]/50 bg-[#6366f1]/10" : "border-[var(--border)] bg-[var(--bg-2)]"}`}>
                  <motion.div animate={b.owned ? { y: [0, -3, 0] } : {}} transition={{ duration: 3, repeat: Infinity, delay: i * 0.3 }}>
                    <Building size={26} className={b.owned ? "text-[#a5b4fc]" : "text-[var(--dim)]"} />
                  </motion.div>
                  <p className="mt-2 text-sm font-semibold">{t(`bld_${b.code}`)}</p>
                  <p className="text-[11px] text-[var(--muted)]">+{b.prestige} {t("prestige")}</p>
                  {b.owned ? (
                    <p className="mt-2 flex items-center gap-1 text-xs font-semibold text-[var(--success)]"><Check size={12} /> {t("owned")}</p>
                  ) : (
                    <Button className="mt-2 w-full px-2 py-1.5 text-[11px]" disabled={!CAN_BUILD.includes(role) || busy !== null || Number(c.treasury) < Number(b.price)}
                      loading={busy === `b${b.code}`} onClick={() => act(`b${b.code}`, () => corpBuyBuilding(b.code), () => `${t("bought")}: ${t(`bld_${b.code}`)}`)}>
                      ${formatCompact(Number(b.price))}
                    </Button>
                  )}
                </motion.div>
              ))}
            </div>
          </div>
        </Reveal>

        <Reveal delay={0.12}>
          <div className="panel p-5">
            <p className="mb-3 text-sm font-semibold">{t("tasks")}</p>
            <ul className="space-y-2">
              {data.tasks?.map((task) => {
                const pct = Math.min(100, (task.progress / task.target) * 100);
                return (
                  <li key={task.code} className="rounded-2xl bg-[var(--bg-2)] p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium">{t(`ctask_${task.code}`)}</span>
                      <span className="text-xs font-semibold text-[var(--gold)]">+${formatCompact(Number(task.reward))} · +{task.prestige}</span>
                    </div>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--surface-3)]">
                      <motion.div className="h-full rounded-full bg-[var(--accent)]" initial={{ width: 0 }} animate={{ width: `${pct}%` }} transition={{ duration: 1 }} />
                    </div>
                    <div className="mt-2 flex items-center justify-between text-xs">
                      <span className="text-[var(--muted)] tabular">{task.progress}/{task.target}</span>
                      {task.claimed ? (
                        <span className="font-semibold text-[var(--success)]">{t("claimed")}</span>
                      ) : (
                        <Button className="px-3 py-1 text-[11px]" disabled={pct < 100 || !CAN_TASKS.includes(role) || busy !== null}
                          loading={busy === `t${task.code}`} onClick={() => act(`t${task.code}`, () => corpClaimTask(task.code), (r) => `+${formatUsd(Number((r as { reward: number }).reward))}`)}>
                          {t("claimReward")}
                        </Button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        </Reveal>

        <Reveal delay={0.14} className="lg:col-span-2">
          <div className="panel p-5">
            <p className="mb-3 text-sm font-semibold">{t("treasuryLog")}</p>
            {data.log && data.log.length > 0 ? (
              <ul className="divide-y divide-[var(--border)] text-sm">
                {data.log.map((l, i) => (
                  <li key={i} className="flex items-center justify-between gap-3 py-2.5">
                    <span className="text-[var(--muted)]">
                      {t(`log_${l.kind}`)} {l.note ? `· ${t(`bld_${l.note}`) !== `bld_${l.note}` ? t(`bld_${l.note}`) : t(`ctask_${l.note}`)}` : ""} {l.game_name ? `· ${l.game_name}` : ""}
                    </span>
                    <span className={`tabular font-semibold ${l.kind === "deposit" || l.kind === "task_reward" ? "text-[var(--success)]" : "text-[var(--danger)]"}`}>
                      {l.kind === "deposit" || l.kind === "task_reward" ? "+" : "−"}
                      {formatUsd(Number(l.amount), 0)}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-[var(--muted)]">{t("empty")}</p>
            )}
          </div>
        </Reveal>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-2xl bg-[var(--bg-2)]/80 px-4 py-3 text-center">
      <p className="text-[11px] text-[var(--muted)]">{label}</p>
      <p className="font-display mt-1 text-lg font-semibold tabular">{value}</p>
    </div>
  );
}

function IconBtn({ children, onClick, title, danger }: { children: React.ReactNode; onClick: () => void; title: string; danger?: boolean }) {
  return (
    <button title={title} onClick={onClick} className={`grid h-7 w-7 place-items-center rounded-lg bg-[var(--surface-3)] text-[var(--muted)] transition-colors ${danger ? "hover:text-[var(--danger)]" : "hover:text-white"}`}>
      {children}
    </button>
  );
}
