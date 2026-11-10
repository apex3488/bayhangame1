// Betting games in chats. Outcomes are decided by the same SQL functions as in the app
// (play_game, mines_*, crash_*); the bot only shows them. Duels are settled atomically in SQL.
import { parseAmount, type ChatCommand } from "../_shared/bot-commands.ts";
import { rpc } from "../_shared/telegram.ts";
import { type Buttons, call, type Ctx, edit, errorText, esc, key, mention, money, n, name, need, reply, resolveAmount } from "./ctx.ts";

const GAME_OF: Record<string, string> = {
  casino: "casino", spin: "spin", slots: "slots", dice: "dice", basketball: "basketball", darts: "darts", bowling: "bowling",
  up: "updown", down: "updown", trade: "trade",
};
const SLOT: Record<string, string> = { cherry: "🍒", lemon: "🍋", orange: "🍊", star: "⭐", diamond: "💎", seven: "7️⃣" };
const EMOJI: Record<string, string> = { casino: "🎰", spin: "🎡", slots: "🎰", dice: "🎲", basketball: "🏀", darts: "🎯", bowling: "🎳", updown: "📈", trade: "💹" };

export const GAMES_HELP =
  `🎲 <b>Игры</b> (ставка: 1000, 5к, 2.5кк, все)\n\n` +
  `🎰 «казино 1к» · 🎡 «спин 1к» · 🎰 «слоты 1к»\n🎲 «кубик 1к 6» — угадай грань\n🏀 «баскетбол 1к» · 🎯 «дартс 1к» · 🎳 «боулинг 1к»\n` +
  `📈 «вверх 1к» / «вниз 1к» — следующее число больше или меньше\n💹 «трейд вверх 1к» — куда пойдёт курс\n` +
  `🚀 «краш 1к 2» — ракета, автовывод на ×2 (можно забрать раньше кнопкой)\n💣 «мины 1к 3» — поле 5×5, 3 мины, открывайте клетки\n` +
  `⚔️ «дуэль 1к» — ответом на сообщение игрока или открытая дуэль для всех`;

const EXAMPLE: Record<string, string> = {
  casino: "казино 1к", spin: "спин 1к", slots: "слоты 1к", dice: "кубик 1к 6", basketball: "баскетбол 1к", darts: "дартс 1к",
  bowling: "боулинг 1к", up: "вверх 1к", down: "вниз 1к", trade: "трейд вверх 1к",
};

function casinoOff(ctx: Ctx) {
  return !ctx.isPrivate && ctx.settings.casino === false;
}

export async function bet(ctx: Ctx, c: ChatCommand) {
  if (casinoOff(ctx)) return reply(ctx, "🎰 Игры на ставки в этом чате выключены администратором. Играйте в личке бота.");
  if (!(await need(ctx))) return;
  const game = GAME_OF[c.cmd];
  let args = [...c.args];
  const choice: Record<string, unknown> = {};
  if (c.cmd === "up" || c.cmd === "down") choice.direction = c.cmd;
  if (game === "trade") {
    const dirIdx = args.findIndex((a) => /^(вверх|вниз|up|down)$/i.test(a));
    if (dirIdx < 0) return reply(ctx, "Трейдинг: «трейд вверх 1к» или «трейд вниз 1к».");
    choice.direction = /^(вверх|up)$/i.test(args[dirIdx]) ? "up" : "down";
    args = args.filter((_, i) => i !== dirIdx);
  }
  if (game === "dice") {
    const pick = Number(args[1]);
    if (!(pick >= 1 && pick <= 6)) return reply(ctx, "Кубик: «кубик 1к 6» — ставка и грань от 1 до 6.");
    choice.pick = pick;
  }
  const amount = await resolveAmount(ctx, parseAmount(args[0]));
  if (!amount) return reply(ctx, `Укажите ставку: «${EXAMPLE[c.cmd]}».`);
  const r = await call(ctx, "play_game", { p_game: game, p_bet: amount, p_choice: choice, p_idempotency_key: key(ctx) });
  if (r.status === "duplicate") return;
  const res = r.result ?? {};
  let show = "";
  if (game === "slots") show = `[ ${(res.reels ?? []).map((x: string) => SLOT[x] ?? x).join(" ")} ]${res.jackpot ? " ДЖЕКПОТ!" : ""}\n`;
  else if (game === "dice") show = `Выпало ${res.value} (ставка на ${res.pick})\n`;
  else if (game === "updown") show = `${res.from} → ${res.to}\n`;
  else if (game === "trade") show = `Курс ${res.open} → ${res.close}\n`;
  else if (["basketball", "darts", "bowling"].includes(game)) show = `Результат броска: ${res.value}\n`;
  else show = `Множитель ×${n(r.multiplier)}\n`;
  const win = n(r.payout) > 0;
  const outcome = win ? `✅ Выигрыш <b>${money(r.payout)}</b> (×${n(r.multiplier)})` : `❌ Проигрыш ${money(r.bet)}`;
  const s = await call(ctx, "get_my_snapshot");
  return reply(ctx, `${EMOJI[game]} ${mention(ctx.from)} · ${name(`game_${game}`, game)}, ставка ${money(r.bet)}\n${show}${outcome}\n💵 Баланс: ${money(s.cash)}`);
}

