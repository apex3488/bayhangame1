"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { motion } from "motion/react";
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { LogOut, ShieldCheck } from "lucide-react";
import { getSupabase } from "@/lib/supabase";
import { LANGS, type Lang } from "@/lib/i18n";
import { GameProvider, useGame } from "./game-context";
import { ALL_SECTIONS, GROUPS, MOBILE_NAV, isActive } from "./nav";
import { Money } from "./ui";
import { Avatar, StyledName } from "./cosmetic-view";
import { mediaUrl } from "@/lib/profile";
import { useIsOwner } from "./use-owner";
import { NotificationBell } from "./notifications";
import { Onboarding } from "./onboarding";

/** Requires a Supabase session; redirects to /login otherwise. Real checks happen in RPCs. */
export function AppShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [state, setState] = useState<"checking" | "ready" | "config-error">("checking");

  useEffect(() => {
    let cancelled = false;
    let unsubscribe: (() => void) | null = null;
    try {
      const supabase = getSupabase();
      supabase.auth.getSession().then(({ data }) => {
        if (cancelled) return;
        if (!data.session) router.replace("/login");
        else setState("ready");
      });
      const sub = supabase.auth.onAuthStateChange((_event, session) => {
        if (!session) router.replace("/login");
      });
      unsubscribe = () => sub.data.subscription.unsubscribe();
    } catch {
      setState("config-error");
    }
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [router]);

  if (state === "config-error") {
    return <div className="p-6 text-[var(--danger)]">Supabase is not configured (.env.local).</div>;
  }
  if (state === "checking") {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <motion.div
          animate={{ opacity: [0.4, 1, 0.4] }}
          transition={{ duration: 1.6, repeat: Infinity }}
          className="font-display text-xl font-semibold tracking-wider"
        >
          BAYHAN
        </motion.div>
      </div>
    );
  }
  return (
    <GameProvider>
      <ShellFrame>{children}</ShellFrame>
      <Onboarding />
    </GameProvider>
  );
}

