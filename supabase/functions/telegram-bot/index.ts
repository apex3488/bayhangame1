// BAYHAN GAME bot (@BayhanGame2_bot): Telegram webhook for private chats and groups.
// Every number it shows and every reward it gives comes from the game's SQL functions (through
// public.tg_rpc), i.e. the same rules as the browser game and the Mini App. No balances live here.
//
// Speed: the webhook is pinned to the database region (?forceFunctionRegion=ap-southeast-1), one
// tg_begin call covers dedupe, rate limit, chat bookkeeping and the account lookup, and the first
// reply goes back as the webhook response instead of a separate call to Telegram.
import { BTN, parseChat, parseCommand, type ChatCommand } from "../_shared/bot-commands.ts";
import { BOT_USERNAME, config, ensurePlayer, GameError, MINI_APP_URL, rpc, SITE_URL, tg, type TgUser } from "../_shared/telegram.ts";
import { type Ctx, errorText, esc, forgetLinked, mention, reply, send } from "./ctx.ts";
import * as economy from "./economy.ts";
import * as games from "./games.ts";
import * as party from "./party-io.ts";
import * as chatx from "./chat.ts";
import * as adminPanel from "./admin.ts";

const MENU = {
  keyboard: [
    [{ text: BTN.play }],
    [{ text: BTN.profile }, { text: BTN.balance }],
    [{ text: BTN.daily }, { text: BTN.top }],
    [{ text: BTN.tasks }, { text: BTN.invite }],
    [{ text: BTN.help }],
  ],
  resize_keyboard: true,
  is_persistent: true,
};
const playButton = (text = BTN.play) => ({ inline_keyboard: [[{ text, web_app: { url: MINI_APP_URL } }]] });
/** Private-chat menu buttons → chat commands. */
const MENU_TO_CHAT: Record<string, string> = {
  "/profile": "profile", "/balance": "balance", "/daily": "daily", "/top": "top", "/tasks": "quests", "/invite": "invite", "/help": "help", "/play": "play",
};

const HELP =
  `ℹ️ <b>BAYHAN GAME — команды</b>\nПишите прямо в чат, можно без «/». Сумма: 1000, 5к, 2.5кк, все. Кнопки — «меню».\n\n` +
  `💰 «б» баланс · «профиль» · «бонус» · «топ» · «топ чата»\n🛠 «работа» · «работа курьер»\n` +
  `🏦 «банк» · «положить 10к» · «снять все» · «вклад 100к 30» · «btc» · «купить btc 10к»\n` +
  `💸 «перевод 1к» (ответом на сообщение) · «перевод Ник 1к»\n` +
  `🛒 «магазин» · «машины» · «недвижимость» · «бизнесы» · «роскошь» · «купить Частный остров» · «продать …» · «улучшить …» · «собрать» · «имущество»\n` +
  `⛏ «добыча» · «ресурсы» · «продать дерево все» · 🎁 «кейсы» · «кейс Золотой» · 🎟 «промо КОД»\n` +
  `📋 «задания» · «забрать» · 👥 «пригласить» · ✏️ «ник Имя» · 👑 «вип» · 🎉 «события» · 📜 «история»\n` +
  `🏢 «корпа» · «корпа создать Имя» · «топ корп» · 💍 «брак» (ответом) · «развод»\n` +
  `🎟 «лотерея» · «лотерея 1к» · 🎁 «раздача 10к 5»\n\n` +
  `${games.GAMES_HELP}\n\n${party.HELP}\n\n` +
  `⚙️ «настройки» — админ чата включает/выключает ставки и мини-игры.\n🌐 Игра в браузере: ${SITE_URL}`;

// ------------------------------------------------------------- private ----
async function welcomeNew(ctx: Ctx, ref: string) {
  await reply(
    ctx,
    `<b>Добро пожаловать в BAYHAN GAME!</b> 👑\n\nЭкономическая игра: работай, открывай бизнес, покупай машины и острова, ` +
      `играй в Crash и Мины, Мафию и Шпиона в чатах с друзьями. Только игровая валюта.\n\n` +
      `Уже играете в браузере? Привяжите аккаунт — прогресс и баланс будут общими.`,
    [
      [{ text: "🆕 Создать аккаунт", callback_data: ref ? `reg:${ref}` : "reg" }],
      [{ text: "🔗 У меня уже есть аккаунт", callback_data: "howlink" }],
      [{ text: BTN.play, web_app: { url: MINI_APP_URL } }],
      [{ text: "➕ Добавить бота в чат", url: `https://t.me/${BOT_USERNAME}?startgroup=play` }],
    ],
  );
}

