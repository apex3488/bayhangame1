"use client";

import { useRouter } from "next/navigation";
import { motion } from "motion/react";
import { useState, type FormEvent } from "react";
import { ShieldCheck } from "lucide-react";
import { getSupabase, loginToEmail } from "@/lib/supabase";
import { adminMe } from "@/lib/admin";
import { LANGS, t, type Lang } from "@/lib/i18n";
import { useLang } from "@/components/use-lang";
import { Field } from "@/components/field";
import { Button } from "@/components/ui";

/** Separate sign-in for staff: accounts without an admin role are signed out again. */
export default function AdminLoginPage() {
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
      const supabase = getSupabase();
      const { error: err } = await supabase.auth.signInWithPassword({ email: loginToEmail(login), password });
      if (err) return setError(t(lang, "wrongCredentials"));
      const me = await adminMe();
      if (!me.role) {
        await supabase.auth.signOut();
        return setError(t(lang, "a_noAccess"));
      }
      router.replace("/admin");
    } catch {
      setError(t(lang, "err_unknown"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden px-6">
      <motion.div className="absolute h-[500px] w-[500px] rounded-full bg-[#7a1fff]/20 blur-[120px]" animate={{ x: [0, 60, 0], y: [0, -40, 0] }} transition={{ duration: 14, repeat: Infinity }} />
      <motion.div className="absolute h-[400px] w-[400px] rounded-full bg-[#ff4d61]/15 blur-[120px]" animate={{ x: [0, -50, 0], y: [0, 40, 0] }} transition={{ duration: 12, repeat: Infinity }} />
      <select aria-label="Language" value={lang} onChange={(e) => setLang(e.target.value as Lang)}
        className="absolute right-6 top-6 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-2 py-2 text-xs font-semibold">
        {LANGS.map((l) => (
          <option key={l} value={l}>
            {l.toUpperCase()}
          </option>
        ))}
      </select>
      <motion.form
        onSubmit={onSubmit}
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        className="panel relative w-full max-w-sm space-y-4 p-8"
      >
        <div className="grid h-12 w-12 place-items-center rounded-2xl bg-gradient-to-br from-[#ff4d61] to-[#7a1fff]">
          <ShieldCheck size={24} />
        </div>
        <div>
          <h1 className="font-display text-2xl font-semibold">{t(lang, "a_login")}</h1>
          <p className="mt-1 text-sm text-[var(--muted)]">{t(lang, "a_loginHint")}</p>
        </div>
        <Field label={t(lang, "loginLabel")} value={login} onChange={setLogin} autoComplete="username" maxLength={20} />
        <Field label={t(lang, "passwordLabel")} value={password} onChange={setPassword} type="password" autoComplete="current-password" />
        {error && <p className="rounded-xl bg-[var(--danger-soft)] px-4 py-3 text-sm text-[var(--danger)]">{error}</p>}
        <Button disabled={busy} loading={busy} className="w-full bg-gradient-to-r from-[#ff4d61] to-[#7a1fff] py-4 hover:brightness-110">
          {t(lang, "login")}
        </Button>
      </motion.form>
    </div>
  );
}
