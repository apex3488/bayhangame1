import { getSupabase } from "./supabase";

/** The subset of Telegram.WebApp (core.telegram.org/bots/webapps) the game uses. */
export interface TgWebApp {
  initData: string;
  version: string;
  platform: string;
  isFullscreen?: boolean;
  safeAreaInset?: { top: number; bottom: number; left: number; right: number };
  contentSafeAreaInset?: { top: number; bottom: number; left: number; right: number };
  isVersionAtLeast(v: string): boolean;
  ready(): void;
  expand(): void;
  requestFullscreen?(): void;
  disableVerticalSwipes?(): void;
  setHeaderColor(c: string): void;
  setBackgroundColor(c: string): void;
  setBottomBarColor?(c: string): void;
  onEvent(e: string, cb: () => void): void;
  offEvent(e: string, cb: () => void): void;
  openTelegramLink(url: string): void;
  BackButton: { show(): void; hide(): void; onClick(cb: () => void): void; offClick(cb: () => void): void };
  HapticFeedback?: { notificationOccurred(t: "success" | "error" | "warning"): void };
}

declare global {
  interface Window {
    Telegram?: { WebApp: TgWebApp };
  }
}

export const BOT_USERNAME = process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME || "BayhanGame2_bot";
export const BOT_URL = `https://t.me/${BOT_USERNAME}`;
const SDK_URL = "https://telegram.org/js/telegram-web-app.js";
const FLAG = "bayhan:tg";

/**
 * True when the page was opened as a Telegram Mini App. Telegram passes its launch data in the URL
 * fragment (#tgWebAppData=...) on the first load; the flag keeps it across in-app reloads.
 * Plain browser visitors never load the Telegram SDK.
 */
export function isTelegramLaunch(): boolean {
  if (typeof window === "undefined") return false;
  try {
    if (window.location.hash.includes("tgWebAppData")) {
      sessionStorage.setItem(FLAG, "1");
      return true;
    }
    return sessionStorage.getItem(FLAG) === "1";
  } catch {
    return window.location.hash.includes("tgWebAppData");
  }
}

let sdk: Promise<TgWebApp | null> | null = null;

/** Loads the Telegram SDK once (only inside Telegram); resolves null in a normal browser. */
export function loadTelegram(): Promise<TgWebApp | null> {
  if (!isTelegramLaunch()) return Promise.resolve(null);
  if (!sdk) {
    sdk = new Promise((resolve) => {
      const done = () => {
        const wa = window.Telegram?.WebApp;
        resolve(wa && wa.initData ? wa : null);
      };
      if (window.Telegram?.WebApp) return done();
      const s = document.createElement("script");
      s.src = SDK_URL;
      s.async = true;
      s.onload = done;
      s.onerror = () => resolve(null);
      document.head.appendChild(s);
      setTimeout(done, 8000);
    });
  }
  return sdk;
}

type AuthReply =
  | { status: "ok"; user_id: string; token_hash?: string; created?: boolean }
  | { status: "not_linked"; telegram: { first_name: string; username: string } };

/** Calls the telegram-auth Edge Function; the server verifies initData with the bot token. */
export async function telegramAuth(
  action: "session" | "register" | "link",
  initData: string,
  extra: Record<string, unknown> = {},
  accessToken?: string,
): Promise<AuthReply> {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";
  const res = await fetch(`${base}/functions/v1/telegram-auth`, {
    method: "POST",
    headers: { "content-type": "application/json", apikey: key, ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}) },
    body: JSON.stringify({ action, initData, ...extra }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `http_${res.status}`);
  return body as AuthReply;
}

/** Exchanges the single-use token from telegram-auth for a normal Supabase session. */
export async function signInWithTelegramToken(tokenHash: string) {
  const { error } = await getSupabase().auth.verifyOtp({ token_hash: tokenHash, type: "magiclink" });
  if (error) throw new Error(error.message);
}