function ShellFrame({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { t, lang, setLang, snapshot, loadout } = useGame();
  // The admin entry point is shown to the owner only; the server re-checks the role on every admin call.
  const isOwner = useIsOwner();

  async function logout() {
    await getSupabase().auth.signOut();
    router.replace("/login");
  }

  const xpPer = snapshot?.xp_per_level || 500;
  const xpInLevel = snapshot ? snapshot.xp % xpPer : 0;
  // An equipped theme recolours the accent of the whole interface.
  const theme = loadout.theme?.style;
  // Derived variables must be re-declared here: CSS computes them where they are defined.
  const themeVars = (
    theme?.accent
      ? {
          "--accent": theme.accent,
          "--accent-2": theme.accent2 ?? theme.accent,
          "--accent-soft": `color-mix(in srgb, ${theme.accent} 14%, transparent)`,
          "--accent-glow": `color-mix(in srgb, ${theme.accent} 35%, transparent)`,
        }
      : {}
  ) as CSSProperties;

  return (
    <div className="min-h-screen lg:flex" style={themeVars}>
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-[var(--border)] bg-[var(--bg-2)]/80 backdrop-blur-xl lg:flex">
        <Link href="/" className="flex items-center gap-3 px-5 pb-6 pt-5">
          <div className="grid h-9 w-9 place-items-center rounded-xl bg-[var(--accent)] font-display text-sm font-bold shadow-[0_0_30px_var(--accent-glow)]">
            B
          </div>
          <span className="font-display text-base font-semibold tracking-wide">BAYHAN</span>
        </Link>
        <nav className="flex-1 space-y-4 overflow-y-auto px-3 pb-4">
          {GROUPS.map((g) => (
            <div key={g.key}>
              <p className="mb-1 px-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--dim)]">{t(g.key)}</p>
              {g.items.map(({ href, key, icon: Icon }) => {
                const active = isActive(pathname, href);
                return (
                  <Link key={href} href={href} className="relative block">
                    {active && (
                      <motion.span
                        layoutId="nav-active"
                        className="absolute inset-0 rounded-xl bg-[var(--accent-soft)] ring-1 ring-[var(--accent)]/30"
                        transition={{ type: "spring", stiffness: 400, damping: 34 }}
                      />
                    )}
                    <span
                      className={`relative flex items-center gap-3 rounded-xl px-3 py-2 text-[13px] font-medium transition-colors ${
                        active ? "text-white" : "text-[var(--muted)] hover:text-white"
                      }`}
                    >
                      <Icon size={16} strokeWidth={2} className={active ? "text-[var(--accent-2)]" : ""} />
                      {t(key)}
                    </span>
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        {snapshot && (
          <Link href="/profile" className="m-3 flex items-center gap-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3 transition-colors hover:border-[var(--border-strong)]">
            <Avatar name={snapshot.game_name} loadout={loadout} size={40} src={mediaUrl(snapshot.user_id, "avatar", snapshot.avatar_version)} />
            <div className="min-w-0 flex-1">
              <StyledName name={snapshot.game_name} loadout={loadout} className="block truncate text-sm font-semibold" />
              <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-[var(--surface-3)]">
                <motion.div
                  className="h-full rounded-full bg-gradient-to-r from-[var(--accent)] to-[var(--accent-2)]"
                  initial={{ width: 0 }}
                  animate={{ width: `${(xpInLevel / xpPer) * 100}%` }}
                  transition={{ duration: 1, ease: [0.16, 1, 0.3, 1] }}
                />
              </div>
              <p className="mt-1 text-[10px] text-[var(--muted)]">
                {t("level")} {snapshot.level} · {xpInLevel}/{xpPer} XP
              </p>
            </div>
          </Link>
        )}
      </aside>

      <div className="flex min-h-screen min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-[var(--border)] bg-[var(--bg)]/75 px-4 py-3 backdrop-blur-xl md:px-8">
          <Link href="/" className="flex items-center gap-2 lg:hidden">
            <div className="grid h-8 w-8 place-items-center rounded-lg bg-[var(--accent)] font-display text-xs font-bold">B</div>
          </Link>
          <p className="hidden text-sm font-semibold text-[var(--muted)] md:block">
            {t(pathname.startsWith("/players/") ? "leaderboard" : (ALL_SECTIONS.find((s) => isActive(pathname, s.href) && s.href !== "/")?.key ?? "home"))}
          </p>
          <div className="ml-auto flex min-w-0 items-center gap-2 sm:gap-3">
            {snapshot && (
              <Link href="/bank" className="flex min-w-0 items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5">
                <span className="h-2 w-2 shrink-0 rounded-full bg-[var(--success)] shadow-[0_0_10px_var(--success)]" />
                <Money value={Number(snapshot.cash)} className="text-sm font-semibold" />
              </Link>
            )}
            {/* On phones the language switch and logout live on the profile page to keep the header uncluttered. */}
            <select
              aria-label="Language"
              value={lang}
              onChange={(e) => setLang(e.target.value as Lang)}
              className="hidden shrink-0 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-2 py-2 text-xs font-semibold sm:block"
            >
              {LANGS.map((l) => (
                <option key={l} value={l}>
                  {l.toUpperCase()}
                </option>
              ))}
            </select>
            <div className="shrink-0">
              <NotificationBell />
            </div>
            {isOwner && (
              <Link
                href="/admin"
                aria-label={t("adminPanel")}
                title={t("adminPanel")}
                className="grid h-9 shrink-0 place-items-center gap-1.5 rounded-xl border border-[#ffc94d]/40 bg-[#ffc94d]/10 px-2.5 text-[#ffc94d] transition-colors hover:bg-[#ffc94d]/20 sm:flex sm:px-3"
              >
                <ShieldCheck size={16} />
                <span className="hidden text-xs font-semibold sm:inline">{t("adminPanel")}</span>
              </Link>
            )}
            <button
              onClick={logout}
              aria-label={t("logout")}
              className="hidden h-9 w-9 shrink-0 place-items-center rounded-xl border border-[var(--border)] bg-[var(--surface)] text-[var(--muted)] transition-colors hover:text-white sm:grid"
            >
              <LogOut size={16} />
            </button>
          </div>
        </header>

        {snapshot && snapshot.status !== "active" && (
          <div className="border-b border-[var(--danger)]/30 bg-[var(--danger-soft)] px-4 py-2.5 text-center text-sm font-medium text-[var(--danger)] md:px-8">
            {t("err_account_restricted")}
          </div>
        )}
        <main className="mx-auto w-full max-w-7xl flex-1 px-4 pb-[calc(7rem+env(safe-area-inset-bottom))] pt-6 md:px-8 lg:pb-12">
          {/* Enter-only transition: App Router swaps children before an exit animation could finish. */}
          <motion.div
            key={pathname}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
          >
            {children}
          </motion.div>
        </main>

        <nav className="fixed inset-x-3 bottom-[max(12px,env(safe-area-inset-bottom))] z-30 grid grid-cols-5 rounded-2xl border border-[var(--border)] bg-[var(--surface)]/90 p-1.5 shadow-2xl backdrop-blur-xl lg:hidden">
          {MOBILE_NAV.map((href) => {
            const s = ALL_SECTIONS.find((x) => x.href === href)!;
            const Icon = s.icon;
            const active = href === "/city" ? !ALL_SECTIONS.some((x) => MOBILE_NAV.includes(x.href) && x.href !== "/city" && isActive(pathname, x.href)) && pathname !== "/" : isActive(pathname, href);
            return (
              <Link key={href} href={href} className="relative flex flex-col items-center gap-1 py-2">
                {active && (
                  <motion.span
                    layoutId="nav-active-mobile"
                    className="absolute inset-0 rounded-xl bg-[var(--accent-soft)]"
                    transition={{ type: "spring", stiffness: 400, damping: 34 }}
                  />
                )}
                <Icon size={19} className={`relative ${active ? "text-[var(--accent-2)]" : "text-[var(--muted)]"}`} />
                <span className={`relative text-[10px] font-medium ${active ? "text-white" : "text-[var(--muted)]"}`}>{t(s.key)}</span>
              </Link>
            );
          })}
        </nav>
      </div>
    </div>
  );
}
