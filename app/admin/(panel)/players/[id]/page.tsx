"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Crown } from "lucide-react";
import { useAsk, useGame } from "@/components/game-context";
import { STATUS_STYLE, useAdminRole } from "@/components/admin-shell";
import { Button, Money, Reveal, Skeleton, formatUsd } from "@/components/ui";
import {
  adminAdjustBalance,
  adminGrantVip,
  adminPlayer,
  adminRevokeVip,
  adminSetRole,
  adminSetStatus,
  can,
  type PlayerDetail,
} from "@/lib/admin";
import { newIdempotencyKey } from "@/lib/game";
import { hasDecimals, parseAmount } from "@/lib/parse";
import { ProfileHero } from "@/components/profile-hero";
import { adminClearMedia, fetchPublicProfile, type PublicProfile } from "@/lib/profile";
import type { Loadout } from "@/lib/economy";


export default function AdminPlayerPage() {
  const { id } = useParams<{ id: string }>();
  const role = useAdminRole();
  const { t, toast, toastError } = useGame();
  const ask = useAsk();
  const [p, setP] = useState<PlayerDetail | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [look, setLook] = useState<PublicProfile | null>(null);

  const load = useCallback(() => {
    adminPlayer(id)
      .then((d) => {
        setP(d);
        return fetchPublicProfile(d.profile.game_name).then(setLook);
      })
      .catch(toastError);
  }, [id, toastError]);
  useEffect(load, [load]);

  const act = async (name: string, fn: () => Promise<unknown>, msg = t("a_done")) => {
    setBusy(name);
    try {
      await fn();
      toast(msg, "success");
      load();
      return true;
    } catch (e) {
      toastError(e);
      return false;
    } finally {
      setBusy(null);
    }
  };

  if (!p) return <Skeleton className="h-96" />;
  const pr = p.profile;

  return (
    <div className="space-y-5">
      <Link href="/admin/players" className="inline-flex items-center gap-1.5 text-xs text-[var(--muted)] hover:text-white">
        <ArrowLeft size={14} /> {t("a_players")}
      </Link>

      <Reveal>
        <div className="panel flex flex-wrap items-center justify-between gap-5 p-6">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-display text-2xl font-semibold">{pr.game_name}</h1>
              <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${STATUS_STYLE[pr.status]}`}>{t(`a_status_${pr.status}`)}</span>
              {p.role && <span className="rounded-full bg-[#7a1fff22] px-2.5 py-0.5 text-[11px] text-[#c4b5fd]">{t(`a_role_${p.role}`)}</span>}
              {p.vip?.active && (
                <span className="flex items-center gap-1 rounded-full bg-[#ffc94d22] px-2.5 py-0.5 text-[11px] font-semibold text-[var(--gold)]">
                  <Crown size={11} /> VIP {p.vip.level}
                </span>
              )}
            </div>
            <p className="mt-1 text-xs text-[var(--muted)]">
              #{pr.public_id} · @{pr.login} · {t("a_registered")} {new Date(pr.created_at).toLocaleString()} · {t("level")} {pr.level} ({pr.xp} XP)
              {pr.referrer ? ` · ${t("a_referrer")}: ${pr.referrer}` : ""}
              {p.corporation ? ` · ${t("a_corporation")}: ${p.corporation.name} (${t(`role_${p.corporation.role}`)})` : ""}
            </p>
            <p className="mt-1 font-mono text-[10px] text-[var(--dim)]">{pr.id}</p>
          </div>
          <div className="text-right">
            <p className="text-[11px] uppercase tracking-widest text-[var(--muted)]">{t("a_capital")}</p>
            <Money value={Number(p.capital)} className="font-display text-2xl font-semibold" />
          </div>
        </div>
      </Reveal>

      <div className="grid gap-5 lg:grid-cols-3">
        <Reveal>
          <div className="panel space-y-2 p-5 text-sm">
            <p className="mb-2 font-semibold">{t("a_balance")}</p>
            <Line label={t("wallet")} value={formatUsd(Number(p.wallet.cash))} />
            <Line label={t("bank")} value={formatUsd(Number(p.wallet.bank))} />
            <Line label="BTC" value={`${Number(p.wallet.btc).toFixed(8)} ₿`} />
            <Line label={t("deposits")} value={formatUsd(Number(p.assets.deposits))} />
            <Line label={t("realty")} value={formatUsd(Number(p.assets.realty))} />
            <Line label={t("cars")} value={formatUsd(Number(p.assets.cars))} />
            <Line label={t("business")} value={formatUsd(Number(p.assets.business))} />
          </div>
        </Reveal>
        <Reveal delay={0.04}>
          <div className="panel space-y-2 p-5 text-sm">
            <p className="mb-2 font-semibold">{t("a_stats")}</p>
            <Line label={t("gamesPlayed")} value={String(p.stats.games_played)} />
            <Line label={t("winRate")} value={String(p.stats.games_won)} />
            <Line label={t("totalWagered")} value={formatUsd(Number(p.stats.total_wagered), 0)} />
            <Line label={t("totalWon")} value={formatUsd(Number(p.stats.total_won), 0)} />
            <Line label={t("shiftsDone")} value={String(p.stats.shifts)} />
            <Line label={t("myItems")} value={String(p.stats.cosmetics)} />
            <Line label={t("dailyStreak")} value={String(pr.daily_streak)} />
          </div>
        </Reveal>
        <Reveal delay={0.08}>
          <div className="panel space-y-2 p-5 text-sm">
            <p className="mb-2 font-semibold">{t("a_assets")}</p>
            {[...p.owned.realty.map((x) => `${t(`realty_${x.code}`)} · ${t("a_level")} ${x.level}`),
              ...p.owned.business.map((x) => `${t(`business_${x.code}`)} · ${t("a_level")} ${x.level} · 👥${x.employees}`),
              ...p.owned.cars.map((x) => `${t(`car_${x.code}`)} · ${t("a_level")} ${x.level}`)].map((s) => (
              <p key={s} className="rounded-xl bg-[var(--bg-2)] px-3 py-2 text-xs">{s}</p>
            ))}
            {p.owned.realty.length + p.owned.business.length + p.owned.cars.length === 0 && <p className="text-xs text-[var(--muted)]">{t("a_noData")}</p>}
          </div>
        </Reveal>
      </div>

      {look && (
        <Reveal>
          <div>
            <p className="mb-2 text-sm font-semibold">{t("a_appearance")}</p>
            <ProfileHero data={look} loadout={look.loadout as Loadout} vipLevel={look.vip}>
              {can.moderate(role) && (
                <div className="mt-4 flex flex-wrap gap-2">
                  {([
                    ["avatar", "a_clearAvatar", !!look.avatar_version],
                    ["background", "a_clearBg", !!look.background_version || look.background !== "default"],
                    ["bio", "a_clearBio", !!look.bio],
                  ] as const).map(([what, label, has]) => (
                    <Button key={what} variant="outline" className="py-2 text-xs" disabled={busy !== null || !has} loading={busy === `clear-${what}`}
                      onClick={async () => {
                        const reason = await ask(`${t(label)}: ${pr.game_name}`, { danger: true, input: { placeholder: t("a_reason"), minLength: 5 } });
                        if (typeof reason === "string") act(`clear-${what}`, () => adminClearMedia(pr.id, what, reason));
                      }}>
                      {t(label)}
                    </Button>
                  ))}
                </div>
              )}
            </ProfileHero>
          </div>
        </Reveal>
      )}

      {can.manage(role) && <BalanceForm busy={busy === "adj"} onSubmit={(acc, amt, reason) => act("adj", () => adminAdjustBalance(pr.id, acc, amt, reason, newIdempotencyKey()))} />}

      <div className="grid gap-5 lg:grid-cols-3">
        {can.moderate(role) && (
          <ActionCard title={t("a_changeStatus")}>
            <StatusForm current={pr.status} busy={busy === "status"} onSubmit={(s, r) => act("status", () => adminSetStatus(pr.id, s, r))} />
          </ActionCard>
        )}
        {can.manage(role) && (
          <ActionCard title={p.vip?.active ? `${t("a_revokeVip")} / ${t("a_grantVip")}` : t("a_grantVip")}>
            <VipForm hasVip={!!p.vip} busy={busy === "vip"}
              onGrant={(l, d, r) => act("vip", () => adminGrantVip(pr.id, l, d, r))}
              onRevoke={(r) => act("vip", () => adminRevokeVip(pr.id, r))} />
          </ActionCard>
        )}
        {can.roles(role) && (
          <ActionCard title={t("a_setRole")}>
            <div className="grid grid-cols-2 gap-2">
              {(["admin", "moderator", "operator"] as const).map((r) => (
                <Button key={r} variant={p.role === r ? "success" : "ghost"} className="py-2 text-xs" disabled={busy !== null || p.role === r}
                  onClick={async () => (await ask(`${t("a_setRole")}: ${t(`a_role_${r}`)}?`, { message: pr.game_name })) && act("role", () => adminSetRole(pr.id, r))}>
                  {t(`a_role_${r}`)}
                </Button>
              ))}
              <Button variant="outline" className="py-2 text-xs" disabled={busy !== null || !p.role || p.role === "owner"}
                onClick={async () => (await ask(`${t("a_removeRole")}?`, { danger: true, message: pr.game_name })) && act("role", () => adminSetRole(pr.id, null))}>
                {t("a_removeRole")}
              </Button>
            </div>
          </ActionCard>
        )}
      </div>

      <Reveal>
        <div className="panel overflow-x-auto">
          <p className="px-5 pt-5 text-sm font-semibold">{t("a_ledger")}</p>
          <table className="mt-3 w-full min-w-[760px] text-xs">
            <tbody className="divide-y divide-[var(--border)]">
              {p.ledger.map((l) => (
                <tr key={l.id}>
                  <td className="px-5 py-2 text-[var(--muted)]">{new Date(l.created_at).toLocaleString()}</td>
                  <td className="px-3 py-2 font-mono text-[var(--dim)]">{l.op_type}</td>
                  <td className="px-3 py-2">{l.reason}</td>
                  <td className="px-3 py-2 text-[var(--muted)]">{t(`acc_${l.account}`)}</td>
                  <td className={`px-3 py-2 text-right tabular font-semibold ${l.direction === "credit" ? "text-[var(--success)]" : "text-[var(--danger)]"}`}>
                    {l.direction === "credit" ? "+" : "−"}
                    {l.account === "btc" ? Number(l.amount).toFixed(8) : formatUsd(Number(l.amount))}
                  </td>
                  <td className="px-5 py-2 text-right tabular text-[var(--muted)]">
                    {l.account === "btc" ? Number(l.balance_before).toFixed(8) : formatUsd(Number(l.balance_before))} → {l.account === "btc" ? Number(l.balance_after).toFixed(8) : formatUsd(Number(l.balance_after))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Reveal>

      <div className="grid gap-5 lg:grid-cols-2">
        <Reveal>
          <div className="panel p-5">
            <p className="mb-3 text-sm font-semibold">{t("a_rounds")}</p>
            {p.rounds.length === 0 ? <p className="text-xs text-[var(--muted)]">{t("a_noData")}</p> : (
              <ul className="space-y-1 text-xs">
                {p.rounds.map((r, i) => (
                  <li key={i} className="flex justify-between rounded-lg bg-[var(--bg-2)] px-3 py-2">
                    <span>{t(`game_${r.game}`)}</span>
                    <span className="tabular text-[var(--muted)]">{formatUsd(Number(r.bet), 0)} → ×{Number(r.multiplier)}</span>
                    <span className={`tabular ${Number(r.payout) > Number(r.bet) ? "text-[var(--success)]" : "text-[var(--danger)]"}`}>{formatUsd(Number(r.payout), 0)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Reveal>
        <Reveal delay={0.04}>
          <div className="panel p-5">
            <p className="mb-3 text-sm font-semibold">{t("a_history")}</p>
            {p.audit.length === 0 ? <p className="text-xs text-[var(--muted)]">{t("a_noData")}</p> : (
              <ul className="space-y-1 text-xs">
                {p.audit.map((a, i) => (
                  <li key={i} className="rounded-lg bg-[var(--bg-2)] px-3 py-2">
                    <span className="font-mono text-[var(--accent-2)]">{a.action}</span> · {a.actor ?? "—"} · <span className="text-[var(--muted)]">{new Date(a.created_at).toLocaleString()}</span>
                    <p className="mt-1 break-all font-mono text-[10px] text-[var(--dim)]">{JSON.stringify(a.payload)}</p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Reveal>
      </div>
    </div>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-[var(--muted)]">{label}</span>
      <span className="tabular font-semibold">{value}</span>
    </div>
  );
}

function ActionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Reveal>
      <div className="panel h-full p-5">
        <p className="mb-3 text-sm font-semibold">{title}</p>
        {children}
      </div>
    </Reveal>
  );
}

const inputCls = "w-full rounded-xl border border-[var(--border)] bg-[var(--bg-2)] px-3 py-2.5 text-sm outline-none focus:border-[var(--accent)]";

function BalanceForm({ busy, onSubmit }: { busy: boolean; onSubmit: (account: string, amount: number, reason: string) => Promise<boolean> }) {
  const { t, toast } = useGame();
  const ask = useAsk();
  const [account, setAccount] = useState("cash");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const parsed = parseAmount(amount);
  const value = parsed ?? 0;
  return (
    <Reveal>
      <form
        className="panel space-y-3 border-[#ff4d61]/30 p-5"
        onSubmit={async (e) => {
          e.preventDefault();
          // Say what is wrong instead of a silently disabled button.
          if (parsed === null || parsed === 0 || !hasDecimals(parsed, account === "btc" ? 8 : 2)) {
            return toast(`${t("err_invalid_amount")} (${account === "btc" ? "0.00000001" : "0.01"})`, "error");
          }
          if (reason.trim().length < 5) return toast(t("err_reason_required"), "error");
          const label = account === "btc" ? `${value} ₿` : formatUsd(value);
          const ok = await ask(t("a_confirmAdjust"), {
            danger: value < 0,
            message: `${value > 0 ? "+" : ""}${label} · ${t(`acc_${account}`)}\n${reason}`,
          });
          if (!ok) return;
          if (await onSubmit(account, value, reason.trim())) {
            setAmount("");
            setReason("");
          }
        }}
      >
        <p className="text-sm font-semibold">{t("a_adjustBalance")}</p>
        <p className="text-xs text-[var(--muted)]">{t("a_adjustHint")}</p>
        <div className="grid gap-2 md:grid-cols-[140px_180px_1fr_auto]">
          <select value={account} onChange={(e) => setAccount(e.target.value)} className={inputCls}>
            <option value="cash">{t("acc_cash")}</option>
            <option value="bank">{t("acc_bank")}</option>
            <option value="btc">{t("acc_btc")}</option>
          </select>
          <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={`${t("a_amount")}: 10 000 / -500`} className={`${inputCls} tabular`} />
          <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} placeholder={t("a_reason")} className={inputCls} />
          <Button disabled={busy} loading={busy} variant={value < 0 ? "danger" : "primary"}>
            {t("a_apply")}
          </Button>
        </div>
        {amount.trim() !== "" && (
          <p className={`text-xs ${parsed === null ? "text-[var(--danger)]" : "text-[var(--muted)]"}`}>
            {parsed === null ? t("err_invalid_amount") : `${parsed > 0 ? "+" : ""}${account === "btc" ? `${parsed} ₿` : formatUsd(parsed)}`}
            {reason.trim().length > 0 && reason.trim().length < 5 ? ` · ${t("err_reason_required")}` : ""}
          </p>
        )}
      </form>
    </Reveal>
  );
}

function StatusForm({ current, busy, onSubmit }: { current: string; busy: boolean; onSubmit: (s: string, reason: string) => Promise<boolean> }) {
  const { t, toast } = useGame();
  const [status, setStatus] = useState(current === "active" ? "blocked" : "active");
  const [reason, setReason] = useState("");
  return (
    <form
      className="space-y-2"
      onSubmit={async (e) => {
        e.preventDefault();
        if (reason.trim().length < 5) return toast(t("err_reason_required"), "error");
        if (await onSubmit(status, reason.trim())) setReason("");
      }}
    >
      <select value={status} onChange={(e) => setStatus(e.target.value)} className={inputCls}>
        {["active", "restricted", "blocked"].map((s) => (
          <option key={s} value={s}>{t(`a_status_${s}`)}</option>
        ))}
      </select>
      <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} placeholder={t("a_reason")} className={inputCls} />
      <Button className="w-full py-2.5" disabled={busy || status === current} loading={busy} variant={status === "active" ? "success" : "danger"}>
        {t("a_apply")}
      </Button>
    </form>
  );
}

function VipForm({ hasVip, busy, onGrant, onRevoke }: { hasVip: boolean; busy: boolean; onGrant: (l: number, d: number, r: string) => Promise<boolean>; onRevoke: (r: string) => Promise<boolean> }) {
  const { t } = useGame();
  const [level, setLevel] = useState(1);
  const [days, setDays] = useState(14);
  const [reason, setReason] = useState("");
  const { toast } = useGame();
  const ok = () => reason.trim().length >= 5 || (toast(t("err_reason_required"), "error"), false);
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <select value={level} onChange={(e) => setLevel(Number(e.target.value))} className={inputCls}>
          {[1, 2, 3, 4].map((l) => <option key={l} value={l}>VIP {l}</option>)}
        </select>
        <input type="number" min={1} max={365} value={days} onChange={(e) => setDays(Number(e.target.value))} className={inputCls} placeholder={t("a_days")} />
      </div>
      <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} placeholder={t("a_reason")} className={inputCls} />
      <div className="grid grid-cols-2 gap-2">
        <Button className="py-2.5 text-xs" disabled={busy} loading={busy} onClick={async () => { if (ok() && (await onGrant(level, days, reason.trim()))) setReason(""); }}>
          {t("a_grantVip")}
        </Button>
        <Button variant="outline" className="py-2.5 text-xs" disabled={busy || !hasVip} onClick={async () => { if (ok() && (await onRevoke(reason.trim()))) setReason(""); }}>
          {t("a_revokeVip")}
        </Button>
      </div>
    </div>
  );
}
