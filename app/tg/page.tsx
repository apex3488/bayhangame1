"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { motion } from "motion/react";
import { getSupabase, loginToEmail } from "@/lib/supabase";
import { errorText, t } from "@/lib/i18n";
import { errorKey } from "@/lib/game";
import { BOT_URL, loadTelegram, signInWithTelegramToken, telegramAuth, type TgWebApp } from "@/lib/telegram";
import { useLang } from "@/components/use-lang";
import { AuthLayout } from "@/components/auth-layout";
import { Field } from "@/components/field";
import { Button } from "@/components/ui";

type View = "loading" | "outside" | "choose" | "register" | "login" | "error";

/**
 * Mini App entry point (the bot's menu button and "Play" buttons open /tg).
 * The signed initData goes to the telegram-auth Edge Function; a linked player gets a normal
 * Supabase session and continues into the same game as in the browser.
 */
export default function TelegramEntry() {
  const router = useRouter();
  const [lang, setLang] = useLang();
  const [view, setView] = useState<View>("loading");
  const [wa, setWa] = useState<TgWebApp | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");

  const fail = useCallback((e: unknown) => setError(errorText(lang, errorKey(e instanceof Error ? e.message : String(e)))), [lang]);
  const enter = useCallback(() => router.replace("/"), [router]);

  const start = useCallback(async () => {
    setView("loading");
    setError(null);
    const app = await loadTelegram();
    if (!app) return setView("outside");
    setWa(app);
    try {
      const r = await telegramAuth("session", app.initData);
      if (r.status === "not_linked") {
        const suggested = (r.telegram.username || "").replace(/[^A-Za-z0-9_]/g, "").slice(0, 20);
        setName((n) => n || (suggested.length >= 3 ? suggested : ""));
        return setView("choose");
      }
      // Reuse a stored session only if it belongs to this Telegram user's player.
      const { data } = await getSupabase().auth.getSession();
      if (data.session?.user.id !== r.user_id) {
        if (data.session) await getSupabase().auth.signOut({ scope: "local" });
        await signInWithTelegramToken(r.token_hash!);
      }
      enter();
    } catch (e) {
      fail(e);
      setView("error");
    }
  }, [enter, fail]);

  useEffect(() => {
    start();
  }, [start]);

  async function register(e: FormEvent) {
    e.preventDefault();
    if (!wa) return;
    setBusy(true);
    setError(null);
    try {
      const r = await telegramAuth("register", wa.initData, { gameName: name.trim() });
      if (r.status !== "ok" || !r.token_hash) throw new Error("registration_failed");
      await signInWithTelegramToken(r.token_hash);
      wa.HapticFeedback?.notificationOccurred("success");
      enter();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  }

  async function linkExisting(e: FormEvent) {
    e.preventDefault();
    if (!wa) return;
    setBusy(true);
    setError(null);
    const supabase = getSupabase();
    try {
      const { data, error: err } = await supabase.auth.signInWithPassword({ email: loginToEmail(login), password });
      if (err || !data.session) {
        setError(err?.message.toLowerCase().includes("invalid") ? t(lang, "wrongCredentials") : t(lang, "err_unknown"));
        return;
      }
      try {
        await telegramAuth("link", wa.initData, {}, data.session.access_token);
      } catch (linkErr) {
        // Do not stay signed in to an account this Telegram could not be linked to.
        await supabase.auth.signOut({ scope: "local" });
        throw linkErr;
      }
      wa.HapticFeedback?.notificationOccurred("success");
      enter();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  }

  const errorBox = error && <p className="rounded-xl bg-[var(--danger-soft)] px-4 py-3 text-sm text-[var(--danger)]">{error}</p>;

  if (view === "loading") {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3">
        <motion.div animate={{ opacity: [0.4, 1, 0.4] }} transition={{ duration: 1.6, repeat: Infinity }} className="font-display text-xl font-semibold tracking-wider">
          BAYHAN
        </motion.div>
        <p className="text-sm text-[var(--muted)]">{t(lang, "tg_signingIn")}</p>
      </div>
    );
  }

  if (view === "outside") {
    return (
      <AuthLayout title={t(lang, "tg_outside")} hint={t(lang, "tg_outsideHint")} lang={lang} setLang={setLang}>
        <div className="space-y-3">
          <a href={BOT_URL} className="block">
            <Button className="w-full py-4">{t(lang, "tg_openBot")}</Button>
          </a>
          <Button variant="ghost" className="w-full py-4" onClick={() => router.replace("/login")}>
            {t(lang, "tg_toBrowser")}
          </Button>
        </div>
      </AuthLayout>
    );
  }

  if (view === "error") {
    return (
      <AuthLayout title={t(lang, "tg_error")} hint={t(lang, "tg_welcomeHint")} lang={lang} setLang={setLang}>
        <div className="space-y-4">
          {errorBox}
          <Button className="w-full py-4" onClick={start}>
            {t(lang, "tg_retry")}
          </Button>
        </div>
      </AuthLayout>
    );
  }

  if (view === "register") {
    return (
      <AuthLayout title={t(lang, "tg_new")} hint={t(lang, "tg_newHint")} lang={lang} setLang={setLang}>
        <form onSubmit={register} className="space-y-4">
          <Field label={t(lang, "gameNameLabel")} value={name} onChange={setName} maxLength={20} autoComplete="nickname" />
          {errorBox}
          <Button disabled={busy || name.trim().length < 3} loading={busy} className="w-full py-4">
            {t(lang, "tg_create")}
          </Button>
          <Button type="button" variant="ghost" className="w-full" onClick={() => { setError(null); setView("choose"); }}>
            {t(lang, "tg_back")}
          </Button>
        </form>
      </AuthLayout>
    );
  }

  if (view === "login") {
    return (
      <AuthLayout title={t(lang, "tg_have")} hint={t(lang, "tg_haveHint")} lang={lang} setLang={setLang}>
        <form onSubmit={linkExisting} className="space-y-4">
          <Field label={t(lang, "loginLabel")} value={login} onChange={setLogin} autoComplete="username" maxLength={20} />
          <Field label={t(lang, "passwordLabel")} value={password} onChange={setPassword} type="password" autoComplete="current-password" />
          {errorBox}
          <Button disabled={busy || !login || !password} loading={busy} className="w-full py-4">
            {t(lang, "tg_linkAndPlay")}
          </Button>
          <Button type="button" variant="ghost" className="w-full" onClick={() => { setError(null); setView("choose"); }}>
            {t(lang, "tg_back")}
          </Button>
        </form>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title={t(lang, "tg_welcome")} hint={t(lang, "tg_welcomeHint")} lang={lang} setLang={setLang}>
      <div className="space-y-3">
        <Button className="w-full py-4" onClick={() => setView("register")}>
          {t(lang, "tg_new")}
        </Button>
        <Button variant="ghost" className="w-full py-4" onClick={() => setView("login")}>
          {t(lang, "tg_have")}
        </Button>
      </div>
    </AuthLayout>
  );
}
