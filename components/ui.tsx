"use client";

import { animate, motion, useMotionValue, useReducedMotion, useTransform, AnimatePresence } from "motion/react";
import { useEffect, useMemo, useState, type ButtonHTMLAttributes, type ReactNode } from "react";

export function formatUsd(value: number, digits = 2): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

export function formatCompact(value: number): string {
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

/** Number that animates from its previous value to the new one. */
export function Money({ value, className, digits = 2 }: { value: number; className?: string; digits?: number }) {
  const reduce = useReducedMotion();
  const mv = useMotionValue(value);
  const text = useTransform(mv, (v) => formatUsd(v, digits));
  useEffect(() => {
    if (reduce) {
      mv.set(value);
      return;
    }
    const controls = animate(mv, value, { duration: 1.1, ease: [0.16, 1, 0.3, 1] });
    return () => controls.stop();
  }, [value, mv, reduce]);
  return <motion.span className={`tabular ${className ?? ""}`}>{text}</motion.span>;
}

type Variant = "primary" | "ghost" | "outline" | "danger" | "success";

const VARIANTS: Record<Variant, string> = {
  primary:
    "bg-[var(--accent)] text-white shadow-[0_10px_30px_-10px_var(--accent-glow)] hover:bg-[var(--accent-2)]",
  ghost: "bg-[var(--surface-3)] text-[var(--text)] hover:bg-[var(--border-strong)]",
  outline: "border border-[var(--border-strong)] text-[var(--text)] hover:border-[var(--accent)] hover:text-white",
  danger: "bg-[var(--danger)] text-white hover:brightness-110",
  success: "bg-[var(--success)] text-[#041a12] hover:brightness-110 shadow-[0_10px_30px_-10px_rgba(47,224,160,.5)]",
};

export function Button({
  variant = "primary",
  className,
  children,
  loading,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; loading?: boolean }) {
  return (
    <motion.button
      whileTap={{ scale: 0.97 }}
      whileHover={{ y: -1 }}
      transition={{ type: "spring", stiffness: 500, damping: 30 }}
      className={`relative inline-flex select-none items-center justify-center gap-2 rounded-2xl px-5 py-3 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${VARIANTS[variant]} ${className ?? ""}`}
      {...(rest as object)}
    >
      {loading ? (
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
      ) : null}
      {children}
    </motion.button>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={`skeleton ${className ?? ""}`} />;
}

/** Card that fades and lifts in; `delay` staggers siblings. */
export function Reveal({ children, delay = 0, className }: { children: ReactNode; delay?: number; className?: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.55, delay, ease: [0.16, 1, 0.3, 1] }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

export function PageTitle({ title, subtitle, right }: { title: string; subtitle?: string; right?: ReactNode }) {
  return (
    <Reveal className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="font-display text-2xl font-semibold md:text-3xl">{title}</h1>
        {subtitle && <p className="mt-2 max-w-2xl text-sm text-[var(--muted)]">{subtitle}</p>}
      </div>
      {right}
    </Reveal>
  );
}

/** Bet amount with quick chips. Values are validated again by the server. */
export function BetInput({
  value,
  onChange,
  min,
  max,
  balance,
  disabled,
  label,
}: {
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  balance: number;
  disabled?: boolean;
  label: string;
}) {
  const clamp = (v: number) => Math.max(min, Math.min(max, Math.round(v * 100) / 100));
  const chips: [string, () => number][] = [
    ["½", () => value / 2],
    ["×2", () => value * 2],
    ["Min", () => min],
    ["Max", () => Math.min(max, balance)],
  ];
  return (
    <div>
      <div className="mb-2 flex items-center justify-between text-xs text-[var(--muted)]">
        <span>{label}</span>
        <span className="tabular">
          {formatCompact(min)} – {formatCompact(max)}
        </span>
      </div>
      <div className="flex items-center gap-2 rounded-2xl border border-[var(--border)] bg-[var(--bg-2)] p-1.5 focus-within:border-[var(--accent)]">
        <span className="pl-3 text-[var(--muted)]">$</span>
        <input
          type="number"
          inputMode="decimal"
          value={Number.isFinite(value) ? value : ""}
          disabled={disabled}
          onChange={(e) => onChange(Number(e.target.value))}
          onBlur={() => onChange(clamp(value || min))}
          className="tabular w-full min-w-0 bg-transparent py-2 text-lg font-semibold outline-none"
        />
        <div className="flex gap-1">
          {chips.map(([label, fn]) => (
            <button
              key={label}
              type="button"
              disabled={disabled}
              onClick={() => onChange(clamp(fn()))}
              className="rounded-xl bg-[var(--surface-3)] px-2.5 py-2 text-xs font-semibold text-[var(--muted)] transition-colors hover:text-white disabled:opacity-40"
            >
              {label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Radial particle burst for wins. Pure DOM, removed after it plays. */
export function Burst({ trigger, color = "var(--gold)", count = 26 }: { trigger: number; color?: string; count?: number }) {
  const reduce = useReducedMotion();
  const particles = useMemo(
    () =>
      Array.from({ length: count }, (_, i) => {
        const angle = (i / count) * Math.PI * 2 + Math.random() * 0.4;
        const dist = 90 + Math.random() * 120;
        return { x: Math.cos(angle) * dist, y: Math.sin(angle) * dist, s: 4 + Math.random() * 6, r: Math.random() * 360 };
      }),
    // A new set of particles for each trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [trigger, count],
  );
  if (!trigger || reduce) return null;
  return (
    <div key={trigger} className="pointer-events-none absolute inset-0 flex items-center justify-center overflow-visible">
      {particles.map((p, i) => (
        <motion.span
          key={i}
          initial={{ x: 0, y: 0, opacity: 1, scale: 1, rotate: 0 }}
          animate={{ x: p.x, y: p.y, opacity: 0, scale: 0.4, rotate: p.r }}
          transition={{ duration: 1.1, ease: [0.16, 1, 0.3, 1] }}
          className="absolute rounded-sm"
          style={{ width: p.s, height: p.s * 0.6, background: i % 3 === 0 ? "var(--accent-2)" : color }}
        />
      ))}
    </div>
  );
}

/** Result banner shown after a round. */
export function ResultBanner({
  state,
  winLabel,
  loseLabel,
  amount,
  multiplier,
}: {
  state: "win" | "lose" | null;
  winLabel: string;
  loseLabel: string;
  amount: number;
  multiplier: number;
}) {
  return (
    <AnimatePresence mode="wait">
      {state && (
        <motion.div
          key={`${state}-${amount}-${multiplier}`}
          initial={{ opacity: 0, y: 12, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ type: "spring", stiffness: 380, damping: 26 }}
          className={`flex items-center justify-between rounded-2xl px-5 py-4 ${
            state === "win"
              ? "bg-[var(--success-soft)] text-[var(--success)] ring-1 ring-[var(--success)]/30"
              : "bg-[var(--danger-soft)] text-[var(--danger)] ring-1 ring-[var(--danger)]/25"
          }`}
        >
          <div>
            <p className="text-xs font-medium uppercase tracking-widest opacity-80">{state === "win" ? winLabel : loseLabel}</p>
            <p className="font-display mt-1 text-2xl font-semibold tabular">
              {state === "win" ? "+" : ""}
              {formatUsd(amount)}
            </p>
          </div>
          <span className="font-display text-3xl font-bold tabular">×{multiplier}</span>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export interface ToastItem {
  id: number;
  text: string;
  tone: "success" | "error" | "info";
}

export function Toasts({ items }: { items: ToastItem[] }) {
  return (
    <div className="pointer-events-none fixed inset-x-0 top-4 z-50 flex flex-col items-center gap-2 px-4">
      <AnimatePresence>
        {items.map((t) => (
          <motion.div
            key={t.id}
            layout
            initial={{ opacity: 0, y: -20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -12, scale: 0.97 }}
            transition={{ type: "spring", stiffness: 420, damping: 30 }}
            className={`pointer-events-auto max-w-md rounded-2xl border px-4 py-3 text-sm font-medium shadow-2xl backdrop-blur-xl ${
              t.tone === "success"
                ? "border-[var(--success)]/30 bg-[#06221a]/90 text-[var(--success)]"
                : t.tone === "error"
                  ? "border-[var(--danger)]/30 bg-[#2a0a10]/90 text-[var(--danger)]"
                  : "border-[var(--border-strong)] bg-[var(--surface-2)]/90 text-[var(--text)]"
            }`}
          >
            {t.text}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

/** Live "mm:ss" / "h:mm:ss" countdown to a timestamp. */
export function useCountdown(target: string | null): { left: number; label: string } {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!target) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [target]);
  const left = target ? Math.max(0, Math.ceil((new Date(target).getTime() - now) / 1000)) : 0;
  const h = Math.floor(left / 3600);
  const m = Math.floor((left % 3600) / 60);
  const s = left % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return { left, label: h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}` };
}
