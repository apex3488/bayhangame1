"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useGame } from "@/components/game-context";
import { ReadOnlyNote, useAdminRole } from "@/components/admin-shell";
import { Button, PageTitle, Skeleton } from "@/components/ui";
import { parseAmount } from "@/lib/parse";
import { adminCreateEvent, adminListEvents, adminSetEventActive, can, type EventRow } from "@/lib/admin";

const inputCls = "w-full rounded-xl border border-[var(--border)] bg-[var(--bg-2)] px-3 py-2.5 text-sm outline-none focus:border-[var(--accent)]";

export default function AdminEvents() {
  const { t, toast, toastError } = useGame();
  const role = useAdminRole();
  const editable = can.manage(role);
  const [rows, setRows] = useState<EventRow[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const empty = { code: "", title: "", description: "", type: "daily" as "daily" | "mining", mult: "2", starts: "", ends: "" };
  const [f, setF] = useState(empty);

  const load = useCallback(() => {
    adminListEvents().then(setRows).catch(toastError);
  }, [toastError]);
  useEffect(load, [load]);

  async function run(id: string, fn: () => Promise<unknown>) {
    setBusy(id);
    try {
      await fn();
      toast(t("a_done"), "success");
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
    const mult = parseAmount(f.mult);
    if (!/^[a-z0-9_]{2,40}$/.test(f.code)) return toast(t("err_invalid_code"), "error");
    if (f.title.trim().length < 2) return toast(`${t("err_invalid_value")}: ${t("a_eventTitle")}`, "error");
    if (mult === null || mult <= 0 || mult > 10) return toast(`${t("err_invalid_value")}: ${t("a_multiplier")} (0–10)`, "error");
    if (!f.starts || !f.ends || new Date(f.ends) <= new Date(f.starts)) return toast(`${t("err_invalid_value")}: ${t("a_starts")} / ${t("a_ends")}`, "error");
    const ok = await run("create", () =>
      adminCreateEvent({
        code: f.code,
        title: f.title,
        description: f.description,
        event_type: f.type,
        multiplier: mult,
        starts_at: new Date(f.starts).toISOString(),
        ends_at: new Date(f.ends).toISOString(),
      }),
    );
    if (ok) setF(empty);
  }

  const phase = (e: EventRow) => {
    const now = Date.now();
    if (now < new Date(e.starts_at).getTime()) return "a_scheduled";
    if (now > new Date(e.ends_at).getTime()) return "a_finished";
    return "a_running";
  };

  return (
    <div>
      <PageTitle title={t("a_events")} />
      <ReadOnlyNote show={!editable} />
      {editable && (
        <form onSubmit={create} className="panel mb-5 space-y-3 p-5">
          <p className="text-sm font-semibold">{t("a_createEvent")}</p>
          <div className="grid gap-2 md:grid-cols-4">
            <input value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.toLowerCase() })} maxLength={40} placeholder={`${t("a_code")} (weekend_x2)`} className={`${inputCls} font-mono`} />
            <input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} maxLength={80} placeholder={t("a_eventTitle")} className={inputCls} />
            <select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value as "daily" | "mining" })} className={inputCls}>
              <option value="daily">{t("ev_daily")}</option>
              <option value="mining">{t("ev_mining")}</option>
            </select>
            <input inputMode="decimal" value={f.mult} onChange={(e) => setF({ ...f, mult: e.target.value })} placeholder={t("a_multiplier")} className={inputCls} />
            <input value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} maxLength={300} placeholder={t("a_description")} className={`${inputCls} md:col-span-2`} />
            <input type="datetime-local" value={f.starts} onChange={(e) => setF({ ...f, starts: e.target.value })} title={t("a_starts")} className={inputCls} />
            <input type="datetime-local" value={f.ends} onChange={(e) => setF({ ...f, ends: e.target.value })} title={t("a_ends")} className={inputCls} />
          </div>
          <Button disabled={busy !== null} loading={busy === "create"}>
            {t("a_createEvent")}
          </Button>
        </form>
      )}
      {!rows ? (
        <Skeleton className="h-64" />
      ) : rows.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">{t("a_noData")}</p>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {rows.map((e) => {
            const ph = phase(e);
            return (
              <div key={e.code} className={`panel p-5 ${!e.active ? "opacity-60" : ""}`}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-display text-lg font-semibold">{e.title}</p>
                    <p className="font-mono text-xs text-[var(--dim)]">{e.code}</p>
                  </div>
                  <span className="font-display text-2xl font-bold text-[var(--gold)]">×{Number(e.multiplier)}</span>
                </div>
                {e.description && <p className="mt-2 text-sm text-[var(--muted)]">{e.description}</p>}
                <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                  <span className="rounded-full bg-[var(--accent-soft)] px-2.5 py-0.5 text-[var(--accent-2)]">{t(`ev_${e.event_type}`)}</span>
                  <span className={`rounded-full px-2.5 py-0.5 ${ph === "a_running" ? "bg-[var(--success-soft)] text-[var(--success)]" : "bg-white/5 text-[var(--muted)]"}`}>{t(ph)}</span>
                  <span className="text-[var(--muted)]">{new Date(e.starts_at).toLocaleString()} → {new Date(e.ends_at).toLocaleString()}</span>
                </div>
                {editable && (
                  <Button variant={e.active ? "outline" : "success"} className="mt-4 px-3 py-1.5 text-xs" disabled={busy !== null} loading={busy === e.code}
                    onClick={() => run(e.code, () => adminSetEventActive(e.code, !e.active))}>
                    {e.active ? t("a_disable") : t("a_enable")}
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
