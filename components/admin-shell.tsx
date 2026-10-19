"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { motion } from "motion/react";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { ArrowLeft, BadgePercent, Crown, Gauge, LogOut, ScrollText, Settings2, ShieldAlert, Sparkles, Users } from "lucide-react";
import { getSupabase } from "@/lib/supabase";
import { adminMe, adminSessionStart, type AdminRole } from "@/lib/admin";
import { LANGS, type Lang } from "@/lib/i18n";
import { GameProvider, useGame } from "./game-context";
import { Button } from "./ui";

const NAV = [
  { href: "/admin", key: "a_dashboard", icon: Gauge },
  { href: "/admin/players", key: "a_players", icon: Users },
  { href: "/admin/economy", key: "a_economy", icon: Settings2 },
  { href: "/admin/promos", key: "a_promos", icon: BadgePercent },
  { href: "/admin/events", key: "a_events", icon: Sparkles },
  { href: "/admin/vip", key: "a_vip", icon: Crown },
  { href: "/admin/audit", key: "a_audit", icon: ScrollText },
];

export const STATUS_STYLE: Record<string, string> = {
  active: "bg-[var(--success-soft)] text-[var(--success)]",
  restricted: "bg-[#f59e0b22] text-[#f59e0b]",
  blocked: "bg-[var(--danger-soft)] text-[var(--danger)]",
};

const RoleCtx = createContext<AdminRole | null>(null);
export const useAdminRole = () => useContext(RoleCtx);

const active = (path: string, href: string) => (href === "/admin" ? path === "/admin" : path.startsWith(href));

/** Admin area: requires a session and an admin role. The server re-checks the role on every call. */
export function AdminShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [role, setRole] = useState<AdminRole | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    getSupabase()
      .auth.getSession()
      .then(async ({ data }) => {
        if (!data.session) return router.replace("/admin/login");
        const me = await adminMe().catch(() => ({ role: null }));
        if (cancelled) return;
        setRole(me.role);
        // One "admin_login" audit record per browser session.
        try {
          if (me.role && !sessionStorage.getItem("bayhan.admin.session")) {
            await adminSessionStart();
            sessionStorage.setItem("bayhan.admin.session", "1");
          }
        } catch {
          // Storage may be blocked; the audit call itself already ran or will run next time.
        }
      });
    return () => {
      cancelled = true;
    };
  }, [router]);

  if (role === undefined) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <motion.span animate={{ opacity: [0.3, 1, 0.3] }} transition={{ duration: 1.4, repeat: Infinity }} className="font-display tracking-widest">
          BAYHAN ADMIN
        </motion.span>
      </div>
    );
  }

  return (
    <GameProvider>
      <RoleCtx.Provider value={role}>{role ? <Frame role={role}>{children}</Frame> : <NoAccess />}</RoleCtx.Provider>
    </GameProvider>
  );
}

function NoAccess() {
  const { t } = useGame();
  const router = useRouter();
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-5 p-6 text-center">
      <ShieldAlert size={48} className="text-[var(--danger)]" />
      <p className="font-display text-xl">{t("a_noAccess")}</p>
      <div className="flex gap-3">
        <Link href="/">
          <Button variant="ghost">{t("a_backToGame")}</Button>
        </Link>
        <Button
          onClick={async () => {
            await getSupabase().auth.signOut();
            router.replace("/admin/login");
          }}
        >
          {t("logout")}
        </Button>
      </div>
    </div>
  );
}

function Frame({ role, children }: { role: AdminRole; children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { t, lang, setLang, snapshot } = useGame();

  return (
    <div className="min-h-screen lg:flex">
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-[var(--border)] bg-[#07080d] p-4 lg:flex">
        <div className="mb-8 flex items-center gap-3 px-2 pt-1">
          <div className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-[#ff4d61] to-[#7a1fff] font-display text-xs font-bold">A</div>
          <div>
            <p className="font-display text-sm font-semibold tracking-wide">{t("a_title")}</p>
            <p className="text-[10px] uppercase tracking-widest text-[var(--muted)]">{t(`a_role_${role}`)}</p>
          </div>
        </div>
        <nav className="space-y-1">
          {NAV.map(({ href, key, icon: Icon }) => {
            const on = active(pathname, href);
            return (
              <Link key={href} href={href} className="relative block">
                {on && <motion.span layoutId="admin-nav" className="absolute inset-0 rounded-xl bg-white/[0.06] ring-1 ring-white/10" />}
                <span className={`relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm ${on ? "text-white" : "text-[var(--muted)] hover:text-white"}`}>
                  <Icon size={16} /> {t(key)}
                </span>
              </Link>
            );
          })}
        </nav>
        <div className="mt-auto space-y-2">
          <Link href="/" className="flex items-center gap-2 rounded-xl px-3 py-2 text-xs text-[var(--muted)] hover:text-white">
            <ArrowLeft size={14} /> {t("a_backToGame")}
          </Link>
          <p className="px-3 text-xs text-[var(--dim)]">{snapshot?.game_name}</p>
        </div>
      </aside>

      <div className="flex min-h-screen min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-[var(--border)] bg-[var(--bg)]/80 px-4 py-3 backdrop-blur-xl md:px-8">
          <span className="font-display text-sm font-semibold lg:hidden">{t("a_title")}</span>
          <span className="rounded-full bg-gradient-to-r from-[#ff4d61]/20 to-[#7a1fff]/20 px-3 py-1 text-[11px] font-semibold text-[#ff8a9a]">
            {t("a_role")}: {t(`a_role_${role}`)}
          </span>
          <div className="ml-auto flex items-center gap-2">
            <select aria-label="Language" value={lang} onChange={(e) => setLang(e.target.value as Lang)}
              className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-2 py-2 text-xs font-semibold">
              {LANGS.map((l) => (
                <option key={l} value={l}>
                  {l.toUpperCase()}
                </option>
              ))}
            </select>
            <button
              aria-label={t("logout")}
              onClick={async () => {
                await getSupabase().auth.signOut();
                router.replace("/admin/login");
              }}
              className="grid h-9 w-9 place-items-center rounded-xl border border-[var(--border)] bg-[var(--surface)] text-[var(--muted)] hover:text-white"
            >
              <LogOut size={16} />
            </button>
          </div>
        </header>
        <nav className="flex gap-1 overflow-x-auto border-b border-[var(--border)] px-3 py-2 lg:hidden">
          {NAV.map(({ href, key }) => (
            <Link key={href} href={href} className={`shrink-0 rounded-lg px-3 py-1.5 text-xs ${active(pathname, href) ? "bg-white/10 text-white" : "text-[var(--muted)]"}`}>
              {t(key)}
            </Link>
          ))}
        </nav>
        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 md:px-8">
          <motion.div key={pathname} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
            {children}
          </motion.div>
        </main>
      </div>
    </div>
  );
}

/** Notice for roles that can only view a section. */
export function ReadOnlyNote({ show }: { show: boolean }) {
  const { t } = useGame();
  if (!show) return null;
  return <p className="mb-4 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-2.5 text-xs text-[var(--muted)]">{t("a_readOnly")}</p>;
}
