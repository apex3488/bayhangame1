// Per-update context shared by all bot handlers: where to answer, who is acting, and how to call
// the game as that player. Game operations always go through public.tg_rpc(), i.e. the same SQL
// functions the browser calls, so the bot never computes money itself.
import { GameError, linkedUser, MINI_APP_URL, money, rpc, tg, type TgUser } from "../_shared/telegram.ts";
import { NAMES } from "../_shared/names.ts";

export interface Ctx {
  chat: { id: number; type: string; title?: string };
  from: TgUser;
  /** The message that triggered this update (answers reply to it in groups). */
  messageId?: number;
  /** Author of the message this one replies to ("перевод 100" in reply to someone). */
  replyTo?: TgUser;
  updateId: number;
  isPrivate: boolean;
  settings: { casino: boolean; party: boolean };
}

export const esc = (s: unknown) => String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);
export { money };
export const n = (v: unknown) => Number(v ?? 0);
export const name = (key: string, fallback = key) => NAMES[key] ?? fallback;
/** A clickable mention that works without @username. */
export const mention = (u: TgUser) => `<a href="tg://user?id=${u.id}">${esc(u.first_name || u.username || "игрок")}</a>`;

export type Buttons = { text: string; callback_data?: string; url?: string; web_app?: { url: string } }[][];

export function send(chatId: number, text: string, buttons?: Buttons | object, replyTo?: number) {
  return tg("sendMessage", {
    chat_id: chatId, text, parse_mode: "HTML", link_preview_options: { is_disabled: true },
    ...(replyTo ? { reply_parameters: { message_id: replyTo, allow_sending_without_reply: true } } : {}),
    ...(buttons ? { reply_markup: Array.isArray(buttons) ? { inline_keyboard: buttons } : buttons } : {}),
  });
}

/** Answer in the same chat; in groups as a reply to the command. */
export const reply = (ctx: Ctx, text: string, buttons?: Buttons | object) =>
  send(ctx.chat.id, text, buttons, ctx.isPrivate ? undefined : ctx.messageId);

export function edit(chatId: number, messageId: number, text: string, buttons?: Buttons) {
  return tg("editMessageText", {
    chat_id: chatId, message_id: messageId, text, parse_mode: "HTML", link_preview_options: { is_disabled: true },
    ...(buttons ? { reply_markup: { inline_keyboard: buttons } } : {}),
  });
}

/** The game's own Russian error text for a server error code. */
export function errorText(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  const code = msg.match(/[a-z_]{4,}/g)?.find((c) => NAMES[`err_${c}`] || EXTRA_ERRORS[c]) ?? "";
  return EXTRA_ERRORS[code] ?? NAMES[`err_${code}`] ?? "⚠️ Сервер игры временно недоступен. Попробуйте ещё раз.";
}

const EXTRA_ERRORS: Record<string, string> = {
  telegram_not_linked: "Сначала создайте аккаунт: напишите «старт» боту в личку или нажмите кнопку ниже.",
  duel_pending: "У вас уже есть открытая дуэль.",
  duel_closed: "Эта дуэль уже закрыта.",
  duel_self: "Нельзя сражаться с самим собой.",
  duel_not_for_you: "Эта дуэль предназначена другому игроку.",
  opponent_insufficient_funds: "У соперника уже не хватает денег на дуэль.",
  forbidden: "Недостаточно прав.",
  unknown_operation: "Такой операции нет.",
  round_already_active: "У вас уже идёт раунд этой игры. Закончите его.",
  use_mines_rpc: "Для мин используйте команду «мины».",
  invalid_choice: "Неверный выбор.",
  invalid_amount: "Неверная сумма.",
  game_disabled: "Эта игра сейчас выключена.",
  bet_too_low: "Ставка меньше минимальной.",
  bet_too_high: "Ставка больше максимальной.",
};

/** Calls a player RPC as the Telegram user (the same function the browser calls). */
export async function call<T = any>(ctx: Ctx | number, fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const tgId = typeof ctx === "number" ? ctx : ctx.from.id;
  return await rpc<T>("tg_rpc", { p_tg: tgId, p_fn: fn, p_args: args });
}

/** Unique per update: a Telegram retry of the same update reuses it, so nothing runs twice. */
export const key = (ctx: Ctx, tag = "") => `tg-${ctx.chat.id}-${ctx.updateId}${tag ? `-${tag}` : ""}`.slice(0, 80);

const linkedCache = new Map<number, boolean>();
/** True if the user has a game account; otherwise answers with a one-tap registration button. */
export async function need(ctx: Ctx): Promise<boolean> {
  if (linkedCache.get(ctx.from.id)) return true;
  const ok = Boolean(await linkedUser(ctx.from.id));
  if (ok) {
    linkedCache.set(ctx.from.id, true);
    return true;
  }
  await reply(ctx, `${mention(ctx.from)}, у вас ещё нет аккаунта BAYHAN GAME. Создайте его одним нажатием — ` +
    `стартовый капитал $50,000 сразу на счету. Уже играете в браузере? Привяжите аккаунт в личке бота.`,
    [[{ text: "🆕 Создать аккаунт", callback_data: "reg" }], ...(ctx.isPrivate ? [[{ text: "🔗 У меня есть аккаунт", callback_data: "howlink" }]] : [])]);
  return false;
}
export const forgetLinked = (tgId: number) => linkedCache.delete(tgId);

/** Resolves "все" against the player's cash. */
export async function resolveAmount(ctx: Ctx, a: { all: true } | { all: false; value: number } | null): Promise<number | null> {
  if (!a) return null;
  if (!a.all) return a.value;
  const s = await call(ctx, "get_my_snapshot");
  const v = Math.floor(n(s.cash) * 100) / 100;
  return v > 0 ? v : null;
}

export const playButton = (text = "🎮 Открыть игру") => [[{ text, web_app: { url: MINI_APP_URL } }]];
/** Mini App buttons work only in private chats; in groups a t.me link opens the bot instead. */
export const openGame = (ctx: Ctx, botUsername: string) =>
  ctx.isPrivate ? playButton() : [[{ text: "🎮 Открыть игру", url: `https://t.me/${botUsername}?start=play` }]];

export { GameError };
