// Chat extras: the button menu, the chat lottery and giveaways. Money moves only inside SQL
// (tg_lottery_*, tg_giveaway_*), atomically and with idempotency keys.
import { parseAmount, type ChatCommand } from "../_shared/bot-commands.ts";
import { rpc } from "../_shared/telegram.ts";
import { type Buttons, type Ctx, edit, errorText, esc, mention, money, n, need, reply, resolveAmount, send } from "./ctx.ts";

/** Main menu: every button runs the same command as typing it (callback c:<command>). */
export const MENU_BUTTONS: Buttons = [
  [{ text: "💰 Баланс", callback_data: "c:balance" }, { text: "👤 Профиль", callback_data: "c:profile" }],
  [{ text: "🎁 Бонус", callback_data: "c:daily" }, { text: "🛠 Работа", callback_data: "c:work" }],
  [{ text: "🏦 Банк", callback_data: "c:bank" }, { text: "₿ Биткоин", callback_data: "c:btc" }],
  [{ text: "🛒 Магазин", callback_data: "c:shop" }, { text: "📦 Имущество", callback_data: "c:assets" }],
  [{ text: "⛏ Добыча", callback_data: "c:mine" }, { text: "🎁 Кейсы", callback_data: "c:cases" }],
  [{ text: "📋 Задания", callback_data: "c:quests" }, { text: "🏆 Топ", callback_data: "c:top" }],
  [{ text: "🎲 Игры", callback_data: "c:games" }, { text: "🎭 Мини-игры", callback_data: "c:party" }],
  [{ text: "🎟 Лотерея", callback_data: "c:lottery" }, { text: "🏢 Корпорация", callback_data: "c:corp" }],
  [{ text: "ℹ️ Все команды", callback_data: "c:help" }],
];

export function menu(ctx: Ctx) {
  return reply(ctx, `👑 <b>BAYHAN GAME</b> — меню\nНажмите раздел или пишите команды прямо в чат.`, MENU_BUTTONS);
}

// -------------------------------------------------------------- lottery ----
const timeLeft = (iso: string) => {
  const s = Math.max(0, Math.round((new Date(iso).getTime() - Date.now()) / 1000));
  return s >= 60 ? `${Math.floor(s / 60)} мин ${s % 60} с` : `${s} с`;
};

export async function lottery(ctx: Ctx, c: ChatCommand) {
  if (ctx.isPrivate) return reply(ctx, "🎟 Лотерея проходит в групповых чатах: «лотерея 1к» — поставить, «лотерея» — банк.");
  if (ctx.settings.casino === false) return reply(ctx, "🎰 Ставки в этом чате выключены администратором.");
  if (!c.args[0]) {
    const st = await rpc<any>("tg_lottery_status", { p_chat: ctx.chat.id });
    if (!st) return reply(ctx, "🎟 <b>Лотерея чата</b>\n\nСейчас банк пуст. Первая ставка запускает розыгрыш: «лотерея 1к». Шанс — пропорционально ставке, победитель забирает банк (комиссия 5%).");
    return reply(ctx, `🎟 <b>Лотерея чата</b> · банк <b>${money(st.pot)}</b>\nРозыгрыш через ${timeLeft(st.draw_at)}\n\n` +
      (st.bets as any[]).map((b) => `• ${esc(b.name)} — ${money(b.amount)} (${Math.round((n(b.amount) / n(st.pot)) * 100)}%)`).join("\n") +
      `\n\nПоставить: «лотерея 1к»`);
  }
  if (!(await need(ctx))) return;
  const amount = await resolveAmount(ctx, parseAmount(c.args[0]));
  if (!amount) return reply(ctx, "Ставка в лотерее: «лотерея 1к».");
  const r = await rpc<any>("tg_lottery_buy", { p_tg: ctx.from.id, p_chat: ctx.chat.id, p_amount: amount });
  return reply(ctx, `🎟 ${mention(ctx.from)} ставит ${money(amount)} в лотерею. Банк: <b>${money(r.pot)}</b>, участников: ${r.players}, ` +
    `ваш шанс ${Math.round((n(r.mine) / n(r.pot)) * 100)}%. Розыгрыш через ${timeLeft(r.draw_at)}.`);
}

// ------------------------------------------------------------ giveaways ----
export async function giveaway(ctx: Ctx, c: ChatCommand) {
  if (ctx.isPrivate) return reply(ctx, "🎁 Раздачи проводятся в групповых чатах: «раздача 10к 5» — 10к поровну первым 5 игрокам.");
  if (!(await need(ctx))) return;
  const total = await resolveAmount(ctx, parseAmount(c.args[0]));
  const shares = Math.floor(Number(c.args[1] ?? 1));
  if (!total || !(shares >= 1 && shares <= 100)) return reply(ctx, "Раздача: «раздача 10к 5» — сумма и число участников (1–100).");
  const g = await rpc<any>("tg_giveaway_create", { p_tg: ctx.from.id, p_chat: ctx.chat.id, p_total: total, p_shares: shares });
  return reply(ctx, `🎁 ${mention(ctx.from)} раздаёт <b>${money(g.total)}</b>! По ${money(g.share)} первым ${g.shares} игрокам. 30 минут.`,
    [[{ text: `🎁 Забрать ${money(g.share)}`, callback_data: `gv:${g.id}` }]]);
}

export async function giveawayButton(ctx: Ctx, data: string, messageId: number): Promise<string> {
  try {
    const r = await rpc<any>("tg_giveaway_claim", { p_id: data.slice(3), p_tg: ctx.from.id });
    if (r.left <= 0) await edit(ctx.chat.id, messageId, `🎁 Раздача разобрана! Последнюю долю забрал(а) ${esc(r.name)}.`);
    return `+${money(r.share)}! Осталось долей: ${r.left}.`;
  } catch (e) {
    if (String((e as Error).message).includes("telegram_not_linked")) return "Сначала создайте аккаунт: напишите «б» или «меню».";
    return errorText(e);
  }
}

/** Timer work for chats: lottery draws and expired giveaways. */
export async function tick() {
  const draws = await rpc<any[]>("tg_lottery_draw_due", {});
  for (const d of draws ?? []) {
    if (d.refunded) await send(d.chat_id, `🎟 Лотерея: участник был один — ставка ${money(d.pot)} возвращена.`);
    else {
      const who = d.winner_tg ? `<a href="tg://user?id=${d.winner_tg}">${esc(d.winner)}</a>` : esc(d.winner);
      await send(d.chat_id, `🎟 <b>Розыгрыш лотереи!</b>\n\nБанк ${money(d.pot)}, участников: ${d.players}.\n🏆 Победитель: ${who} (шанс был ${d.chance}%) — <b>+${money(d.payout)}</b>!`);
    }
  }
  const expired = await rpc<any[]>("tg_giveaway_expire_due", {});
  for (const g of expired ?? []) {
    if (n(g.refunded) > 0) await send(g.chat_id, `🎁 Раздача закончилась: разобрано ${g.claimed} из ${g.shares}, остаток ${money(g.refunded)} вернулся автору.`);
  }
}
