"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useGame } from "@/components/game-context";
import { Tabs } from "@/components/forms";
import { Button, PageTitle, Skeleton, formatUsd } from "@/components/ui";
import { adminAudit, adminLargeTransfers, type AuditRow } from "@/lib/admin";

const PAGE = 50;
const ACTIONS = [
  "admin_login", "balance_adjust", "status_change", "role_change", "economy_setting_change", "game_settings_change", "job_change",
  "promo_create", "promo_enable", "promo_disable", "event_create", "event_enable", "event_disable", "vip_grant", "vip_revoke",
];
const ACTION_COLOR: Record<string, string> = {
  balance_adjust: "#ffc94d",
  status_change: "#ff4d61",
  role_change: "#a855f7",
  admin_login: "#64748b",
};

export default function AdminAuditPage() {
  const { t } = useGame();
  const [tab, setTab] = useState<"audit" | "transfers">("audit");
  return (
    <div>
      <PageTitle title={t("a_auditLog")} />
      <Tabs id="audit" value={tab} onChange={setTab} tabs={[{ id: "audit", label: t("a_auditLog") }, { id: "transfers", label: t("a_largeTransfers") }]} />
      {tab === "audit" ? <AuditList /> : <Transfers />}
    </div>
  );
}

function AuditList() {
  const { t, toastError } = useGame();
  const [action, setAction] = useState("");
  const [page, setPage] = useState(0);
  const [rows, setRows] = useState<AuditRow[] | null>(null);

  const load = useCallback(() => {
    setRows(null);
    adminAudit(action || null, PAGE, page * PAGE).then(setRows).catch((e) => {
      toastError(e);
      setRows([]);
    });
  }, [action, page, toastError]);
  useEffect(load, [load]);

  const total = rows?.[0]?.total ?? 0;
  return (
    <div>
      <select value={action} onChange={(e) => { setPage(0); setAction(e.target.value); }}
        className="mb-4 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-sm">
        <option value="">{t("a_allActions")}</option>
        {ACTIONS.map((a) => <option key={a} value={a}>{a}</option>)}
      </select>
      {rows === null ? (
        <Skeleton className="h-96" />
      ) : rows.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">{t("a_noData")}</p>
      ) : (
        <div className="panel overflow-x-auto">
          <table className="w-full min-w-[860px] text-xs">
            <thead>
              <tr className="border-b border-[var(--border)] text-left text-[11px] uppercase tracking-wider text-[var(--muted)]">
                <th className="px-4 py-3">{t("a_when")}</th>
                <th className="px-3 py-3">{t("a_actor")}</th>
                <th className="px-3 py-3">Action</th>
                <th className="px-3 py-3">{t("a_target")}</th>
                <th className="px-4 py-3">{t("a_details")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {rows.map((r) => (
                <tr key={r.id} className="align-top">
                  <td className="whitespace-nowrap px-4 py-2.5 text-[var(--muted)]">{new Date(r.created_at).toLocaleString()}</td>
                  <td className="px-3 py-2.5 font-medium">{r.actor ?? "—"}</td>
                  <td className="px-3 py-2.5">
                    <span className="rounded-md px-2 py-0.5 font-mono" style={{ background: `${ACTION_COLOR[r.action] ?? "#2f7bff"}22`, color: ACTION_COLOR[r.action] ?? "#5aa2ff" }}>{r.action}</span>
                  </td>
                  <td className="px-3 py-2.5">
                    {r.target_type === "profile" && r.target_id ? (
                      <Link href={`/admin/players/${r.target_id}`} className="hover:text-[var(--accent-2)]">{r.target_name ?? r.target_id.slice(0, 8)}</Link>
                    ) : r.target_type === "admin" ? (
                      <span className="text-[var(--dim)]">—</span>
                    ) : (
                      <span className="font-mono text-[var(--muted)]">{r.target_type}:{r.target_id}</span>
                    )}
                  </td>
                  <td className="max-w-[420px] break-all px-4 py-2.5 font-mono text-[10px] text-[var(--dim)]">{JSON.stringify(r.payload)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="mt-4 flex items-center justify-between text-xs text-[var(--muted)]">
        <span>{t("a_shown")} {rows?.length ?? 0} {t("a_of")} {total}</span>
        <div className="flex gap-2">
          <Button variant="ghost" className="px-3 py-2 text-xs" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>{t("a_prev")}</Button>
          <Button variant="ghost" className="px-3 py-2 text-xs" disabled={(page + 1) * PAGE >= total} onClick={() => setPage((p) => p + 1)}>{t("a_next")}</Button>
        </div>
      </div>
    </div>
  );
}

function Transfers() {
  const { t, toastError } = useGame();
  const [min, setMin] = useState(50000);
  const [rows, setRows] = useState<Awaited<ReturnType<typeof adminLargeTransfers>> | null>(null);
  const load = useCallback(() => {
    adminLargeTransfers(min).then(setRows).catch(toastError);
  }, [min, toastError]);
  useEffect(load, [load]);
  return (
    <div>
      <label className="mb-4 flex items-center gap-2 text-sm text-[var(--muted)]">
        {t("a_minAmount")}
        <input type="number" value={min} onChange={(e) => setMin(Number(e.target.value))} className="tabular w-40 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-white" />
      </label>
      {!rows ? (
        <Skeleton className="h-64" />
      ) : rows.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">{t("a_noData")}</p>
      ) : (
        <div className="panel divide-y divide-[var(--border)] text-sm">
          {rows.map((r) => (
            <div key={r.group_id} className="flex flex-wrap items-center gap-4 px-5 py-3">
              <span className="text-xs text-[var(--muted)]">{new Date(r.created_at).toLocaleString()}</span>
              <span className="font-medium">{r.sender ?? "—"}</span>
              <span className="text-[var(--muted)]">→</span>
              <span className="font-medium">{r.receiver}</span>
              <span className="ml-auto tabular font-semibold text-[var(--gold)]">{formatUsd(Number(r.amount), 0)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
