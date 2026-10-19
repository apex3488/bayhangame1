"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { getSupabase, loginToEmail } from "@/lib/supabase";
import { t } from "@/lib/i18n";
import { useLang } from "@/components/use-lang";
import { Field } from "@/components/field";
import { AuthLayout } from "@/components/auth-layout";
import { Button } from "@/components/ui";

export default function LoginPage() {
  const router = useRouter();
  const [lang, setLang] = useLang();
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const { error: err } = await getSupabase().auth.signInWithPassword({ email: loginToEmail(login), password });
      if (err) {
        setError(err.message.toLowerCase().includes("invalid") ? t(lang, "wrongCredentials") : t(lang, "err_unknown"));
        return;
      }
      router.replace("/");
    } catch {
      setError(t(lang, "err_unknown"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout title={t(lang, "login")} hint={t(lang, "loginHint")} lang={lang} setLang={setLang}>
      <form onSubmit={onSubmit} className="space-y-4">
        <Field label={t(lang, "loginLabel")} value={login} onChange={setLogin} autoComplete="username" maxLength={20} />
        <Field label={t(lang, "passwordLabel")} value={password} onChange={setPassword} type="password" autoComplete="current-password" />
        {error && <p className="rounded-xl bg-[var(--danger-soft)] px-4 py-3 text-sm text-[var(--danger)]">{error}</p>}
        <Button disabled={busy} loading={busy} className="w-full py-4">
          {t(lang, "login")}
        </Button>
      </form>
      <p className="mt-6 text-sm text-[var(--muted)]">
        {t(lang, "noAccount")}{" "}
        <Link href="/register" className="font-semibold text-[var(--accent-2)]">
          {t(lang, "register")}
        </Link>
      </p>
    </AuthLayout>
  );
}
