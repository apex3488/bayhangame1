"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { fetchSnapshot, type Snapshot } from "@/lib/game";
import { fetchLoadout, type Loadout } from "@/lib/economy";
import { t as translate, errorText, type Lang } from "@/lib/i18n";
import { errorKey } from "@/lib/game";
import { Toasts, type ToastItem } from "./ui";
import { useLang } from "./use-lang";
import { ConfirmProvider, useConfirm } from "./confirm-dialog";
import { VictoryProvider } from "./victory";

interface GameCtx {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: string) => string;
  snapshot: Snapshot | null;
  refresh: () => Promise<void>;
  /** Equipped cosmetics; drives the theme colour, avatar frame and name style. */
  loadout: Loadout;
  refreshLoadout: () => Promise<void>;
  toast: (text: string, tone?: ToastItem["tone"]) => void;
  /** Shows the localized message for a failed RPC. */
  toastError: (e: unknown) => void;
}

const Ctx = createContext<GameCtx | null>(null);

export function GameProvider({ children }: { children: ReactNode }) {
  const [lang, setLang] = useLang();
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const toast = useCallback((text: string, tone: ToastItem["tone"] = "info") => {
    const id = nextId.current++;
    setToasts((list) => [...list.slice(-2), { id, text, tone }]);
    setTimeout(() => setToasts((list) => list.filter((x) => x.id !== id)), 3600);
  }, []);

  const refresh = useCallback(async () => {
    try {
      setSnapshot(await fetchSnapshot());
    } catch {
      // Keep the last known snapshot; pages show their own load errors.
    }
  }, []);

  const [loadout, setLoadout] = useState<Loadout>({});
  const refreshLoadout = useCallback(async () => {
    try {
      setLoadout((await fetchLoadout()) ?? {});
    } catch {
      // Cosmetics are decorative; keep the last known loadout.
    }
  }, []);

  useEffect(() => {
    refresh();
    refreshLoadout();
  }, [refresh, refreshLoadout]);

  const t = useCallback((key: string) => translate(lang, key), [lang]);
  const toastError = useCallback(
    (e: unknown) => toast(errorText(lang, errorKey(e instanceof Error ? e.message : String(e))), "error"),
    [lang, toast],
  );

  return (
    <Ctx.Provider value={{ lang, setLang, t, snapshot, refresh, loadout, refreshLoadout, toast, toastError }}>
      <ConfirmProvider>
        <VictoryProvider labels={{ win: t("victory"), mega: t("megaVictory"), tap: t("tapToContinue") }}>{children}</VictoryProvider>
      </ConfirmProvider>
      <Toasts items={toasts} />
    </Ctx.Provider>
  );
}

export function useGame(): GameCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useGame must be used inside GameProvider");
  return ctx;
}

/** Localised confirmation: resolves true / the entered text, or false when cancelled. */
export function useAsk() {
  const confirm = useConfirm();
  const { t } = useGame();
  return useCallback(
    (title: string, o: { message?: string; danger?: boolean; input?: { placeholder: string; minLength: number } } = {}) =>
      confirm({ title, message: o.message, danger: o.danger, input: o.input, confirmLabel: t("confirm"), cancelLabel: t("cancel") }),
    [confirm, t],
  );
}
