"use client";

import { motion } from "motion/react";
import { useCallback, useEffect, useState } from "react";
import { ArrowDownLeft, ArrowUpRight } from "lucide-react";
import { useGame } from "@/components/game-context";
import { Button, PageTitle, Skeleton, formatUsd } from "@/components/ui";
import { fetchLedgerPage } from "@/lib/economy";
import type { LedgerRow } from "@/lib/game";

const SIZE = 25;

function amountText(r: LedgerRow) {
  return r.account === "btc" ? `${Number(r.amount).toFixed(8)} ₿` : formatUsd(Number(r.amount));
}

export default function HistoryPage() {
  const { t } = useGame();
  const [rows, setRows] = useState<LedgerRow[] | null>(null);
  const [page, setPage] = useState(0);
  const [more, setMore] = useState(true);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (p: number) => {
    setLoading(true);
    try {
      const data = await fetchLedgerPage(p, SIZE);
      setRows((prev) => (p === 0 ? data : [...(prev ?? []), ...data]));
      setMore(data.length === SIZE);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    load(0).catch(() => setRows([]));
  }, [load]);

  return (
    <div>
      <PageTitle title={t("history")} subtitle={t("historySubtitle")} />
      {rows === null ? (
        <Skeleton className="h-96" />
      ) : rows.length === 0 ? (
        <p className="text-[var(--muted)]">{t("empty")}</p>
      ) : (
        <div className="panel overflow-hidden">
          <ul className="divide-y divide-[var(--border)]">
            {rows.map((r, i) => (
              <motion.li
                key={r.id}
                initial={{ opacity: 0, x: -6 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: Math.min(i % SIZE, 15) * 0.02 }}
                className="flex items-center gap-3 px-4 py-3 md:px-5"
              >
                <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl ${r.direction === "credit" ? "bg-[var(--success-soft)] text-[var(--success)]" : "bg-[var(--danger-soft)] text-[var(--danger)]"}`}>
                  {r.direction === "credit" ? <ArrowDownLeft size={16} /> : <ArrowUpRight size={16} />}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm">{r.reason}</p>
                  <p className="truncate text-[11px] text-[var(--dim)]">
                    {new Date(r.created_at).toLocaleString([], { dateStyle: "short", timeStyle: "short" })} · {t(`acc_${r.account}`)}
                  </p>
                </div>
                <div className="max-w-[55%] shrink-0 text-right">
                  <p className={`tabular break-all text-[13px] font-semibold sm:text-sm ${r.direction === "credit" ? "text-[var(--success)]" : "text-[var(--danger)]"}`}>
                    {r.direction === "credit" ? "+" : "−"}
                    {amountText(r)}
                  </p>
                  <p className="tabular text-[11px] text-[var(--dim)]">{r.account === "btc" ? `${Number(r.balance_after).toFixed(8)} ₿` : formatUsd(Number(r.balance_after))}</p>
                </div>
              </motion.li>
            ))}
          </ul>
          {more && (
            <div className="p-4">
              <Button
                variant="ghost"
                className="w-full"
                loading={loading}
                disabled={loading}
                onClick={() => {
                  const next = page + 1;
                  setPage(next);
                  load(next);
                }}
              >
                {t("loadMore")}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
