"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Crown } from "lucide-react";
import { useAsk, useGame } from "@/components/game-context";
import { ReadOnlyNote, useAdminRole } from "@/components/admin-shell";
import { Button, PageTitle, Skeleton } from "@/components/ui";
import { adminGrantVip, adminListVip, adminRevokeVip, adminSearchPlayers, can } from "@/lib/admin";

const inputCls = "w-full rounded-xl border border-[var(--border)] bg-[var(--bg-2)] px-3 py-2.5 text-sm outline-none focus:border-[var(--accent)]";

export default function AdminVip() {
  const { t, toast, toastError } = useGame();
  const role = useAdminRole();
  const ask = useAsk();
  const editable = can.manage(role);
  const [rows, setRows] = useState<Awaited<ReturnType<typeof adminListVip>> | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [f, setF] = useState({ player: "", level: 1, days: 14, reason: "" });

  const load = useCallback(() => {
    adminListVip().then(setRows).catch(toastError);
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

  async function grant(e: FormEvent) {
    e.preventDefault();
    if (!f.player.trim()) return toast(t("err_target_not_found"), "error");
    if (f.reason.trim().length < 5) return toast(t("err_reason_required"), "error");
    if (!Number.isInteger(f.days) || f.days < 1 || f.days > 365) return toast(`${t("err_invalid_value")}: ${t("a_days")} (1–365)`, "error");
    const ok = await run("grant", async () => {
      // Resolve the player by exact game name or login.
      const found = (await adminSearchPlayers(f.player.trim(), 10, 0)).find(
        (p) => p.game_name.toLowerCase() === f.player.trim().toLowerCase() || p.login === f.player.trim().toLowerCase(),
      );
      if (!found) throw new Error("target_not_found");
      await adminGrantVip(found.id, f.level, f.days, f.reason.trim());
    });
    if (ok) setF({ ...f, player: "", reason: "" });
  }

  return (
    <div>
      <PageTitle title={t("a_vip")} subtitle={t("vipInfo")} />
      <ReadOnlyNote show={!editable} />
      {editable && (
        <form onSubmit={grant} className="panel mb-5 grid gap-2 p-5 md:grid-cols-[1fr_120px_110px_1.4fr_auto]">
          <input value={f.player} onChange={(e) => setF({ ...f, player: e.target.value })} placeholder={t("a_findPlayer")} className={inputCls} />
          <select value={f.level} onChange={(e) => setF({ ...f, level: Number(e.target.value) })} className={inputCls}>
            {[1, 2, 3, 4].map((l) => <option key={l} value={l}>VIP {l}</option>)}
          </select>
          <input type="number" min={1} max={365} value={f.days} onChange={(e) => setF({ ...f, days: Number(e.target.value) })} placeholder={t("a_days")} className={inputCls} />
          <input value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} maxLength={200} placeholder={t("a_reason")} className={inputCls} />
          <Button disabled={busy !== null} loading={busy === "grant"}>
            <Crown size={15} /> {t("a_grantVip")}
          </Button>
        </form>
      )}
      {!rows ? (
        <Skeleton className="h-48" />
      ) : rows.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">{t("a_noData")}</p>
      ) : (
        <div className="panel divide-y divide-[var(--border)]">
          {rows.map((v) => (
            <div key={v.user_id} className="flex flex-wrap items-center gap-4 px-5 py-3 text-sm">
              <Link href={`/admin/players/${v.user_id}`} className="font-semibold hover:text-[var(--accent-2)]">{v.game_name}</Link>
              <span className="flex items-center gap-1 rounded-full bg-[#ffc94d22] px-2.5 py-0.5 text-[11px] font-semibold text-[var(--gold)]"><Crown size={11} /> VIP {v.level}</span>
              <span className={`text-xs ${v.active ? "text-[var(--success)]" : "text-[var(--muted)]"}`}>
                {v.active ? t("a_active") : t("a_expired")} · {t("a_until")} {new Date(v.ends_at).toLocaleString()}
              </span>
              {editable && (
                <Button variant="outline" className="ml-auto px-3 py-1.5 text-xs" disabled={busy !== null} loading={busy === v.user_id}
                  onClick={async () => {
                    const reason = await ask(`${t("a_revokeVip")}: ${v.game_name}`, { danger: true, input: { placeholder: t("a_reason"), minLength: 5 } });
                    if (typeof reason === "string") run(v.user_id, () => adminRevokeVip(v.user_id, reason));
                  }}>
                  {t("a_revokeVip")}
                </Button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