const HOW_LINK =
  `🔗 <b>Привязка аккаунта из браузера</b>\n\n1. Откройте игру в браузере: ${SITE_URL}\n2. Профиль → «Привязать Telegram»\n` +
  `3. Нажмите «Открыть бота» — привязка произойдёт сама.\n\nИли откройте ${BTN.play}, выберите «У меня есть аккаунт» и войдите по логину и паролю.`;

async function start(ctx: Ctx, arg: string) {
  if (!ctx.isPrivate) return chatx.menu(ctx);
  if (arg.startsWith("link_")) {
    const r = await rpc<any>("tg_consume_link_code", { p_code: arg.slice(5), p_tg: ctx.from.id, p_username: ctx.from.username ?? null, p_first_name: ctx.from.first_name ?? null });
    forgetLinked(ctx.from.id);
    ctx.linked = true;
    await send(ctx.chat.id, `✅ Аккаунт <b>${esc(r.game_name)}</b> привязан к Telegram. Баланс и прогресс общие с браузером.`, MENU);
    return economy.profile(ctx);
  }
  if (!ctx.linked) return welcomeNew(ctx, arg.startsWith("ref_") ? arg.slice(4) : "");
  if (arg === "play") return reply(ctx, "Игра открывается прямо в Telegram 👇", playButton("🎮 Открыть BAYHAN GAME"));
  await send(ctx.chat.id, `👑 <b>С возвращением в BAYHAN GAME!</b>\nНапишите «меню» или «помощь».`, MENU);
  return economy.profile(ctx);
}

// --------------------------------------------------------------- router ----
async function onCommand(ctx: Ctx, c: ChatCommand) {
  switch (c.cmd) {
    case "start": return start(ctx, c.args[0] ?? "");
    case "help": return reply(ctx, HELP);
    case "menu": return chatx.menu(ctx);
    case "games": return reply(ctx, games.GAMES_HELP);
    case "party": return reply(ctx, party.HELP);
    case "play":
      if (await adminPanel.command(ctx, c)) return;
      return ctx.isPrivate ? reply(ctx, "Игра открывается прямо в Telegram 👇", playButton("🎮 Открыть BAYHAN GAME"))
        : reply(ctx, "🎮 Полная версия игры — в личке бота:", [[{ text: "🎮 Открыть", url: `https://t.me/${BOT_USERNAME}?start=play` }]]);
    case "link": return reply(ctx, HOW_LINK);
    case "casino": case "spin": case "slots": case "dice": case "basketball": case "darts": case "bowling": case "up": case "down": case "trade":
      return games.bet(ctx, c);
    case "mines": return games.mines(ctx, c);
    case "crash": return games.crash(ctx, c);
    case "duel": return games.duel(ctx, c);
    case "lottery": return chatx.lottery(ctx, c);
    case "giveaway": return chatx.giveaway(ctx, c);
    case "mafia": return party.start(ctx, "mafia");
    case "spy": return party.start(ctx, "spy");
    case "crocodile": return party.start(ctx, "crocodile");
    case "partystop": return party.stop(ctx);
    case "chatsettings": return chatSettings(ctx);
    case "admin": case "a_give": case "a_take": case "a_ban": case "a_unban": case "a_player": case "a_broadcast": case "a_stats":
      if (await adminPanel.command(ctx, c)) return;
      return ctx.isPrivate ? reply(ctx, "Не знаю такой команды 🤔 Напишите «меню» или «помощь».") : undefined;
    case "vip": case "promo":
      if (await adminPanel.command(ctx, c)) return;
  }
  if (await economy.handle(ctx, c)) return;
  if (ctx.isPrivate) return reply(ctx, "Не знаю такой команды 🤔 Напишите «меню» или «помощь».");
}

async function isChatAdmin(chatId: number, userId: number) {
  const r = await tg("getChatMember", { chat_id: chatId, user_id: userId });
  return ["creator", "administrator"].includes(r?.result?.status);
}

function settingsView(s: { casino: boolean; party: boolean }) {
  return {
    text: `⚙️ <b>Настройки чата</b>\n\n🎰 Игры на ставки и лотерея: ${s.casino ? "включены" : "выключены"}\n🎭 Мини-игры и дуэли: ${s.party ? "включены" : "выключены"}`,
    kb: [[{ text: `🎰 Ставки: ${s.casino ? "выкл." : "вкл."}`, callback_data: `cs:casino:${s.casino ? 0 : 1}` }],
      [{ text: `🎭 Мини-игры: ${s.party ? "выкл." : "вкл."}`, callback_data: `cs:party:${s.party ? 0 : 1}` }]],
  };
}

async function chatSettings(ctx: Ctx) {
  if (ctx.isPrivate) return reply(ctx, "Настройки есть у групповых чатов.");
  if (!(await isChatAdmin(ctx.chat.id, ctx.from.id))) return reply(ctx, "Настройки меняют только админы чата.");
  const v = settingsView(ctx.settings);
  return reply(ctx, v.text, v.kb);
}

