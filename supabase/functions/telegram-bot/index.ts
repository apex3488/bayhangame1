// BAYHAN GAME bot (@BayhanGame2_bot), Telegram webhook.
// Every number it shows and every reward it gives comes from public.tg_call(), i.e. the same
// SQL functions the browser game and the Mini App use. No balances live in the bot.
import {
  BOT_USERNAME, config, ensurePlayer, GameError, linkedUser, MINI_APP_URL, money, rpc, SITE_URL, tg, type TgUser,
} from "../_shared/telegram.ts";

const BTN = {
  play: "🎮 Играть",
  profile: "👤 Профиль",
  balance: "💰 Баланс",
  daily: "🎁 Ежедневная награда",
  top: "🏆 Рейтинг",
  tasks: "📋 Задания",
  invite: "👥 Пригласить друга",
  help: "ℹ️ Помощь",
};

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

const ERRORS: Record<string, string> = {
  daily_already_claimed: "Награда уже получена. Следующая — через 24 часа после прошлой.",
  account_restricted: "Аккаунт ограничен администрацией.",
  link_code_invalid: "Код привязки неверный или устарел. Получите новый в игре: Профиль → Telegram.",
  telegram_already_linked: "Этот Telegram уже привязан к другому аккаунту BAYHAN GAME.",
  account_already_linked: "К этому аккаунту уже привязан другой Telegram.",
  registration_failed: "Не удалось создать аккаунт. Попробуйте ещё раз через минуту.",
};

const esc = (s: unknown) => String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);
const send = (chat: number, text: string, markup?: unknown) =>
  tg("sendMessage", { chat_id: chat, text, parse_mode: "HTML", link_preview_options: { is_disabled: true }, ...(markup ? { reply_markup: markup } : {}) });

async function call<T = any>(tgId: number, fn: string, arg: string | null = null): Promise<T> {
  return await rpc<T>("tg_call", { p_tg: tgId, p_fn: fn, p_arg: arg });
}

// ------------------------------------------------------------- screens ----
async function welcomeNew(chat: number, u: TgUser, ref: string) {
  await send(
    chat,
    `<b>Добро пожаловать в BAYHAN GAME!</b> 👑\n\nЭкономическая игра: работай, открывай бизнес, покупай машины и острова, ` +
      `играй в Crash и Мины и поднимайся в рейтинге. Только игровая валюта.\n\n` +
      `Уже играете в браузере? Привяжите аккаунт — прогресс и баланс будут общими.`,
    {
      inline_keyboard: [
        [{ text: "🆕 Создать аккаунт", callback_data: ref ? `reg:${ref}` : "reg" }],
        [{ text: "🔗 У меня уже есть аккаунт", callback_data: "howlink" }],
        [{ text: BTN.play, web_app: { url: MINI_APP_URL } }],
      ],
    },
  );
}

async function profileText(tgId: number) {
  const p = await call(tgId, "profile");
  const s = p.snapshot;
  return (
    `👤 <b>${esc(p.game_name)}</b>  ·  ID ${p.public_id}\n` +
    `⭐ Уровень ${p.level}  ·  ${Number(p.xp) % Number(s.xp_per_level || 500)}/${s.xp_per_level} XP\n\n` +
    `💼 Капитал: <b>${money(s.total_capital)}</b>\n` +
    `💵 Кошелёк: ${money(s.cash)}\n🏦 Банк: ${money(s.bank)}\n₿ BTC: ${Number(s.btc)}\n` +
    `🏠 Активы: ${money(s.assets_value)}\n\n` +
    `🎲 Игр: ${p.stats.games_played}  ·  🛠 Смен: ${p.stats.shifts}\n` +
    `🔑 Логин для браузера: <code>${esc(p.login)}</code>`
  );
}

async function balanceText(tgId: number) {
  const s = await call(tgId, "snapshot");
  return (
    `💰 <b>Баланс</b>\n\n💵 Кошелёк: <b>${money(s.cash)}</b>\n🏦 Банк: ${money(s.bank)}\n` +
    `₿ BTC: ${Number(s.btc)} (≈ ${money(Number(s.btc) * Number(s.btc_rate))})\n🏠 Активы: ${money(s.assets_value)}\n\n` +
    `💼 Общий капитал: <b>${money(s.total_capital)}</b>\n📈 Доход сегодня: ${money(s.income_today)}`
  );
}

const QUEST_NAMES: Record<string, string> = {
  play_5_games: "Сыграть 5 игр",
  win_3_games: "Выиграть 3 игры",
  mine_10: "Добыть ресурсы 10 раз",
  invite_1: "Пригласить друга",
  earn_10000: "Заработать $10,000",
};

