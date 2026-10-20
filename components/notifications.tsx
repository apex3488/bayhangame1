"use client";

import { AnimatePresence, motion } from "motion/react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowDownLeft, Bell, Building2, CheckCheck, Gift, Heart, Megaphone, Newspaper, X } from "lucide-react";
import { useGame } from "./game-context";
import { formatUsd } from "./ui";
import { fetchNotifications, fetchUnread, markRead, type GameNotification } from "@/lib/social";
import { play } from "@/lib/sound";

const ICON = {
  broadcast: { icon: Megaphone, color: "#2f7bff" },
  news: { icon: Newspaper, color: "#a855f7" },
  transfer_in: { icon: ArrowDownLeft, color: "#22c55e" },
  admin_credit: { icon: Gift, color: "#ffc94d" },
  marriage_proposal: { icon: Heart, color: "#f43f5e" },
  corp_invite: { icon: Building2, color: "#06b6d4" },
} as const;

const POLL_MS = 30_000;

/** Text of a notification in the player's language (system ones are built from params). */
export function notificationText(n: GameNotification, t: (k: string) => string): { title: string; body: string } {
  const p = n.params ?? {};
  const fill = (s: string) => s.replace(/\{(\w+)\}/g, (_, k) => (k === "amount" ? formatUsd(Number(p.amount ?? 0), 0) : String(p[k] ?? "")));
  switch (n.kind) {
    case "transfer_in":
      return { title: fill(t("n_transfer_in")), body: "" };
    case "admin_credit":
      return { title: fill(t("n_admin_credit")), body: String(p.reason ?? "") };
    case "marriage_proposal":
      return { title: fill(t("n_marriage")), body: t("n_marriage_body") };
    case "corp_invite":
      return { title: fill(t("n_corp_invite")), body: t("n_corp_invite_body") };
    case "news":
      return { title: t("n_news"), body: n.title };
    default:
      return { title: n.title, body: n.body };
  }
}

function ago(iso: string, t: (k: string) => string) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return t("n_now");
  if (s < 3600) return `${Math.floor(s / 60)} ${t("n_min")}`;
  if (s < 86400) return `${Math.floor(s / 3600)} ${t("n_hour")}`;
  return new Date(iso).toLocaleDateString();
}

export function NotificationBell() {
  const { t, toast } = useGame();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const [items, setItems] = useState<GameNotification[] | null>(null);
  const prevUnread = useRef<number | null>(null);
  const box = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    const r = await fetchNotifications(40).catch(() => null);
    if (r) {
      setItems(r.items);
      setUnread(r.unread);
    } else {
      setItems((prev) => prev ?? []); // never leave the panel stuck on the loading state
    }
    return r;
  }, []);

  // Poll the unread counter; when it grows, show the newest notification as a toast.
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      const n = await fetchUnread().catch(() => null);
      if (!alive || n === null) return;
      if (prevUnread.current !== null && n > prevUnread.current) {
        const r = await load();
        const fresh = r?.items.find((x) => !x.read);
        if (fresh) {
          toast(notificationText(fresh, t).title, "info");
          play("notify");
        }
      }
      prevUnread.current = n;
      setUnread(n);
    };
    tick();
    const id = setInterval(tick, POLL_MS);
    const onFocus = () => tick();
    window.addEventListener("focus", onFocus);
    return () => {
      alive = false;
      clearInterval(id);
      window.removeEventListener("focus", onFocus);
    };
  }, [load, t, toast]);

  useEffect(() => {
    if (!open) return;
    load();
    const close = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open, load]);

  async function openItem(n: GameNotification) {
    if (!n.read) {
      await markRead([n.id]).catch(() => {});
      setItems((xs) => xs?.map((x) => (x.id === n.id ? { ...x, read: true } : x)) ?? null);
      setUnread((u) => Math.max(0, u - 1));
      prevUnread.current = Math.max(0, (prevUnread.current ?? 1) - 1);
    }
    if (n.link) {
      setOpen(false);
      router.push(n.link);
    }
  }

  async function readAll() {
    await markRead().catch(() => {});
    setItems((xs) => xs?.map((x) => ({ ...x, read: true })) ?? null);
    setUnread(0);
    prevUnread.current = 0;
  }

  return (
    <div ref={box} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label={t("notifications")}
        className="relative grid h-9 w-9 place-items-center rounded-xl border border-[var(--border)] bg-[var(--surface)] text-[var(--muted)] transition-colors hover:text-white"
      >
        <motion.span animate={unread > 0 ? { rotate: [0, -14, 12, -8, 0] } : {}} transition={{ duration: 0.6, repeat: unread > 0 ? Infinity : 0, repeatDelay: 4 }}>
          <Bell size={16} />
        </motion.span>
        {unread > 0 && (
          <span className="absolute -right-1.5 -top-1.5 grid h-5 min-w-5 place-items-center rounded-full bg-[var(--danger)] px-1 text-[10px] font-bold text-white ring-2 ring-[var(--bg)]">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.98 }}
            transition={{ duration: 0.18 }}
            className="fixed inset-x-3 top-16 z-50 flex max-h-[75vh] flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-2xl sm:absolute sm:inset-x-auto sm:right-0 sm:top-12 sm:w-[380px]"
          >
            <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3">
              <p className="text-sm font-semibold">{t("notifications")}</p>
              <div className="flex items-center gap-1">
                {unread > 0 && (
                  <button onClick={readAll} className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-[var(--accent-2)] hover:bg-[var(--surface-3)]">
                    <CheckCheck size={14} /> {t("n_readAll")}
                  </button>
                )}
                <button onClick={() => setOpen(false)} aria-label={t("close")} className="grid h-7 w-7 place-items-center rounded-lg text-[var(--muted)] hover:bg-[var(--surface-3)] sm:hidden">
                  <X size={15} />
                </button>
              </div>
            </div>
            <div className="overflow-y-auto">
              {items === null ? (
                <p className="p-6 text-center text-sm text-[var(--muted)]">…</p>
              ) : items.length === 0 ? (
                <div className="grid place-items-center gap-2 p-10 text-center text-sm text-[var(--muted)]">
                  <Bell size={28} className="opacity-40" />
                  {t("n_empty")}
                </div>
              ) : (
                <ul>
                  {items.map((n) => {
                    const { icon: Icon, color } = ICON[n.kind] ?? ICON.broadcast;
                    const text = notificationText(n, t);
                    return (
                      <li key={n.id}>
                        <button
                          onClick={() => openItem(n)}
                          className={`flex w-full gap-3 border-b border-[var(--border)]/60 px-4 py-3 text-left transition-colors hover:bg-[var(--surface-3)]/60 ${n.read ? "" : "bg-[var(--accent-soft)]"}`}
                        >
                          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl" style={{ background: `${color}22`, color }}>
                            <Icon size={16} />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="flex items-start justify-between gap-2">
                              <span className="text-sm font-semibold leading-snug">{text.title}</span>
                              {!n.read && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-[var(--accent)]" />}
                            </span>
                            {text.body && <span className="mt-0.5 line-clamp-3 block whitespace-pre-line break-words text-xs text-[var(--muted)]">{text.body}</span>}
                            <span className="mt-1 block text-[10px] text-[var(--dim)]">{ago(n.created_at, t)}</span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