type Begin = { new: boolean; rate_ok?: boolean; linked?: boolean; settings?: any; party?: boolean; state?: { kind: string; data: any } | null };

async function onMessage(update: any, msg: any, begin: Begin, ctx: Ctx) {
  const text: string = msg.text ?? "";
  if (!text) {
    if (ctx.isPrivate) await reply(ctx, "Я понимаю команды и кнопки 🙂 Напишите «меню».");
    return;
  }
  // An open admin wizard step takes the next private message.
  if (ctx.isPrivate && begin.state && !text.startsWith("/")) {
    if (await adminPanel.onInput(ctx, text, begin.state)) return;
  }
  // Private menu buttons ("🏆 Рейтинг") and /start with a payload.
  if (ctx.isPrivate) {
    const pc = parseCommand(text, BOT_USERNAME);
    if (pc.cmd === "/start") return start(ctx, pc.arg);
    if (MENU_TO_CHAT[pc.cmd] && !text.startsWith("/")) return onCommand(ctx, { cmd: MENU_TO_CHAT[pc.cmd], args: [], rest: "" });
  }
  const c = parseChat(text, BOT_USERNAME);
  if (c) return onCommand(ctx, c);
  // Ordinary group messages matter only while a party game runs (crocodile guesses, the spy's guess).
  if (!ctx.isPrivate) {
    if (begin.party) await party.text(ctx, text);
    return;
  }
  void update;
  return reply(ctx, "Не знаю такой команды 🤔 Напишите «меню» или «помощь».", MENU);
}

async function onCallback(q: any, ctx: Ctx): Promise<{ text?: string; show?: boolean }> {
  const from: TgUser = q.from;
  const chat = ctx.chat;
  const messageId: number = q.message?.message_id;
  const data: string = q.data ?? "";
  let alert: string | null = null;
  let show = false;
  try {
    if (data === "noop") alert = null;
    else if (data === "reg" || data.startsWith("reg:")) {
      const { created } = await ensurePlayer(from, { ref: data.slice(4) });
      forgetLinked(from.id);
      alert = created ? "🎉 Аккаунт создан! $50,000 уже на счету." : "Аккаунт уже есть.";
      if (created) await send(chat.id, `🎉 ${mention(from)} теперь в BAYHAN GAME! Стартовый капитал $50,000. Напишите «меню».`, ctx.isPrivate ? MENU : undefined);
    } else if (data === "howlink") await send(chat.id, HOW_LINK, playButton());
    else if (data.startsWith("c:")) {
      const cmd = data.slice(2);
      await onCommand(ctx, { cmd, args: [], rest: "" });
    } else if (data.startsWith("mo:") || data.startsWith("mc:")) { alert = await games.minesButton(ctx, data, messageId); show = Boolean(alert && /не ваша|Мина/.test(alert)); }
    else if (data.startsWith("cc:")) alert = await games.crashButton(ctx, data, messageId);
    else if (data.startsWith("da:") || data.startsWith("dc:")) { alert = await games.duelButton(ctx, data, messageId); show = true; }
    else if (data.startsWith("gv:")) { alert = await chatx.giveawayButton(ctx, data, messageId); show = true; }
    else if (data.startsWith("p:")) { alert = await party.button(ctx, data); show = true; }
    else if (data.startsWith("ad:")) { alert = await adminPanel.button(ctx, data, messageId); show = Boolean(alert && alert.length > 40); }
    else if (data.startsWith("ci:")) {
      const [, id, yes] = data.split(":");
      await rpc("tg_rpc", { p_tg: from.id, p_fn: "corp_respond", p_args: { p_invite: Number(id), p_accept: yes === "1" } });
      alert = yes === "1" ? "Вы вступили в корпорацию!" : "Приглашение отклонено.";
    } else if (data.startsWith("mr:")) {
      const [, id, yes] = data.split(":");
      await rpc("tg_rpc", { p_tg: from.id, p_fn: "marriage_respond", p_args: { p_proposal: Number(id), p_accept: yes === "1" } });
      alert = yes === "1" ? "💍 Поздравляем с браком!" : "Предложение отклонено.";
      if (yes === "1") await send(chat.id, `💍 ${mention(from)} ответил(а) «Да»! Поздравляем молодожёнов!`);
    } else if (data.startsWith("cs:")) {
      if (!(await isChatAdmin(chat.id, from.id))) alert = "Только для админов чата.";
      else {
        const [, k, v] = data.split(":");
        const s = await rpc<any>("tg_chat_set", { p_chat: chat.id, p_key: k, p_value: v === "1" });
        const view = settingsView({ casino: s.casino !== false, party: s.party !== false });
        await tg("editMessageText", { chat_id: chat.id, message_id: messageId, text: view.text, parse_mode: "HTML", reply_markup: { inline_keyboard: view.kb } });
        alert = "Сохранено";
      }
    }
  } catch (e) {
    alert = errorText(e);
    show = true;
  }
  return alert ? { text: alert.slice(0, 190), show: show || alert.length > 60 } : {};
}

