"use client";

import { AnimatePresence, motion } from "motion/react";
import { useRef, useState, type FormEvent } from "react";
import { Check, Send } from "lucide-react";
import { useGame } from "@/components/game-context";
import { Button, Money, PageTitle, Reveal, formatUsd } from "@/components/ui";
import { errorKey, newIdempotencyKey, transferFunds } from "@/lib/game";
import { parseAmount } from "@/lib/parse";

export default function TransferPage() {
  const { t, snapshot, refresh, toast, toastError } = useGame();
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<{ to: string; amount: number } | null>(null);
  // Same key while a request is retried; a new key once the attempt has finished.
  const keyRef = useRef<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const value = parseAmount(amount) ?? NaN;
    if (!to.trim()) return toast(t("err_recipient_not_found"), "error");
    if (!Number.isFinite(value) || value <= 0 || Math.round(value * 100) / 100 !== value) return toast(t("err_invalid_amount"), "error");
    setBusy(true);
    keyRef.current ??= newIdempotencyKey();
    try {
      await transferFunds(to.trim(), value, keyRef.current);
      keyRef.current = null;
      setSent({ to: to.trim(), amount: value });
      setAmount("");
      refresh();
    } catch (err) {
      // Keep the key on an unknown failure: a retry must not pay twice.
      if (errorKey((err as Error).message) !== "unknown") keyRef.current = null;
      toastError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-xl">
      <PageTitle title={t("transfer")} subtitle={t("transferSubtitle")} />
      <Reveal>
        <form onSubmit={onSubmit} className="panel space-y-5 p-6">
          <div className="rounded-2xl bg-[var(--bg-2)] p-4">
            <p className="text-xs text-[var(--muted)]">{t("wallet")}</p>
            {snapshot && <Money value={Number(snapshot.cash)} className="font-display mt-1 block text-2xl font-semibold" />}
          </div>
          <label className="block">
            <span className="mb-2 block text-xs text-[var(--muted)]">{t("recipient")}</span>
            <input
              value={to}
              onChange={(e) => setTo(e.target.value)}
              maxLength={20}
              className="w-full rounded-2xl border border-[var(--border)] bg-[var(--bg-2)] px-4 py-3.5 outline-none transition-colors focus:border-[var(--accent)]"
            />
          </label>
          <label className="block">
            <span className="mb-2 block text-xs text-[var(--muted)]">{t("amount")}</span>
            <div className="flex items-center rounded-2xl border border-[var(--border)] bg-[var(--bg-2)] px-4 focus-within:border-[var(--accent)]">
              <span className="text-[var(--muted)]">$</span>
              <input
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="tabular w-full bg-transparent px-2 py-3.5 text-lg font-semibold outline-none"
              />
            </div>
          </label>
          <Button disabled={busy} loading={busy} className="w-full py-4">
            <Send size={16} /> {t("send")}
          </Button>
        </form>
      </Reveal>

      <AnimatePresence>
        {sent && (
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0 }}
            className="panel mt-5 flex items-center gap-4 p-5"
          >
            <motion.div
              initial={{ scale: 0, rotate: -90 }}
              animate={{ scale: 1, rotate: 0 }}
              transition={{ type: "spring", stiffness: 260, damping: 14 }}
              className="grid h-12 w-12 place-items-center rounded-full bg-[var(--success)] text-black"
            >
              <Check size={24} />
            </motion.div>
            <div>
              <p className="text-sm font-semibold">{t("transferDone")}</p>
              <p className="text-sm text-[var(--muted)]">
                {formatUsd(sent.amount)} → {sent.to}
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
