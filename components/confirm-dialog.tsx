"use client";

import { AnimatePresence, motion } from "motion/react";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "./ui";

export interface ConfirmOptions {
  title: string;
  message?: string;
  confirmLabel: string;
  cancelLabel: string;
  danger?: boolean;
  /** Asks for text (e.g. a reason); the promise resolves with it. */
  input?: { placeholder: string; minLength: number };
}

type Resolver = (value: string | boolean) => void;

const Ctx = createContext<((o: ConfirmOptions) => Promise<string | boolean>) | null>(null);

/**
 * In-app replacement for window.confirm/prompt, which embedded browsers and some
 * popup blockers suppress (confirm() silently returns false there).
 */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [opts, setOpts] = useState<ConfirmOptions | null>(null);
  const [text, setText] = useState("");
  const resolver = useRef<Resolver | null>(null);

  const ask = useCallback((o: ConfirmOptions) => {
    setText("");
    setOpts(o);
    return new Promise<string | boolean>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  const close = useCallback((value: string | boolean) => {
    resolver.current?.(value);
    resolver.current = null;
    setOpts(null);
  }, []);

  useEffect(() => {
    if (!opts) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [opts, close]);

  const valid = !opts?.input || text.trim().length >= opts.input.minLength;

  return (
    <Ctx.Provider value={ask}>
      {children}
      <AnimatePresence>
        {opts && (
          <motion.div
            className="fixed inset-0 z-[60] grid place-items-center bg-black/70 p-4 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => close(false)}
          >
            <motion.form
              initial={{ scale: 0.94, y: 12, opacity: 0 }}
              animate={{ scale: 1, y: 0, opacity: 1 }}
              exit={{ scale: 0.96, opacity: 0 }}
              transition={{ type: "spring", stiffness: 380, damping: 28 }}
              onClick={(e) => e.stopPropagation()}
              onSubmit={(e) => {
                e.preventDefault();
                if (valid) close(opts.input ? text.trim() : true);
              }}
              className="panel w-full max-w-md p-6"
            >
              <div className="flex items-start gap-3">
                <div className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${opts.danger ? "bg-[var(--danger-soft)] text-[var(--danger)]" : "bg-[var(--accent-soft)] text-[var(--accent-2)]"}`}>
                  <AlertTriangle size={18} />
                </div>
                <div className="min-w-0">
                  <p className="font-display text-lg font-semibold">{opts.title}</p>
                  {opts.message && <p className="mt-1 whitespace-pre-line break-words text-sm text-[var(--muted)]">{opts.message}</p>}
                </div>
              </div>
              {opts.input && (
                <input
                  autoFocus
                  value={text}
                  maxLength={200}
                  onChange={(e) => setText(e.target.value)}
                  placeholder={opts.input.placeholder}
                  className="mt-4 w-full rounded-xl border border-[var(--border)] bg-[var(--bg-2)] px-3 py-2.5 text-sm outline-none focus:border-[var(--accent)]"
                />
              )}
              <div className="mt-6 grid grid-cols-2 gap-2">
                <Button type="button" variant="ghost" onClick={() => close(false)}>
                  {opts.cancelLabel}
                </Button>
                <Button type="submit" variant={opts.danger ? "danger" : "primary"} disabled={!valid} autoFocus={!opts.input}>
                  {opts.confirmLabel}
                </Button>
              </div>
            </motion.form>
          </motion.div>
        )}
      </AnimatePresence>
    </Ctx.Provider>
  );
}

export function useConfirm() {
  const ask = useContext(Ctx);
  if (!ask) throw new Error("useConfirm must be used inside ConfirmProvider");
  return ask;
}
