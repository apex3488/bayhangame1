"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Megaphone, User, Users } from "lucide-react";
import { useAsk, useGame } from "@/components/game-context";
import { ReadOnlyNote, useAdminRole } from "@/components/admin-shell";
import { Button, PageTitle, Skeleton } from "@/components/ui";
import { adminSearchPlayers, can } from "@/lib/admin";
import { LINK_TARGETS, adminBroadcast, adminListBroadcasts, type BroadcastRow } from "@/lib/social";

const inputCls = "w-full rounded-xl border border-[var(--border)] bg-[var(--bg-2)] px-3 py-2.5 text-sm outline-none focus:border-[var(--accent)]";

export default function AdminBroadcast() {
  const { t, toast, toastError } = useGame();
  const ask = useAsk();
  const role = useAdminRole();
  const editable = can.manage(role);
  const [rows, setRows] = useState<BroadcastRow[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [target, setTarget] = useState<"all" | "one">("all");
  const [player, setPlayer] = useState("");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [link, setLink] = useState("");

  const load = useCallback(() => {
    adminListBroadcasts().then(setRows).catch(toastError);
  }, [toastError]);
  useEffect(load, [load]);

  async function send(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) return toast(`${t("err_invalid_value")}: ${t("a_bcTitle")}`, "error");
    if (!body.trim()) return toast(`${t("err_invalid_value")}: ${t("a_bcBody")}`, "error");
    let targetId: string | null = null;
    let targetName = t("a_bcAll");
    if (target === "one") {
      const found = await adminSearchPlayers(player.trim(), 10, 0).catch(() => []);
      const exact = found.find((p) => p.game_name.toLowerCase() === player.trim().toLowerCase());
      if (!exact) return toast(t("playerNotFound"), "error");
      targetId = exact.id;
      targetName = exact.game_name;
    }
    if (!(await ask(`${t("a_bcSend")}?`, { message: `${targetName}: «${title.trim()}»` }))) return;
    setBusy(true);
    try {
      const r = await adminBroadcast(title.trim(), body.trim(), link || null, targetId);
      toast(`${t("a_bcSent")}: ${r.recipients}`, "success");
      setTitle("");
      setBody("");
      setLink("");
      load();
    } catch (err) {
      toastError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <PageTitle title={t("a_broadcast")} subtitle={t("a_bcSubtitle")} />
      <ReadOnlyNote show={!editable} />
      {editable && (
        <form onSubmit={send} className="panel mb-5 space-y-3 p-5">
          <div className="flex flex-wrap gap-2">
            {(["all", "one"] as const).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setTarget(k)}
                className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-sm font-semibold transition-colors ${target === k ? "border-[var(--accent)] bg-[var(--accent-soft)] text-white" : "border-[var(--border)] text-[var(--muted)]"}`}
              >
                {k === "all" ? <Users size={15} /> : <User size={15} />} {k === "all" ? t("a_bcAll") : t("a_bcOne")}
              </button>
            ))}
          </div>
          {target === "one" && <input value={player} onChange={(e) => setPlayer(e.target.value)} placeholder={t("a_bcPlayer")} className={inputCls} />}
          <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} placeholder={t("a_bcTitle")} className={`${inputCls} font-semibold`} />
          <div>
            <textarea value={body} onChange={(e) => setBody(e.target.value)} maxLength={1000} rows={4} placeholder={t("a_bcBody")} className={`${inputCls} resize-y`} />
            <p className="mt-1 text-right text-[11px] text-[var(--dim)]">{body.length}/1000</p>
          </div>
          <label className="block text-xs text-[var(--muted)]">
            {t("a_bcLink")}
            <select value={link} onChange={(e) => setLink(e.target.value)} className={`${inputCls} mt-1`}>
              <option value="">{t("a_bcNoLink")}</option>
              {LINK_TARGETS.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <Button disabled={busy} loading={busy}>
            <Megaphone size={15} /> {t("a_bcSend")}
          </Button>
        </form>
      )}

      <p className="mb-2 text-sm font-semibold">{t("a_bcHistory")}</p>
      {!rows ? (
        <Skeleton className="h-40 w-full" />
      ) : rows.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">{t("a_noData")}</p>
      ) : (
        <div className="panel divide-y divide-[var(--border)]">
          {rows.map((b) => (
            <div key={b.id} className="p-4">
              <div className="flex flex-wrap items-center gap-2 text-[11px] text-[var(--muted)]">
                <span>{new Date(b.created_at).toLocaleString()}</span>
                <span>· {b.actor}</span>
                <span>· {b.target ?? t("a_bcAll")}</span>
                <span>
                  · {t("a_bcRead")}: {b.read_count}/{b.recipients}
                </span>
                {b.link && <span className="font-mono">· {b.link}</span>}
              </div>
              <p className="mt-1 font-semibold">{b.title}</p>
              <p className="mt-0.5 whitespace-pre-line text-sm text-[var(--muted)]">{b.body}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
