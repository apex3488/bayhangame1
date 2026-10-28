"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { KeyRound, Send } from "lucide-react";
import { getSupabase } from "@/lib/supabase";
import { BOT_URL } from "@/lib/telegram";
import { useAsk, useGame } from "./game-context";
import { Button } from "./ui";

type TgLink = { linked: boolean; username?: string; first_name?: string };

/** Profile → Telegram: link this account to the bot / Mini App with a one-time link, or unlink it. */
export function TelegramCard() {
  const { t, toast, toastError } = useGame();
  const ask = useAsk();
  const [link, setLink] = useState<TgLink | null>(null);
  const [code, setCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await getSupabase().rpc("my_telegram");
    if (!error) setLink(data as TgLink);
    return data as TgLink | null;
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // While a link is pending, notice when the bot has consumed it.
  useEffect(() => {
    if (!code) return;
    const id = setInterval(async () => {
      const l = await load();
      if (l?.linked) {
        setCode(null);
        toast(t("tg_linkedOk"), "success");
      }
    }, 3000);
    const stop = setTimeout(() => setCode(null), 10 * 60 * 1000);
    return () => {
      clearInterval(id);
      clearTimeout(stop);
    };
  }, [code, load, t, toast]);

  async function createCode() {
    setBusy(true);
    try {
      const { data, error } = await getSupabase().rpc("telegram_link_code_create");
      if (error) throw new Error(error.message);
      setCode((data as { code: string }).code);
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  }

  async function unlink() {
    if (!(await ask(t("tg_unlinkConfirm"), { danger: true }))) return;
    const { error } = await getSupabase().rpc("telegram_unlink");
    if (error) return toastError(new Error(error.message));
    toast(t("tg_unlinkedOk"), "success");
    load();
  }

  return (
    <div className="panel p-5">
      <div className="flex items-center gap-2">
        <Send size={16} className="text-[#2aabee]" />
        <p className="text-sm font-semibold">{t("tg_card")}</p>
      </div>
      {link?.linked ? (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-[var(--muted)]">
            {t("tg_linkedAs")}: <span className="font-semibold text-white">{link.username ? `@${link.username}` : link.first_name}</span>
          </p>
          <Button variant="ghost" className="py-2 text-xs" onClick={unlink}>
            {t("tg_unlink")}
          </Button>
        </div>
      ) : (
        <div className="mt-3 space-y-3">
          <p className="text-sm text-[var(--muted)]">{code ? t("tg_codeHint") : t("tg_notLinked")}</p>
          {code ? (
            <a href={`${BOT_URL}?start=link_${code}`} target="_blank" rel="noopener noreferrer" className="block">
              <Button className="w-full bg-[#2aabee]">{t("tg_openBot")}</Button>
            </a>
          ) : (
            <Button className="w-full" disabled={busy || !link} loading={busy} onClick={createCode}>
              {t("tg_link")}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

/** Profile → browser sign-in: shows the login and sets a password (accounts made in Telegram start without one). */
export function PasswordCard({ login }: { login?: string }) {
  const { t, toast, toastError } = useGame();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  async function save(e: FormEvent) {
    e.preventDefault();
    if (password.length < 8) return toastError(new Error("password_short"));
    setBusy(true);
    try {
      const { error } = await getSupabase().auth.updateUser({ password });
      if (error) throw new Error(error.message);
      setPassword("");
      toast(t("pwd_saved"), "success");
    } catch (err) {
      toastError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="panel space-y-3 p-5">
      <div className="flex items-center gap-2">
        <KeyRound size={16} className="text-[var(--accent-2)]" />
        <p className="text-sm font-semibold">{t("pwd_title")}</p>
      </div>
      <p className="text-sm text-[var(--muted)]">{t("pwd_hint")}</p>
      {login && (
        <p className="text-sm">
          {t("pwd_login")}: <code className="rounded-lg bg-[var(--bg-2)] px-2 py-1 font-semibold">{login}</code>
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <input
          type="password"
          autoComplete="new-password"
          value={password}
          minLength={8}
          placeholder={t("pwd_new")}
          onChange={(e) => setPassword(e.target.value)}
          className="min-w-[150px] flex-[1_1_150px] rounded-2xl border border-[var(--border)] bg-[var(--bg-2)] px-4 py-3 outline-none focus:border-[var(--accent)]"
        />
        <Button disabled={busy || password.length < 8} loading={busy} className="grow sm:grow-0">
          {t("pwd_save")}
        </Button>
      </div>
    </form>
  );
}