// ------------------------------------------------------------------ mines ----
function minesBoard(st: any): Buttons {
  const opened = new Set<number>(st.opened ?? []);
  const mines = new Set<number>(st.mine_positions ?? []);
  const done = st.status !== "active";
  const rows: Buttons = [];
  for (let r = 0; r < 5; r++) {
    rows.push([]);
    for (let c = 0; c < 5; c++) {
      const i = r * 5 + c;
      const text = i === st.hit ? "💥" : opened.has(i) ? "💎" : done && mines.has(i) ? "💣" : done ? "▫️" : "❔";
      rows[r].push({ text, callback_data: done || opened.has(i) ? "noop" : `mo:${st.round_id}:${i}` });
    }
  }
  if (!done) rows.push([{ text: n(st.opened?.length) ? `💰 Забрать ${money(st.cashout_value)}` : "Откройте клетку", callback_data: n(st.opened?.length) ? `mc:${st.round_id}` : "noop" }]);
  return rows;
}

function minesText(ctx: { from: { first_name?: string; username?: string; id: number } }, st: any) {
  const who = mention(ctx.from as never);
  if (st.status === "active") {
    return `💣 ${who} · Мины, ставка ${money(st.bet)}, мин: ${st.mines}\nОткрыто: ${st.opened.length} · сейчас ×${n(st.current_multiplier)}` +
      (st.next_multiplier ? ` · следующая ×${n(st.next_multiplier)}` : "");
  }
  return st.outcome === "lost"
    ? `💥 ${who} подорвался(ась) на мине! Ставка ${money(st.bet)} сгорела.`
    : `💰 ${who} забрал(а) <b>${money(st.payout)}</b> (×${n(st.current_multiplier)}) в минах!`;
}

export async function mines(ctx: Ctx, c: ChatCommand) {
  if (casinoOff(ctx)) return reply(ctx, "🎰 Игры на ставки в этом чате выключены администратором.");
  if (!(await need(ctx))) return;
  const active = await call(ctx, "mines_active");
  if (active?.round_id && active.status === "active") return reply(ctx, minesText(ctx, active), minesBoard(active));
  const amount = await resolveAmount(ctx, parseAmount(c.args[0]));
  const count = c.args[1] ? Math.floor(Number(c.args[1])) : 3;
  if (!amount || !(count >= 1 && count <= 24)) return reply(ctx, "Мины: «мины 1к 3» — ставка и число мин (1–24).");
  const st = await call(ctx, "mines_start", { p_bet: amount, p_mines: count, p_idempotency_key: key(ctx) });
  return reply(ctx, minesText(ctx, st), minesBoard(st));
}

/** Mines buttons. The RPC runs as the presser, so only the owner of the round can play it. */
export async function minesButton(ctx: Ctx, data: string, messageId: number): Promise<string | null> {
  const [op, round, cell] = data.split(":");
  try {
    const st = op === "mo" ? await call(ctx, "mines_open", { p_round: round, p_cell: Number(cell) }) : await call(ctx, "mines_cashout", { p_round: round });
    await edit(ctx.chat.id, messageId, minesText(ctx, st), minesBoard(st));
    return st.status === "active" ? null : st.outcome === "lost" ? "💥 Мина!" : `💰 +${money(st.payout)}`;
  } catch (e) {
    const t = errorText(e);
    return /not_found|не найден/i.test(String((e as Error).message)) || t.includes("Не найдено") ? "Это не ваша игра." : t;
  }
}

// ------------------------------------------------------------------ crash ----
const crashText = (who: string, st: any) => {
  if (st.status === "active") return `🚀 ${who} · Краш, ставка ${money(st.bet)}${st.auto ? `, автовывод ×${n(st.auto)}` : ""}\nРакета летит: <b>×${n(st.multiplier).toFixed(2)}</b>`;
  if (st.outcome === "crashed") return `💥 ${who} · Ракета взорвалась на ×${n(st.crash).toFixed(2)}. Ставка ${money(st.bet)} сгорела.`;
  return `🚀 ${who} забрал(а) <b>${money(st.payout)}</b> на ×${n(st.multiplier).toFixed(2)}${st.crash ? ` (ракета упала на ×${n(st.crash).toFixed(2)})` : ""}!`;
};

