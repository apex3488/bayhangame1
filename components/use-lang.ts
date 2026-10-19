"use client";

import { useCallback, useEffect, useState } from "react";
import { LANGS, type Lang } from "@/lib/i18n";

const STORAGE_KEY = "bayhan.lang";

function readStoredLang(): Lang {
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    if (v && (LANGS as string[]).includes(v)) return v as Lang;
  } catch {
    // Storage may be blocked (private mode); fall back to default.
  }
  return "ru";
}

/** UI language preference. Stored only in the browser; it holds no game state. */
export function useLang(): [Lang, (l: Lang) => void] {
  const [lang, setLangState] = useState<Lang>("ru");

  useEffect(() => {
    setLangState(readStoredLang());
  }, []);

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    try {
      window.localStorage.setItem(STORAGE_KEY, l);
    } catch {
      // ignore
    }
  }, []);

  return [lang, setLang];
}

export function formatUsd(value: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(value);
}
