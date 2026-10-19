"use client";

import { AnimatePresence, motion } from "motion/react";
import { useState, type ReactNode } from "react";
import { Button } from "./ui";
import { useGame } from "./game-context";
import { hasDecimals, parseAmount } from "@/lib/parse";

/** Amount field with a submit button; `decimals` = 2 for USD, 8 for BTC. */
export function AmountForm({
  label,
  action,
  onSubmit,
  busy,
  prefix = "$",
  decimals = 2,
  hint,
  max,
  variant = "primary",
}: {
  label: string;
  action: string;
  onSubmit: (amount: number) => Promise<unknown>;
  busy: boolean;
  prefix?: string;
  decimals?: number;
  hint?: (amount: number) => ReactNode;
  max?: number;
  variant?: "primary" | "ghost" | "outline" | "success";
}) {
  const { t } = useGame();
  const invalidLabel = t("err_invalid_amount");
  const [value, setValue] = useState("");
  const [showError, setShowError] = useState(false);
  const parsed = parseAmount(value);
  const amount = parsed ?? 0;
  const valid = parsed !== null && parsed > 0 && hasDecimals(parsed, decimals);
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        // Keep the button clickable and explain an invalid amount instead of silently ignoring the click.
        if (!valid) return setShowError(true);
        const r = await onSubmit(amount);
        if (r) setValue("");
      }}
      className="space-y-2"
    >
      <div className="flex items-center justify-between text-xs text-[var(--muted)]">
        <span>{label}</span>
        {max !== undefined && (
          <button type="button" onClick={() => setValue(String(Math.floor(max * 10 ** decimals) / 10 ** decimals))} className="font-semibold hover:text-white">
            Max
          </button>
        )}
      </div>
      <div className="flex gap-2">
        <div className="flex flex-1 items-center rounded-2xl border border-[var(--border)] bg-[var(--bg-2)] px-3 focus-within:border-[var(--accent)]">
          <span className="text-sm text-[var(--muted)]">{prefix}</span>
          <input
            inputMode="decimal"
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setShowError(false);
            }}
            className="tabular w-full min-w-0 bg-transparent px-2 py-3 font-semibold outline-none"
          />
        </div>
        <Button disabled={busy} loading={busy} variant={variant} className="shrink-0">
          {action}
        </Button>
      </div>
      {showError && <p className="text-xs text-[var(--danger)]">{invalidLabel}</p>}
      <AnimatePresence>
        {hint && valid && (
          <motion.p initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="text-xs text-[var(--muted)]">
            {hint(amount)}
          </motion.p>
        )}
      </AnimatePresence>
    </form>
  );
}

/** Pill tabs with an animated indicator. */
export function Tabs<T extends string>({ tabs, value, onChange, id }: { tabs: { id: T; label: string }[]; value: T; onChange: (v: T) => void; id: string }) {
  return (
    <div className="mb-5 inline-flex flex-wrap gap-1 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-1">
      {tabs.map((tab) => (
        <button key={tab.id} onClick={() => onChange(tab.id)} className="relative rounded-xl px-4 py-2 text-sm font-semibold">
          {value === tab.id && (
            <motion.span layoutId={`tab-${id}`} className="absolute inset-0 rounded-xl bg-[var(--accent)]" transition={{ type: "spring", stiffness: 400, damping: 32 }} />
          )}
          <span className={`relative ${value === tab.id ? "text-white" : "text-[var(--muted)]"}`}>{tab.label}</span>
        </button>
      ))}
    </div>
  );
}

export function TextForm({
  label,
  action,
  onSubmit,
  busy,
  placeholder,
  maxLength = 24,
  initial = "",
}: {
  label?: string;
  action: string;
  onSubmit: (text: string) => Promise<unknown>;
  busy: boolean;
  placeholder?: string;
  maxLength?: number;
  initial?: string;
}) {
  const [value, setValue] = useState(initial);
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        if (!value.trim()) return;
        const r = await onSubmit(value.trim());
        if (r) setValue("");
      }}
      className="space-y-2"
    >
      {label && <p className="text-xs text-[var(--muted)]">{label}</p>}
      <div className="flex gap-2">
        <input
          value={value}
          maxLength={maxLength}
          placeholder={placeholder}
          onChange={(e) => setValue(e.target.value)}
          className="min-w-0 flex-1 rounded-2xl border border-[var(--border)] bg-[var(--bg-2)] px-4 py-3 outline-none focus:border-[var(--accent)]"
        />
        <Button disabled={!value.trim() || busy} loading={busy} className="shrink-0">
          {action}
        </Button>
      </div>
    </form>
  );
}
