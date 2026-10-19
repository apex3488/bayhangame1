"use client";

import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useGame } from "@/components/game-context";
import { ReadOnlyNote, useAdminRole } from "@/components/admin-shell";
import { Button, PageTitle, Skeleton, formatUsd } from "@/components/ui";
import { hasDecimals, parseAmount } from "@/lib/parse";
import { adminCreatePromo, adminListPromos, adminPromoRedemptions, adminSetPromoActive, can, type PromoRow } from "@/lib/admin";

const inputCls = "w-full rounded-xl border border-[var(--border)] bg-[var(--bg-2)] px-3 py-2.5 text-sm outline-none focus:border-[var(--accent)]";
const toIso = (local: string) => (local ? new Date(local).toISOString() : null);

export default function AdminPromos() {
  const { t, toast, toastError } = useGame();
  const role = useAdminRole();
  const editable = can.manage(role);
  const [rows, setRows] = useState<PromoRow[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [reds, setReds] = useState<{ game_name: string; created_at: string }[]>([]);
  const [form, setForm] = useState({ code: "", usd: "", btc: "", max: "100", starts: "", expires: "" });

  const load = useCallback(() => {
    adminListPromos().then(setRows).catch(toastError);
  }, [toastError]);
  useEffect(load, [load]);

  async function run(id: string, fn: () => Promise<unknown>, msg: string) {
    setBusy(id);
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
  }

  async function create(e: FormEvent) {
    e.preventDefault();
    // Explain what is wrong instead of silently disabling the button.
    const code = form.code.trim().toUpperCase();
    const usd = form.usd.trim() ? parseAmount(form.usd) : 0;
    const btc = form.btc.trim() ? parseAmount(form.btc) : 0;
    const max = parseAmount(form.max);
    if (!/^[A-Z0-9_]{3,32}$/.test(code)) return toast(t("err_invalid_code"), "error");
    if (usd === null || btc === null || usd < 0 || btc < 0 || !hasDecimals(usd, 2) || !hasDecimals(btc, 8) || (usd === 0 && btc === 0)) {
      return toast(`${t("err_invalid_value")}: ${t("a_rewardUsd")} / ${t("a_rewardBtc")}`, "error");
    }
    if (max === null || max < 1 || !Number.isInteger(max)) return toast(`${t("err_invalid_value")}: ${t("a_maxUses")}`, "error");
    if (form.expires && new Date(form.expires).getTime() <= (form.starts ? new Date(form.starts).getTime() : Date.now())) {
      return toast(`${t("err_invalid_value")}: ${t("a_expires")}`, "error");
    }
    const ok = await run("create", () => adminCreatePromo(code, usd, btc, max, toIso(form.starts), toIso(form.expires)), `${t("a_done")}: ${code}`);
    if (ok) setForm({ code: "", usd: "", btc: "", max: "100", starts: "", expires: "" });
  }

  async function toggleOpen(code: string) {
    if (open === code) return setOpen(null);
    setOpen(code);
    setReds(await adminPromoRedemptions(code).catch(() => []));
  }

  return (
    <div>
      <PageTitle title={t("a_promos")} />
      <ReadOnlyNote show={!editable} />
      {editable && (
        <form onSubmit={create} className="panel mb-5 space-y-3 p-5">
          <p className="text-sm font-semibold">{t("a_createPromo")}</p>
          <div className="grid gap-2 md:grid-cols-3 lg:grid-cols-6">
            <input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} maxLength={32} placeholder={t("a_code")} className={`${inputCls} font-mono`} />
            <input inputMode="decimal" value={form.usd} onChange={(e) => setForm({ ...form, usd: e.target.value })} placeholder={t("a_rewardUsd")} className={inputCls} />
            <input inputMode="decimal" value={form.btc} onChange={(e) => setForm({ ...form, btc: e.target.value })} placeholder={t("a_rewardBtc")} className={inputCls} />
            <input inputMode="numeric" value={form.max} onChange={(e) => setForm({ ...form, max: e.target.value })} placeholder={t("a_maxUses")} className={inputCls} />
            <input type="datetime-local" value={form.starts} onChange={(e) => setForm({ ...form, starts: e.target.value })} title={t("a_starts")} className={inputCls} />
            <input type="datetime-local" value={form.expires} onChange={(e) => setForm({ ...form, expires: e.target.value })} title={t("a_expires")} className={inputCls} />
          </div>
          <p className="text-[11px] text-[var(--muted)]">{t("a_starts")} / {t("a_expires")}</p>
          <Button disabled={busy !== null} loading={busy === "create"}>
            {t("a_createPromo")}
          </Button>
        </form>
      )}
      {!rows ? (
        <Skeleton className="h-64" />
      ) : (
        <div className="panel divide-y divide-[var(--border)]">
          {rows.map((p) => {
            const expired = p.expires_at && new Date(p.expires_at).getTime() < Date.now();
            const pct = Math.min(100, (p.used_count / p.max_uses) * 100);
            return (
              <div key={p.code} className="px-5 py-4">
                <div className="flex flex-wrap items-center gap-4">
                  <button onClick={() => toggleOpen(p.code)} className="font-mono text-base font-semibold hover:text-[var(--accent-2)]">{p.code}</button>
                  <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${expired ? "bg-white/5 text-[var(--muted)]" : p.active ? "bg-[var(--success-soft)] text-[var(--success)]" : "bg-[var(--danger-soft)] text-[var(--danger)]"}`}>
                    {expired ? t("a_expired") : p.active ? t("a_active") : t("a_inactive")}
                  </span>
                  <span className="text-sm tabular text-[var(--gold)]">
                    {Number(p.reward_usd) > 0 && formatUsd(Number(p.reward_usd), 0)} {Number(p.reward_btc) > 0 && `${Number(p.reward_btc)} ₿`}
                  </span>
                  <div className="min-w-[160px] flex-1">
                    <div className="flex justify-between text-[11px] text-[var(--muted)]">
                      <span>{t("a_uses")}</span>
                      <span className="tabular">{p.used_count}/{p.max_uses}</span>
                    </div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-[var(--surface-3)]">
                      <motion.div className="h-full rounded-full bg-[var(--accent)]" initial={{ width: 0 }} animate={{ width: `${pct}%` }} />
                    </div>
                  </div>
                  <span className="text-[11px] text-[var(--muted)]">
                    {new Date(p.starts_at).toLocaleDateString()} → {p.expires_at ? new Date(p.expires_at).toLocaleDateString() : "∞"} · {t("a_createdBy")}: {p.created_by ?? "—"}
                  </span>
                  {editable && (
                    <Button variant={p.active ? "outline" : "success"} className="px-3 py-1.5 text-xs" disabled={busy !== null} loading={busy === p.code}
                      onClick={() => run(p.code, () => adminSetPromoActive(p.code, !p.active), t("a_done"))}>
                      {p.active ? t("a_disable") : t("a_enable")}
                    </Button>
                  )}
                </div>
                <AnimatePresence>
                  {open === p.code && (
                    <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                      <p className="mt-3 text-xs font-semibold">{t("a_redemptions")}</p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {reds.length === 0 ? <span className="text-xs text-[var(--muted)]">{t("a_noData")}</span> : reds.map((r, i) => (
                          <span key={i} className="rounded-lg bg-[var(--bg-2)] px-2.5 py-1 text-xs">{r.game_name} · <span className="text-[var(--muted)]">{new Date(r.created_at).toLocaleString()}</span></span>
                        ))}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
