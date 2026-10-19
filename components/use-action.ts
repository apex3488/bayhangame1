"use client";

import { useCallback, useState } from "react";
import { newIdempotencyKey } from "@/lib/game";
import { useGame } from "./game-context";

/**
 * Runs a server action with a fresh idempotency key, shows errors as toasts and
 * refreshes the balance afterwards. `busy` holds the id of the running action.
 */
export function useAction() {
  const { refresh, toast, toastError } = useGame();
  const [busy, setBusy] = useState<string | null>(null);

  const run = useCallback(
    async <T,>(id: string, fn: (key: string) => Promise<T>, success?: (r: T) => string | null): Promise<T | null> => {
      setBusy(id);
      try {
        const res = await fn(newIdempotencyKey());
        const msg = success?.(res);
        if (msg) toast(msg, "success");
        refresh();
        return res;
      } catch (e) {
        toastError(e);
        return null;
      } finally {
        setBusy(null);
      }
    },
    [refresh, toast, toastError],
  );

  return { busy, run };
}
