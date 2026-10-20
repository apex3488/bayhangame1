"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { getSupabase, loginToEmail } from "@/lib/supabase";
import { registrationCheck } from "@/lib/game";
import { t } from "@/lib/i18n";
import { useLang } from "@/components/use-lang";
import { Field } from "@/components/field";
import { AuthLayout } from "@/components/auth-layout";
import { Button } from "@/components/ui";

const LOGIN_RE = /^[a-z0-9_]{3,20}$/;
const GAME_NAME_RE = /^[A-Za-z0-9_ ]{3,20}$/;

type Errors = { login?: string; name?: string; password?: string; form?: string };

export default function RegisterPage() {
  const router = useRouter();
  const [lang, setLang] = useLang();
  const [login, setLogin] = useState("");
  const [gameName, setGameName] = useState("");
  const [password, setPassword] = useState("");
  const [ref, setRef] = useState("");
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Errors>({});

  // Invite links look like /register?ref=CODE.
  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get("ref");
    if (code) setRef(code.toUpperCase().slice(0, 12));
  }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const normLogin = login.trim().toLowerCase();
    const name = gameName.trim();
    const next: Errors = {};
    if (!LOGIN_RE.test(normLogin)) next.login = t(lang, "invalidLogin");
    if (!GAME_NAME_RE.test(name)) next.name = t(lang, "invalidGameName");
    if (password.length < 8) next.password = t(lang, "passwordShort");
    setErrors(next);
    if (Object.keys(next).length) return;

    setBusy(true);
    try {
      // Supabase Auth only reports "Database error" when the profile trigger rejects a duplicate,
      // so check availability first to give a precise message.
      const avail = await registrationCheck(normLogin, name);
      if (avail.login_taken || avail.name_taken) {
        setErrors({
          login: avail.login_taken ? t(lang, "loginTaken") : undefined,
          name: avail.name_taken ? t(lang, "nameTaken") : undefined,
        });
        return;
      }
      const { data, error: err } = await getSupabase().auth.signUp({
        email: loginToEmail(normLogin),
        password,
        options: { data: { login: normLogin, game_name: name, ref: ref.trim().toUpperCase() } },
      });
      if (err || !data.session) {
        setErrors({ form: t(lang, "err_unknown") });
        return;
      }
      router.replace("/");
    } catch {
      setErrors({ form: t(lang, "err_unknown") });
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout title={t(lang, "register")} hint={t(lang, "registerHint")} lang={lang} setLang={setLang}>
      <form onSubmit={onSubmit} className="space-y-4">
        <Field label={t(lang, "loginLabel")} value={login} onChange={setLogin} autoComplete="username" error={errors.login} maxLength={20} />
        <Field label={t(lang, "gameNameLabel")} value={gameName} onChange={setGameName} error={errors.name} maxLength={20} />
        <Field label={t(lang, "passwordLabel")} value={password} onChange={setPassword} type="password" autoComplete="new-password" error={errors.password} />
        <Field label={t(lang, "refCodeLabel")} value={ref} onChange={(v) => setRef(v.toUpperCase())} maxLength={12} optional />
        {errors.form && <p className="rounded-xl bg-[var(--danger-soft)] px-4 py-3 text-sm text-[var(--danger)]">{errors.form}</p>}
        <Button disabled={busy} loading={busy} className="w-full py-4">
          {t(lang, "submit")}
        </Button>
        <p className="text-center text-[11px] leading-relaxed text-[var(--dim)]">
          {t(lang, "agreeRules")}{" "}
          <Link href="/rules" className="text-[var(--accent-2)] hover:underline">
            {t(lang, "rulesLink")}
          </Link>
        </p>
      </form>
      <p className="mt-6 text-sm text-[var(--muted)]">
        {t(lang, "haveAccount")}{" "}
        <Link href="/login" className="font-semibold text-[var(--accent-2)]">
          {t(lang, "login")}
        </Link>
      </p>
    </AuthLayout>
  );
}