export async function crash(ctx: Ctx, c: ChatCommand) {
  if (casinoOff(ctx)) return reply(ctx, "🎰 Игры на ставки в этом чате выключены администратором.");
  if (!(await need(ctx))) return;
  const amount = await resolveAmount(ctx, parseAmount(c.args[0]));
  const auto = c.args[1] ? Number(c.args[1].replace(",", ".").replace(/^[xх×]/i, "")) : 2;
  if (!amount || !(auto >= 1.01 && auto <= 1000)) return reply(ctx, "Краш: «краш 1к 2» — ставка и автовывод (от 1.01). Забрать раньше можно кнопкой.");
  const st = await call(ctx, "crash_start", { p_bet: amount, p_auto: auto, p_idempotency_key: key(ctx) });
  const sent = await reply(ctx, crashText(mention(ctx.from), st), [[{ text: "💰 Забрать", callback_data: `cc:${st.round_id}` }]]);
  const messageId: number | undefined = sent?.result?.message_id;
  // Follow the flight in the background: the webhook answers Telegram right away. The round is
  // settled even if the message could not be sent or edited (crash_state settles auto cash-outs).
  const follow = (async () => {
    let last = "";
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 1500));
      let s: any;
      try {
        s = await call(ctx, "crash_state", { p_round: st.round_id });
      } catch {
        return;
      }
      const text = crashText(mention(ctx.from), s);
      if (messageId && text !== last) {
        await edit(ctx.chat.id, messageId, text, s.status === "active" ? [[{ text: "💰 Забрать", callback_data: `cc:${st.round_id}` }]] : undefined);
        last = text;
      }
      if (s.status !== "active") return;
    }
  })();
  waitUntil(follow);
}

export async function crashButton(ctx: Ctx, data: string, messageId: number): Promise<string> {
  try {
    const st = await call(ctx, "crash_cashout", { p_round: data.split(":")[1] });
    await edit(ctx.chat.id, messageId, crashText(mention(ctx.from), st));
    return st.outcome === "crashed" ? "💥 Не успели" : `💰 +${money(st.payout)}`;
  } catch (e) {
    return /not_found/i.test(String((e as Error).message)) ? "Это не ваша ракета." : errorText(e);
  }
}

/** Keeps the Edge Function alive for background work after the response is sent. */
export function waitUntil(p: Promise<unknown>) {
  // deno-lint-ignore no-explicit-any
  const rt = (globalThis as any).EdgeRuntime;
  if (rt?.waitUntil) rt.waitUntil(p);
}

// ------------------------------------------------------------------- duel ----
export async function duel(ctx: Ctx, c: ChatCommand) {
  if (ctx.isPrivate) return reply(ctx, "⚔️ Дуэли проходят в группах: добавьте бота в чат и напишите «дуэль 1к».");
  if (ctx.settings.party === false) return reply(ctx, "Дуэли в этом чате выключены администратором.");
  if (!(await need(ctx))) return;
  const amount = await resolveAmount(ctx, parseAmount(c.args[0]));
  if (!amount) return reply(ctx, "Дуэль: «дуэль 1к» (ответом на сообщение игрока — вызов ему лично).");
  const target = ctx.replyTo && !ctx.replyTo.is_bot ? ctx.replyTo : null;
  const d = await rpc<any>("tg_duel_create", { p_tg: ctx.from.id, p_chat: ctx.chat.id, p_amount: amount, p_target_tg: target?.id ?? null });
  return reply(ctx, `⚔️ ${mention(ctx.from)} вызывает на дуэль ${target ? mention(target) : "любого желающего"}! Ставка <b>${money(amount)}</b>, победитель забирает всё. 10 минут на ответ.`,
    [[{ text: "⚔️ Принять", callback_data: `da:${d.id}` }, { text: "✖️ Отменить", callback_data: `dc:${d.id}` }]]);
}

export async function duelButton(ctx: Ctx, data: string, messageId: number): Promise<string> {
  const [op, id] = data.split(":");
  try {
    if (op === "dc") {
      await rpc("tg_duel_cancel", { p_id: id, p_tg: ctx.from.id });
      await edit(ctx.chat.id, messageId, "⚔️ Дуэль отменена.");
      return "Отменено";
    }
    const r = await rpc<any>("tg_duel_accept", { p_id: id, p_tg: ctx.from.id });
    await edit(ctx.chat.id, messageId, `⚔️ Дуэль на ${money(r.amount)}!\n\n🏆 Победитель: <b>${esc(r.winner)}</b>\n💀 Проигравший: ${esc(r.loser)}`);
    return "Дуэль сыграна!";
  } catch (e) {
    if (String((e as Error).message).includes("telegram_not_linked")) return "Сначала создайте аккаунт: напишите боту в личку.";
    return errorText(e);
  }
}
