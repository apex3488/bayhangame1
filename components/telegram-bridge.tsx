"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { loadTelegram, type TgWebApp } from "@/lib/telegram";

const BG = "#05060a";
/** Screens where Telegram's own close button is the way out instead of "Back". */
const ROOTS = new Set(["/", "/tg", "/login"]);

/**
 * Adapts the game to the Telegram Mini App container. Does nothing in a normal browser.
 * Colours match the game, the app opens expanded (full screen on phones), vertical swipes no
 * longer close it mid-scroll, Telegram's Back button follows the in-game history, and the safe
 * areas are exposed as --tg-top / --tg-bottom for the header and bottom navigation.
 */
export function TelegramBridge() {
  const [wa, setWa] = useState<TgWebApp | null>(null);
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    let app: TgWebApp | null = null;
    const root = document.documentElement;
    const applyInsets = () => {
      if (!app) return;
      const full = Boolean(app.isFullscreen);
      const top = full ? (app.safeAreaInset?.top ?? 0) + (app.contentSafeAreaInset?.top ?? 0) : 0;
      root.style.setProperty("--tg-top", `${top}px`);
      root.style.setProperty("--tg-bottom", `${app.safeAreaInset?.bottom ?? 0}px`);
    };
    const events = ["safeAreaChanged", "contentSafeAreaChanged", "fullscreenChanged", "viewportChanged"];
    loadTelegram().then((x) => {
      if (!x) return;
      app = x;
      root.classList.add("tg-app");
      x.ready();
      x.expand();
      if (x.isVersionAtLeast("6.1")) {
        x.setHeaderColor(BG);
        x.setBackgroundColor(BG);
      }
      if (x.isVersionAtLeast("7.10")) x.setBottomBarColor?.(BG);
      if (x.isVersionAtLeast("7.7")) x.disableVerticalSwipes?.();
      // Full screen only on phones; on desktop clients a windowed Mini App is the expected look.
      if (x.isVersionAtLeast("8.0") && (x.platform === "android" || x.platform === "ios")) x.requestFullscreen?.();
      events.forEach((e) => x.onEvent(e, applyInsets));
      applyInsets();
      setWa(x);
    });
    return () => {
      if (app) events.forEach((e) => app!.offEvent(e, applyInsets));
    };
  }, []);

  useEffect(() => {
    if (!wa || !wa.isVersionAtLeast("6.1")) return;
    const back = () => router.back();
    if (ROOTS.has(pathname)) wa.BackButton.hide();
    else wa.BackButton.show();
    wa.BackButton.onClick(back);
    return () => wa.BackButton.offClick(back);
  }, [wa, pathname, router]);

  return null;
}