async function onMembership(u: any) {
  const chat = u.chat;
  if (chat.type === "private") return;
  const status = u.new_chat_member?.status;
  if (status === "member" || status === "administrator") {
    const was = u.old_chat_member?.status;
    await rpc("tg_chat_seen", { p_chat: chat.id, p_title: chat.title ?? "", p_type: chat.type, p_tg: u.from?.id ?? null });
    if (was === "left" || was === "kicked") {
      await send(chat.id, `👑 <b>BAYHAN GAME</b> в чате!\n\nИграйте прямо здесь: «меню», «б» — баланс, «бонус», «работа», «казино 1к», «мины 1к», «дуэль 1к», «лотерея 1к», «мафия», «шпион», «крокодил». Все команды — «помощь».\n\n` +
        `Чтобы я понимал команды без «/», сделайте меня администратором чата (права не нужны). Настройки чата: «настройки».`, chatx.MENU_BUTTONS);
    }
  } else if (status === "left" || status === "kicked") {
    await rpc("tg_chat_left", { p_chat: chat.id });
  }
}

const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });

// --------------------------------------------------------------- server ----
Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("ok");
  const { webhook_secret } = await config();
  if (req.headers.get("x-telegram-bot-api-secret-token") !== webhook_secret) return new Response("forbidden", { status: 401 });

  let update: any;
  try {
    update = await req.json();
  } catch {
    return new Response("bad request", { status: 400 });
  }
  // pg_cron timer for party games, lotteries and giveaways (same secret header).
  if (update?.tick === true) {
    for (const job of [party.tick, chatx.tick]) {
      try {
        await job();
      } catch (e) {
        console.error("tick failed:", e instanceof Error ? e.message : "unknown");
      }
    }
    return new Response("ok");
  }
  if (!Number.isSafeInteger(update?.update_id)) return new Response("ok");

  if (update.my_chat_member) {
    if (!(await rpc<boolean>("tg_seen_update", { p_update_id: update.update_id }))) return new Response("ok");
    await onMembership(update.my_chat_member).catch((e) => console.warn("membership:", e instanceof Error ? e.message : "unknown"));
    return new Response("ok");
  }
  const msg = update.message;
  const q = update.callback_query;
  const from: TgUser | undefined = msg?.from ?? q?.from;
  if (!from || from.is_bot) return new Response("ok");
  const chat = msg?.chat ?? q?.message?.chat ?? { id: from.id, type: "private" };
  if (!["private", "group", "supergroup"].includes(chat.type)) return new Response("ok");

  // One round trip: dedupe, rate limit, chat bookkeeping, account and wizard state.
  const begin = await rpc<Begin>("tg_begin", { p_update: update.update_id, p_tg: from.id, p_chat: chat.id, p_chat_type: chat.type, p_title: chat.title ?? "", p_limit: 60 });
  if (!begin?.new || begin.rate_ok === false) return new Response("ok");

  const ctx: Ctx = {
    chat, from, updateId: update.update_id, isPrivate: chat.type === "private", linked: Boolean(begin.linked),
    settings: { casino: begin.settings?.casino !== false, party: begin.settings?.party !== false },
    messageId: msg?.message_id ?? q?.message?.message_id, replyTo: msg?.reply_to_message?.from,
  };
  try {
    if (q) {
      const a = await onCallback(q, ctx);
      // The button answer travels back in the webhook response.
      return json({ method: "answerCallbackQuery", callback_query_id: q.id, ...(a.text ? { text: a.text, show_alert: a.show } : {}) });
    }
    ctx.defer = {};
    await onMessage(update, msg, begin, ctx);
    if (ctx.defer.payload) return json(ctx.defer.payload);
  } catch (e) {
    // Only the error text: no tokens, no message bodies.
    if (e instanceof GameError) console.warn("bot game error:", e.message);
    else console.error("bot update failed:", e instanceof Error ? e.message : "unknown");
    const text = `⚠️ ${errorText(e)}`;
    if (q) return json({ method: "answerCallbackQuery", callback_query_id: q.id, text: text.slice(0, 190), show_alert: true });
    if (ctx.defer && !ctx.defer.payload) {
      return json({ method: "sendMessage", chat_id: chat.id, text, parse_mode: "HTML", ...(ctx.isPrivate ? {} : { reply_parameters: { message_id: msg.message_id, allow_sending_without_reply: true } }) });
    }
    await send(chat.id, text, undefined, ctx.isPrivate ? undefined : msg?.message_id);
  }
  if (ctx.defer?.payload) return json(ctx.defer.payload);
  return new Response("ok");
});
