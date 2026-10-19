"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Search } from "lucide-react";
import { useGame } from "@/components/game-context";
import { Button, PageTitle, Skeleton, formatCompact } from "@/components/ui";
import { adminSearchPlayers, type PlayerRow } from "@/lib/admin";
import { STATUS_STYLE } from "@/components/admin-shell";

const PAGE = 25;

export default function AdminPlayers() {
  const { t, toastError } = useGame();
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [rows, setRows] = useState<PlayerRow[] | null>(null);

  const load = useCallback(() => {
    setRows(null);
    adminSearchPlayers(query, PAGE, page * PAGE).then(setRows).catch((e) => {
      toastError(e);
      setRows([]);
    });
  }, [query, page, toastError]);
  useEffect(load, [load]);

  const total = rows?.[0]?.total ?? 0;

  return (
    <div>
      <PageTitle title={t("a_players")} />
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setPage(0);
          setQuery(q.trim());
        }}
        className="mb-4 flex gap-2"
      >
        <div className="flex flex-1 items-center gap-2 rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-4 focus-within:border-[var(--accent)]">
          <Search size={16} className="text-[var(--muted)]" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("a_search")} className="w-full bg-transparent py-3 text-sm outline-none" />
        </div>
        <Button>{t("a_search").split(":")[0]}</Button>
      </form>

      {rows === null ? (
        <Skeleton className="h-96" />
      ) : rows.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">{t("a_noData")}</p>
      ) : (
        <div className="panel overflow-x-auto">
          <table className="w-full min-w-[820px] text-sm">
            <thead>
              <tr className="border-b border-[var(--border)] text-left text-[11px] uppercase tracking-wider text-[var(--muted)]">
                <th className="px-4 py-3">ID</th>
                <th className="px-4 py-3">{t("gameNameLabel")}</th>
                <th className="px-4 py-3">{t("a_status")}</th>
                <th className="px-4 py-3 text-right">{t("wallet")}</th>
                <th className="px-4 py-3 text-right">{t("a_capital")}</th>
                <th className="px-4 py-3">{t("a_registered")}</th>
                <th className="px-4 py-3">{t("a_lastActivity")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {rows.map((p) => (
                <tr key={p.id} className="transition-colors hover:bg-white/[0.03]">
                  <td className="px-4 py-3 tabular text-[var(--muted)]">#{p.public_id}</td>
                  <td className="px-4 py-3">
                    <Link href={`/admin/players/${p.id}`} className="font-semibold hover:text-[var(--accent-2)]">
                      {p.game_name}
                    </Link>
                    <span className="ml-2 text-xs text-[var(--dim)]">@{p.login}</span>
                    {p.role && <span className="ml-2 rounded-full bg-[#7a1fff22] px-2 py-0.5 text-[10px] text-[#c4b5fd]">{t(`a_role_${p.role}`)}</span>}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS_STYLE[p.status]}`}>{t(`a_status_${p.status}`)}</span>
                  </td>
                  <td className="px-4 py-3 text-right tabular">${formatCompact(Number(p.cash))}</td>
                  <td className="px-4 py-3 text-right tabular font-semibold">${formatCompact(Number(p.capital))}</td>
                  <td className="px-4 py-3 text-xs text-[var(--muted)]">{new Date(p.created_at).toLocaleDateString()}</td>
                  <td className="px-4 py-3 text-xs text-[var(--muted)]">{p.last_activity ? new Date(p.last_activity).toLocaleString() : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="mt-4 flex items-center justify-between text-xs text-[var(--muted)]">
        <span>
          {t("a_shown")} {rows?.length ?? 0} {t("a_of")} {total}
        </span>
        <div className="flex gap-2">
          <Button variant="ghost" className="px-3 py-2 text-xs" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
            {t("a_prev")}
          </Button>
          <Button variant="ghost" className="px-3 py-2 text-xs" disabled={(page + 1) * PAGE >= total} onClick={() => setPage((p) => p + 1)}>
            {t("a_next")}
          </Button>
        </div>
      </div>
    </div>
  );
}
