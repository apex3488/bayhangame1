"use client";

import { useCallback, useEffect, useState } from "react";
import { useAsk, useGame } from "@/components/game-context";
import { ReadOnlyNote, useAdminRole } from "@/components/admin-shell";
import { Tabs } from "@/components/forms";
import { Button, PageTitle, Skeleton } from "@/components/ui";
import {
  adminListGames,
  adminListJobs,
  adminListSettings,
  adminSetGame,
  adminSetJob,
  adminSetSetting,
  can,
  type GameRow,
  type JobRow,
} from "@/lib/admin";

const inputCls = "tabular w-full rounded-lg border border-[var(--border)] bg-[var(--bg-2)] px-2 py-1.5 text-sm outline-none focus:border-[var(--accent)] disabled:opacity-60";

export default function AdminEconomy() {
  const { t } = useGame();
  const role = useAdminRole();
  const [tab, setTab] = useState<"settings" | "games" | "jobs">("settings");
  const editable = can.manage(role);
  return (
    <div>
      <PageTitle title={t("a_economy")} />
      <ReadOnlyNote show={!editable} />
      <Tabs id="eco" value={tab} onChange={setTab} tabs={[{ id: "settings", label: t("a_settings") }, { id: "games", label: t("a_games") }, { id: "jobs", label: t("a_jobs") }]} />
      {tab === "settings" && <Settings editable={editable} />}
      {tab === "games" && <Games editable={editable} />}
      {tab === "jobs" && <Jobs editable={editable} />}
    </div>
  );
}

function useSaver() {
  const { t, toast, toastError } = useGame();
  const [busy, setBusy] = useState<string | null>(null);
  const save = async (id: string, fn: () => Promise<unknown>, after: () => void) => {
    setBusy(id);
    try {
      await fn();
      toast(t("a_saved"), "success");
      after();
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(null);
    }
  };
  return { busy, save };
}

function Settings({ editable }: { editable: boolean }) {
  const { t, toastError } = useGame();
  const ask = useAsk();
  const { busy, save } = useSaver();
  const [rows, setRows] = useState<{ key: string; value: number; description: string; updated_at: string }[] | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const load = useCallback(() => {
    adminListSettings().then((r) => {
      setRows(r);
      setDraft(Object.fromEntries(r.map((x) => [x.key, String(Number(x.value))])));
    }).catch(toastError);
  }, [toastError]);
  useEffect(load, [load]);
  if (!rows) return <Skeleton className="h-96" />;
  return (
    <div className="panel divide-y divide-[var(--border)]">
      {rows.map((r) => {
        const changed = draft[r.key] !== String(Number(r.value));
        return (
          <div key={r.key} className="grid items-center gap-3 px-5 py-3 md:grid-cols-[1fr_180px_auto]">
            <div>
              <p className="font-mono text-sm">{r.key}</p>
              <p className="text-xs text-[var(--muted)]">{r.description}</p>
            </div>
            <input type="number" step="any" disabled={!editable} value={draft[r.key] ?? ""} onChange={(e) => setDraft((d) => ({ ...d, [r.key]: e.target.value }))} className={inputCls} />
            <Button className="px-4 py-2 text-xs" disabled={!editable || !changed || busy !== null} loading={busy === r.key}
              onClick={async () =>
                (await ask(t("a_confirmSetting"), { message: `${r.key}: ${Number(r.value)} → ${draft[r.key]}` })) &&
                save(r.key, () => adminSetSetting(r.key, Number(draft[r.key])), load)
              }>
              {t("a_save")}
            </Button>
          </div>
        );
      })}
    </div>
  );
}