async function tasksText(tgId: number) {
  const list = (await call<any[]>(tgId, "quests")) ?? [];
  if (!list.length) return "📋 Заданий сейчас нет.";
  const rows = list.map((q) => {
    const done = Number(q.progress) >= Number(q.target);
    const mark = q.claimed ? "✅" : done ? "🎁" : "▫️";
    return `${mark} ${esc(QUEST_NAMES[q.code] ?? q.code)} — ${Math.min(Number(q.progress), Number(q.target))}/${Number(q.target)} · ${money(q.reward_usd)}`;
  });
  return `📋 <b>Задания</b>\n\n${rows.join("\n")}\n\n🎁 — готово, заберите награду в игре.`;
}

async function topText() {
  const list = await call<any[]>(0, "leaderboard", "10");
  const medal = ["🥇", "🥈", "🥉"];
  const rows = list.map((r) => `${medal[r.rank - 1] ?? `${r.rank}.`} ${esc(r.game_name)} — ${money(r.total_capital)}`);
  return `🏆 <b>Рейтинг по капиталу</b>\n\n${rows.join("\n") || "Пока пусто."}`;
}

async function inviteText(tgId: number) {
  const r = await call(tgId, "referrals");
  return (
    `👥 <b>Пригласить друга</b>\n\nДруг получит стартовый капитал, а вы — <b>${money(r.reward)}</b> после его 3 рабочих смен.\n\n` +
    `Ссылка в Telegram:\nhttps://t.me/${BOT_USERNAME}?start=ref_${r.code}\n\nСсылка на браузерную версию:\n${SITE_URL}/register?ref=${r.code}\n\n` +
    `Приглашено: ${r.invited} · засчитано: ${r.qualified} · заработано: ${money(r.earned)}`
  );
}

const HELP =
  `ℹ️ <b>BAYHAN GAME — помощь</b>\n\n` +
  `${BTN.play} — открыть игру прямо в Telegram\n${BTN.profile}, ${BTN.balance} — ваши данные из игры\n` +
  `${BTN.daily} — раз в 24 часа, серия увеличивает награду\n${BTN.top} — лучшие игроки\n` +
  `${BTN.tasks}, ${BTN.invite}\n\n` +
  `Один аккаунт везде: в боте, в Mini App и в браузере (${SITE_URL}).\n` +
  `Пароль для входа в браузере задаётся в игре: Профиль → Настройки.\n\n` +
  `Команды: /start /play /profile /balance /daily /top /tasks /invite /help`;

const HOW_LINK =
  `🔗 <b>Привязка аккаунта из браузера</b>\n\n1. Откройте игру в браузере: ${SITE_URL}\n2. Профиль → Настройки → «Привязать Telegram»\n` +
  `3. Нажмите «Открыть бота» — привязка произойдёт сама.\n\nИли откройте ${BTN.play}, выберите «У меня есть аккаунт» и войдите по логину и паролю.`;

// ------------------------------------------------------------- handlers ----
async function requireLinked(chat: number, u: TgUser) {
  if (await linkedUser(u.id)) return true;
  await welcomeNew(chat, u, "");
  return false;
}

async function onCommand(chat: number, u: TgUser, text: string, updateId: number) {
  const [cmdRaw, ...rest] = text.trim().split(/\s+/);
  const cmd = cmdRaw.replace(new RegExp(`@${BOT_USERNAME}$`, "i"), "").toLowerCase();
  const arg = rest.join(" ");

  switch (cmd) {
    case "/start": {
      if (arg.startsWith("link_")) {
        const r = await rpc<any>("tg_consume_link_code", { p_code: arg.slice(5), p_tg: u.id, p_username: u.username ?? null, p_first_name: u.first_name ?? null });
        await send(chat, `✅ Аккаунт <b>${esc(r.game_name)}</b> привязан к Telegram. Баланс и прогресс общие с браузером.`, MENU);
        return send(chat, await profileText(u.id), playButton());
      }
      if (!(await linkedUser(u.id))) return welcomeNew(chat, u, arg.startsWith("ref_") ? arg.slice(4) : "");
      await send(chat, `👑 <b>С возвращением в BAYHAN GAME!</b>`, MENU);
      return send(chat, await profileText(u.id), playButton());
    }
    case "/play":
    case BTN.play.toLowerCase():
      return send(chat, "Игра открывается прямо в Telegram 👇", playButton("🎮 Открыть BAYHAN GAME"));
    case "/help":
    case BTN.help.toLowerCase():
      return send(chat, HELP, MENU);
    case "/top":
    case BTN.top.toLowerCase():
      return send(chat, await topText(), playButton());
  }

  const linkedOnly: Record<string, () => Promise<unknown>> = {
    "/profile": async () => send(chat, await profileText(u.id), playButton()),
    "/balance": async () => send(chat, await balanceText(u.id), playButton()),
    "/daily": () => claimDaily(chat, u, `tg-msg-${updateId}`),
    "/tasks": async () => send(chat, await tasksText(u.id), playButton()),
    "/invite": async () => send(chat, await inviteText(u.id)),
    "/admin": () => adminStats(chat, u),
  };
  const alias: Record<string, string> = {
    [BTN.profile.toLowerCase()]: "/profile",
    [BTN.balance.toLowerCase()]: "/balance",
    [BTN.daily.toLowerCase()]: "/daily",
    [BTN.tasks.toLowerCase()]: "/tasks",
    [BTN.invite.toLowerCase()]: "/invite",
  };
  const key = alias[text.trim().toLowerCase()] ?? cmd;
  const handler = linkedOnly[key];
  if (!handler) return send(chat, "Не знаю такой команды 🤔 Выберите действие в меню ниже или нажмите /help.", MENU);
  if (!(await requireLinked(chat, u))) return;
  return handler();
}

async function claimDaily(chat: number, u: TgUser, key: string) {
  const st = await call(u.id, "daily_status");
  if (!st.can_claim) {
    const next = new Date(st.next_at);
    const h = Math.max(0, Math.ceil((next.getTime() - Date.now()) / 3_600_000));
    return send(chat, `⏳ Награда уже получена. Следующая примерно через ${h} ч.`, MENU);
  }
  const r = await call(u.id, "claim_daily", key);
  if (r.status === "duplicate") return;
  return send(chat, `🎁 <b>+${money(r.reward)}</b> — ежедневная награда, день ${r.streak}!\nЗаходите завтра, серия увеличит награду.`, MENU);
}

async function adminStats(chat: number, u: TgUser) {
  try {
    const s = await call(u.id, "admin_stats");
    return send(
      chat,
      `🛡 <b>Админ · ${esc(s.role)}</b>\n\nИгроков: ${s.players} (сегодня +${s.players_today})\nПривязали Telegram: ${s.telegram_linked}\n` +
        `Активны в Telegram за 24 ч: ${s.active_24h}\nИгровых раундов сегодня: ${s.rounds_today}\n\nПанель: ${SITE_URL}/admin`,
    );
  } catch (e) {
    // For everyone else the command does not exist.
    if (e instanceof GameError && e.message.includes("forbidden")) {
      return send(chat, "Не знаю такой команды 🤔 Выберите действие в меню ниже или нажмите /help.", MENU);
    }
    throw e;
  }
}

async function onCallback(q: any, updateId: number) {
  const u: TgUser = q.from;
  const chat = q.message?.chat?.id ?? u.id;
  const data: string = q.data ?? "";
  await tg("answerCallbackQuery", { callback_query_id: q.id });
  if (data === "reg" || data.startsWith("reg:")) {
    const { created } = await ensurePlayer(u, { ref: data.slice(4) });
    await send(chat, created ? "🎉 <b>Аккаунт создан!</b> Стартовый капитал уже на счету." : "Аккаунт уже есть — вот он:", MENU);
    return send(chat, await profileText(u.id), playButton());
  }
  if (data === "howlink") return send(chat, HOW_LINK, playButton());
  if (data === "daily") return (await requireLinked(chat, u)) && claimDaily(chat, u, `tg-cb-${updateId}`);
}

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
  if (!Number.isSafeInteger(update?.update_id)) return new Response("ok");
  // Telegram re-delivers an update until it gets 200: handle each one once.
  if (!(await rpc<boolean>("tg_seen_update", { p_update_id: update.update_id }))) return new Response("ok");

  const from: TgUser | undefined = update.message?.from ?? update.callback_query?.from;
  const chat: number | undefined = update.message?.chat?.id ?? update.callback_query?.message?.chat?.id ?? from?.id;
  if (!from || from.is_bot || !chat) return new Response("ok");
  // Private chats only; in groups the bot stays silent.
  if (update.message && update.message.chat?.type !== "private") return new Response("ok");
  if (!(await rpc<boolean>("tg_rate_hit", { p_key: `bot:${from.id}`, p_limit: 30, p_window_seconds: 60 }))) return new Response("ok");

  try {
    if (update.callback_query) await onCallback(update.callback_query, update.update_id);
    else if (typeof update.message?.text === "string") await onCommand(chat, from, update.message.text, update.update_id);
    else if (update.message) await send(chat, "Я понимаю только команды и кнопки меню 🙂", MENU);
  } catch (e) {
    const code = e instanceof GameError ? (e.message.match(/[a-z_]{4,}/)?.[0] ?? "") : "";
    if (!(e instanceof GameError)) console.error("bot update failed:", e instanceof Error ? e.message : "unknown");
    await send(chat, ERRORS[code] ?? "⚠️ Сервер игры временно недоступен. Попробуйте ещё раз через минуту.", MENU);
  }
  return new Response("ok");
});