function Games({ editable }: { editable: boolean }) {
  const { t, toastError } = useGame();
  const { busy, save } = useSaver();
  const [rows, setRows] = useState<GameRow[] | null>(null);
  const load = useCallback(() => {
    adminListGames().then((r) => setRows(r.map((g) => ({ ...g, min_bet: Number(g.min_bet), max_bet: Number(g.max_bet) })))).catch(toastError);
  }, [toastError]);
  useEffect(load, [load]);
  if (!rows) return <Skeleton className="h-96" />;
  const update = (i: number, patch: Partial<GameRow>) => setRows((rs) => rs!.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return (
    <div className="panel overflow-x-auto">
      <table className="w-full min-w-[640px] text-sm">
        <thead>
          <tr className="border-b border-[var(--border)] text-left text-[11px] uppercase tracking-wider text-[var(--muted)]">
            <th className="px-5 py-3">{t("games")}</th>
            <th className="px-3 py-3">{t("a_status")}</th>
            <th className="px-3 py-3">{t("a_minBet")}</th>
            <th className="px-3 py-3">{t("a_maxBet")}</th>
            <th className="px-5 py-3" />
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--border)]">
          {rows.map((g, i) => (
            <tr key={g.game}>
              <td className="px-5 py-2.5 font-medium">{t(`game_${g.game}`)}</td>
              <td className="px-3 py-2.5">
                <button disabled={!editable} onClick={() => update(i, { enabled: !g.enabled })}
                  className={`rounded-full px-3 py-1 text-xs font-semibold ${g.enabled ? "bg-[var(--success-soft)] text-[var(--success)]" : "bg-[var(--danger-soft)] text-[var(--danger)]"}`}>
                  {g.enabled ? t("a_enabled") : t("a_disabled")}
                </button>
              </td>
              <td className="px-3 py-2.5"><input type="number" disabled={!editable} value={g.min_bet} onChange={(e) => update(i, { min_bet: Number(e.target.value) })} className={inputCls} /></td>
              <td className="px-3 py-2.5"><input type="number" disabled={!editable} value={g.max_bet} onChange={(e) => update(i, { max_bet: Number(e.target.value) })} className={inputCls} /></td>
              <td className="px-5 py-2.5 text-right">
                <Button className="px-4 py-2 text-xs" disabled={!editable || busy !== null} loading={busy === g.game}
                  onClick={() => save(g.game, () => adminSetGame(g.game, g.enabled, g.min_bet, g.max_bet), load)}>
                  {t("a_save")}
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Jobs({ editable }: { editable: boolean }) {
  const { t, toastError } = useGame();
  const { busy, save } = useSaver();
  const [rows, setRows] = useState<JobRow[] | null>(null);
  const load = useCallback(() => {
    adminListJobs()
      .then((r) => setRows(r.map((j) => ({ ...j, income_min: Number(j.income_min), income_max: Number(j.income_max), min_capital: Number(j.min_capital) }))))
      .catch(toastError);
  }, [toastError]);
  useEffect(load, [load]);
  if (!rows) return <Skeleton className="h-96" />;
  const update = (i: number, patch: Partial<JobRow>) => setRows((rs) => rs!.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const num = (i: number, field: keyof JobRow) => (
    <input type="number" disabled={!editable} value={rows[i][field] as number} onChange={(e) => update(i, { [field]: Number(e.target.value) } as Partial<JobRow>)} className={inputCls} />
  );
  return (
    <div className="panel overflow-x-auto">
      <table className="w-full min-w-[900px] text-sm">
        <thead>
          <tr className="border-b border-[var(--border)] text-left text-[11px] uppercase tracking-wider text-[var(--muted)]">
            <th className="px-5 py-3">{t("jobs")}</th>
            <th className="px-2 py-3">{t("a_status")}</th>
            <th className="px-2 py-3">{t("a_incomeMin")}</th>
            <th className="px-2 py-3">{t("a_incomeMax")}</th>
            <th className="px-2 py-3">{t("a_cooldownSec")}</th>
            <th className="px-2 py-3">{t("a_minCapital")}</th>
            <th className="px-2 py-3">{t("a_xp")}</th>
            <th className="px-5 py-3" />
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--border)]">
          {rows.map((j, i) => (
            <tr key={j.key} className={j.is_active ? "" : "opacity-60"}>
              <td className="px-5 py-2.5 font-medium">{t(`job_${j.key}`) !== `job_${j.key}` ? t(`job_${j.key}`) : j.key}{j.require_car ? " 🚗" : ""}</td>
              <td className="px-2 py-2.5">
                <button disabled={!editable} onClick={() => update(i, { is_active: !j.is_active })}
                  className={`rounded-full px-3 py-1 text-xs font-semibold ${j.is_active ? "bg-[var(--success-soft)] text-[var(--success)]" : "bg-[var(--danger-soft)] text-[var(--danger)]"}`}>
                  {j.is_active ? t("a_enabled") : t("a_disabled")}
                </button>
              </td>
              <td className="px-2 py-2.5">{num(i, "income_min")}</td>
              <td className="px-2 py-2.5">{num(i, "income_max")}</td>
              <td className="px-2 py-2.5">{num(i, "cooldown_seconds")}</td>
              <td className="px-2 py-2.5">{num(i, "min_capital")}</td>
              <td className="px-2 py-2.5">{num(i, "xp_reward")}</td>
              <td className="px-5 py-2.5 text-right">
                <Button className="px-4 py-2 text-xs" disabled={!editable || busy !== null} loading={busy === j.key} onClick={() => save(j.key, () => adminSetJob(j), load)}>
                  {t("a_save")}
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
