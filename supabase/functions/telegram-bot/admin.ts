// Admin panel inside the bot (private chat only). Screens are edited in place; anything that needs
// typed input goes through a wizard step stored in tg_admin_state; money, bans, roles, broadcasts
// and leaving chats ask for confirmation first. Every action calls the same admin_* RPC as the web
// admin panel as the admin's own account, so the role check and the audit log stay on the server.
import { parseAmount, type ChatCommand } from "../_shared/bot-commands.ts";
import { admin, rpc, SITE_URL, tg } from "../_shared/telegram.ts";
import { type Buttons, call, type Ctx, edit, errorText, esc, money, n, reply, send } from "./ctx.ts";
import { waitUntil } from "./games.ts";

const ROLE: Record<string, string> = { owner: "Владелец", admin: "Администратор", moderator: "Модератор", operator: "Оператор" };
const STATUS: Record<string, string> = { active: "✅ активен", restricted: "⚠️ ограничен", blocked: "🚫 заблокирован" };
const CAN_EDIT = new Set(["owner", "admin"]);
const PAGE = 8;
const date = (iso: string) => new Date(iso).toLocaleString("ru-RU", { timeZone: "Europe/Moscow", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
const b = (text: string, data: string) => ({ text, callback_data: data });
const back = (to = "home") => [b("⬅️ Назад", `ad:${to}`), b("🏠 Меню", "ad:home")];
type Screen = { text: string; kb: Buttons };

async function role(ctx: Ctx): Promise<string | null> {
  try {
    return (await call(ctx, "admin_me"))?.role ?? null;
  } catch {
    return null;
  }
}

/** Shows a screen: edits the panel message when there is one, otherwise sends a new one. */
async function show(ctx: Ctx, s: Screen, messageId?: number) {
  if (messageId) {
    const r = await edit(ctx.chat.id, messageId, s.text, s.kb);
    if (r?.ok || String(r?.description ?? "").includes("not modified")) return;
  }
  await send(ctx.chat.id, s.text, s.kb);
}

// --------------------------------------------------------- wizard state ----
async function setState(ctx: Ctx, kind: string, data: Record<string, unknown> = {}) {
  await admin().from("tg_admin_state").upsert({ telegram_id: ctx.from.id, kind, data, expires_at: new Date(Date.now() + 10 * 60_000).toISOString() });
}
const clearState = (ctx: Ctx) => admin().from("tg_admin_state").delete().eq("telegram_id", ctx.from.id);
async function getState(ctx: Ctx) {
  const { data } = await admin().from("tg_admin_state").select("kind, data, expires_at").eq("telegram_id", ctx.from.id).maybeSingle();
  return data && new Date(data.expires_at).getTime() > Date.now() ? (data as { kind: string; data: any }) : null;
}
/** Asks for typed input; the next private message from this admin is the answer. */
async function ask(ctx: Ctx, kind: string, data: Record<string, unknown>, prompt: string, messageId?: number) {
  await setState(ctx, kind, data);
  await show(ctx, { text: `✍️ ${prompt}\n\nНапишите «отмена», чтобы выйти.`, kb: [[b("✖️ Отмена", "ad:no")]] }, messageId);
}
/** Stores an action to run after the admin presses «Подтвердить». */
async function confirm(ctx: Ctx, action: Record<string, unknown>, text: string, messageId?: number) {
  await setState(ctx, "confirm", { ...action, key: crypto.randomUUID() });
  await show(ctx, { text: `❓ ${text}`, kb: [[b("✅ Подтвердить", "ad:ok"), b("✖️ Отмена", "ad:no")]] }, messageId);
}

// -------------------------------------------------------------- screens ----
function home(r: string): Screen {
  const kb: Buttons = [
    [b("📊 Статистика", "ad:stats"), b("👥 Игроки", "ad:pl:0")],
    [b("💰 Экономика", "ad:eco"), b("🎮 Игры", "ad:gm")],
    [b("🛠 Работы", "ad:jb"), b("🎟 Промокоды", "ad:pr")],
    [b("🎉 События", "ad:ev"), b("👑 VIP", "ad:vip")],
    [b("📢 Рассылка", "ad:bc"), b("📰 Новости", "ad:nw")],
    [b("💬 Чаты бота", "ad:ch:0"), b("📜 Аудит", "ad:au:0")],
    [b("💸 Крупные переводы", "ad:bt"), ...(r === "owner" ? [b("🛡 Роли", "ad:rl")] : [])],
    [{ text: "🌐 Веб-админка", url: `${SITE_URL}/admin` }],
  ];
  return { text: `🛡 <b>Админ-панель BAYHAN GAME</b>\nВаша роль: ${ROLE[r] ?? r}${CAN_EDIT.has(r) ? "" : " (только просмотр и модерация)"}\n\nВыберите раздел.`, kb };
}

async function stats(ctx: Ctx): Promise<Screen> {
  const d = await call(ctx, "admin_dashboard");
  const days: any[] = await call(ctx, "admin_daily_stats", { p_days: 7 });
  const { count: chats } = await admin().from("tg_chats").select("chat_id", { count: "exact", head: true }).eq("active", true);
  const { count: tgLinked } = await admin().from("telegram_accounts").select("user_id", { count: "exact", head: true });
  const week = days.map((x) => `${x.day.slice(5)}: +${x.registrations} игр., раундов ${x.rounds}, ставки ${money(x.bets)}`).join("\n");
  return {
    text: `📊 <b>Статистика</b>\n\n👥 Игроков: <b>${d.players_total}</b> (сутки +${d.players_new_24h}, неделя +${d.players_new_7d})\n` +
      `🟢 Активны за сутки: ${d.players_active_24h} · 🚫 заблокировано: ${d.players_blocked}\n📱 С Telegram: ${tgLinked ?? 0} · 💬 чатов с ботом: ${chats ?? 0}\n\n` +
      `💵 Наличные у игроков: ${money(d.money_cash)}\n🏦 В банке: ${money(d.money_bank)} · вклады: ${money(d.money_deposits)}\n₿ BTC: ${n(d.money_btc)}\n\n` +
      `<b>За 24 часа</b>\n🎲 Раундов: ${d.rounds_24h} · ставки ${money(d.bets_24h)} · выплаты ${money(d.payouts_24h)}\n` +
      `🛠 Смен: ${d.shifts_24h} · 💸 переводов ${d.transfers_count_24h} на ${money(d.transfers_24h)}\n🛡 Действий админов: ${d.admin_actions_24h}\n\n<b>7 дней</b>\n${week}`,
    kb: [[b("🔄 Обновить", "ad:stats")], back()],
  };
}

async function players(ctx: Ctx, offset: number, query = ""): Promise<Screen> {
  const list: any[] = await call(ctx, "admin_search_players", { p_query: query, p_limit: PAGE, p_offset: offset });
  const total = list[0]?.total ?? 0;
  const kb: Buttons = list.map((p) => [b(`${p.status === "active" ? "" : p.status === "blocked" ? "🚫 " : "⚠️ "}${p.game_name} · ${money(p.capital)}`, `ad:p:${p.id}`)]);
  const nav = [];
  if (offset > 0) nav.push(b("◀️", `ad:pl:${Math.max(0, offset - PAGE)}`));
  if (offset + PAGE < total) nav.push(b("▶️", `ad:pl:${offset + PAGE}`));
  if (nav.length && !query) kb.push(nav);
  kb.push([b("🔎 Найти по нику / логину / ID", "ad:ps")], back());
  return { text: `👥 <b>Игроки</b>${query ? ` · поиск «${esc(query)}»` : ""}\nВсего: ${total}. ${query ? "" : `Показаны ${offset + 1}–${offset + list.length}.`}`, kb };
}

async function playerRow(ctx: Ctx, id: string) {
  const list: any[] = await call(ctx, "admin_search_players", { p_query: id, p_limit: 1, p_offset: 0 });
  return list.find((x) => x.id === id) ?? null;
}

async function card(ctx: Ctx, id: string, r: string): Promise<Screen> {
  const p = await playerRow(ctx, id);
  if (!p) return { text: "Игрок не найден.", kb: [back("pl:0")] };
  const full = await call(ctx, "admin_player", { p_user: id });
  const { data: tga } = await admin().from("telegram_accounts").select("telegram_id, username").eq("user_id", id).maybeSingle();
  const edit_ = CAN_EDIT.has(r);
  const kb: Buttons = [];
  if (edit_) {
    kb.push([b("➕ Выдать $", `ad:pa:${id}:give`), b("➖ Отнять $", `ad:pa:${id}:take`)]);
    kb.push([b("🏦 Банк ±", `ad:pa:${id}:bank`), b("₿ BTC ±", `ad:pa:${id}:btc`)]);
  }
  kb.push([
    ...(p.status !== "active" ? [b("✅ Разблокировать", `ad:st:${id}:active`)] : []),
    ...(p.status !== "restricted" ? [b("⚠️ Ограничить", `ad:st:${id}:restricted`)] : []),
    ...(p.status !== "blocked" ? [b("🚫 Блок", `ad:st:${id}:blocked`)] : []),
  ]);
  if (edit_) kb.push([b("👑 Выдать VIP", `ad:vp:${id}`), ...(full?.vip?.active ? [b("❌ Снять VIP", `ad:vr:${id}`)] : [])]);
  kb.push([b("📜 Операции", `ad:lg:${id}`), b("🔍 Действия админов", `ad:pd:${id}`)]);
  kb.push([b("✉️ Написать игроку", `ad:pm:${id}`), b("🖼 Сбросить аватар", `ad:pi:${id}`)]);
  if (r === "owner") kb.push([b("🛡 Роль", `ad:pr2:${id}`)]);
  kb.push([b("🔄", `ad:p:${id}`), ...back("pl:0")]);
  return {
    text: `👤 <b>${esc(p.game_name)}</b> · ID ${p.public_id}\nЛогин: <code>${esc(p.login)}</code> · ${STATUS[p.status] ?? p.status}` +
      `${full?.role ? ` · 🛡 ${ROLE[full.role] ?? full.role}` : ""}\nTelegram: ${tga ? `${tga.username ? "@" + esc(tga.username) : "привязан"} (<code>${tga.telegram_id}</code>)` : "не привязан"}\n\n` +
      `💵 ${money(p.cash)} · 🏦 ${money(p.bank)} · ₿ ${n(p.btc)}\n💼 Капитал: <b>${money(p.capital)}</b> · уровень ${p.level}\n` +
      `👑 VIP: ${full?.vip?.active ? `${full.vip.level} до ${date(full.vip.ends_at)}` : "нет"}\n` +
      `📅 В игре с ${date(p.created_at)}${p.last_activity ? ` · активность ${date(p.last_activity)}` : ""}`,
    kb,
  };
}

async function ledger(ctx: Ctx, id: string): Promise<Screen> {
  const { data } = await admin().from("ledger_entries").select("amount, direction, account, reason, created_at").eq("user_id", id).order("created_at", { ascending: false }).limit(15);
  return {
    text: `📜 <b>Последние операции</b>\n\n${(data ?? []).map((e: any) => `${date(e.created_at)} ${e.direction === "credit" ? "🟢+" : "🔴−"}${e.account === "btc" ? `${n(e.amount)} BTC` : money(e.amount)} · ${esc(e.reason)}`).join("\n") || "Нет операций."}`,
    kb: [back(`p:${id}`)],
  };
}

async function playerAudit(ctx: Ctx, id: string): Promise<Screen> {
  const full = await call(ctx, "admin_player", { p_user: id });
  const rows = (full?.audit ?? []).slice(0, 12).map((a: any) => `${date(a.created_at)} · ${esc(a.actor)} · ${esc(a.action)}${a.payload?.reason ? ` · ${esc(a.payload.reason)}` : ""}`);
  return { text: `🔍 <b>Действия админов с игроком</b>\n\n${rows.join("\n") || "Нет записей."}`, kb: [back(`p:${id}`)] };
}

async function economy(ctx: Ctx): Promise<Screen> {
  const list: any[] = await call(ctx, "admin_list_settings");
  return {
    text: `💰 <b>Экономика</b>\n\n${list.map((s) => `• <code>${esc(s.key)}</code> = <b>${n(s.value)}</b>\n  ${esc(s.description)}`).join("\n")}\n\nНажмите параметр, чтобы изменить.`,
    kb: [...list.map((s) => [b(`✏️ ${s.key}`, `ad:es:${s.key}`)]), back()],
  };
}

async function gamesScreen(): Promise<Screen> {
  const { data } = await admin().from("game_settings").select("game, enabled, min_bet, max_bet").order("game");
  return {
    text: `🎮 <b>Игры</b>\n\n${(data ?? []).map((g: any) => `${g.enabled ? "✅" : "⛔"} <b>${g.game}</b>: ставка ${money(g.min_bet)} – ${money(g.max_bet)}`).join("\n")}`,
    kb: [...(data ?? []).map((g: any) => [b(`${g.enabled ? "⛔ Выключить" : "✅ Включить"} ${g.game}`, `ad:gt:${g.game}`), b("✏️ Лимиты", `ad:gl:${g.game}`)]), back()],
  };
}

async function jobsScreen(ctx: Ctx): Promise<Screen> {
  const list: any[] = await call(ctx, "admin_list_jobs");
  return {
    text: `🛠 <b>Работы</b>\n\n${list.map((j) => `${j.is_active ? "✅" : "⛔"} <b>${j.key}</b>: ${money(j.income_min)}–${money(j.income_max)}, перерыв ${Math.round(j.cooldown_seconds / 60)} мин, капитал от ${money(j.min_capital)}, +${j.xp_reward} XP`).join("\n")}`,
    kb: [...list.map((j) => [b(`${j.is_active ? "⛔" : "✅"} ${j.key}`, `ad:jt:${j.key}`), b("✏️ Оплата", `ad:je:${j.key}`)]), back()],
  };
}

async function promosScreen(ctx: Ctx): Promise<Screen> {
  const list: any[] = await call(ctx, "admin_list_promos");
  return {
    text: `🎟 <b>Промокоды</b>\n\n${list.slice(0, 20).map((p) => `${p.active ? "✅" : "⛔"} <code>${esc(p.code)}</code> — ${money(p.reward_usd)}${n(p.reward_btc) ? ` + ${n(p.reward_btc)} BTC` : ""} · ${p.used_count}/${p.max_uses ?? "∞"}${p.expires_at ? ` · до ${date(p.expires_at)}` : ""}`).join("\n") || "Пока нет."}`,
    kb: [[b("➕ Создать промокод", "ad:pc")], ...list.slice(0, 12).map((p) => [b(`${p.active ? "⛔ Выключить" : "✅ Включить"} ${p.code}`, `ad:pt:${p.code}:${p.active ? 0 : 1}`), b("👥", `ad:pu:${p.code}`)]), back()],
  };
}

async function eventsScreen(ctx: Ctx): Promise<Screen> {
  const list: any[] = await call(ctx, "admin_list_events");
  return {
    text: `🎉 <b>События</b> (множители наград)\n\n${list.map((e) => `${e.active ? "✅" : "⛔"} <b>${esc(e.title)}</b> · ${e.event_type} ×${n(e.multiplier)} · ${date(e.starts_at)} – ${date(e.ends_at)}`).join("\n") || "Пока нет."}`,
    kb: [[b("➕ Создать событие", "ad:ec")], ...list.slice(0, 10).map((e) => [b(`${e.active ? "⛔ Выключить" : "✅ Включить"} ${e.title}`.slice(0, 60), `ad:et:${e.code}:${e.active ? 0 : 1}`)]), back()],
  };
}

async function vipScreen(ctx: Ctx): Promise<Screen> {
  const list: any[] = await call(ctx, "admin_list_vip");
  return { text: `👑 <b>VIP</b>\n\n${list.map((v) => `${v.active ? "✅" : "⌛"} ${esc(v.game_name)} — VIP ${v.level} до ${date(v.ends_at)}`).join("\n") || "Нет."}\n\nВыдать VIP — в карточке игрока.`, kb: [...list.slice(0, 10).map((v) => [b(`👤 ${v.game_name}`, `ad:p:${v.user_id}`)]), back()] };
}

async function newsScreen(ctx: Ctx): Promise<Screen> {
  const list: any[] = (await call(ctx, "admin_list_news", { p_limit: 10 })) ?? [];
  return {
    text: `📰 <b>Новости</b>\n\n${list.map((x) => `${x.hidden ? "🙈" : x.pinned ? "📌" : "•"} ${esc(x.title)} · ${date(x.published_at)} · прочитали ${x.read_count}`).join("\n") || "Пока нет."}`,
    kb: [[b("➕ Опубликовать", "ad:nc")], ...list.slice(0, 8).map((x) => [b(`${x.hidden ? "👁 Показать" : "🙈 Скрыть"}: ${x.title}`.slice(0, 60), `ad:nh:${x.id}:${x.hidden ? 0 : 1}`), b("🗑", `ad:nd:${x.id}`)]), back()],
  };
}

async function chatsScreen(offset: number): Promise<Screen> {
  const { data, count } = await admin().from("tg_chats").select("chat_id, title, settings, last_seen_at", { count: "exact" }).eq("active", true).order("last_seen_at", { ascending: false }).range(offset, offset + PAGE - 1);
  const kb: Buttons = (data ?? []).map((c: any) => [b(`💬 ${c.title || c.chat_id}`.slice(0, 60), `ad:cc:${c.chat_id}`)]);
  const nav = [];
  if (offset > 0) nav.push(b("◀️", `ad:ch:${Math.max(0, offset - PAGE)}`));
  if (offset + PAGE < (count ?? 0)) nav.push(b("▶️", `ad:ch:${offset + PAGE}`));
  if (nav.length) kb.push(nav);
  kb.push(back());
  return { text: `💬 <b>Чаты с ботом</b>: ${count ?? 0}\nНедавно активные сверху.`, kb };
}

async function chatCard(chatId: number): Promise<Screen> {
  const { data: c } = await admin().from("tg_chats").select("chat_id, title, type, settings, added_at, last_seen_at").eq("chat_id", chatId).maybeSingle();
  if (!c) return { text: "Чат не найден.", kb: [back("ch:0")] };
  const { count } = await admin().from("tg_chat_members").select("telegram_id", { count: "exact", head: true }).eq("chat_id", chatId);
  const s = c.settings ?? {};
  return {
    text: `💬 <b>${esc(c.title || "Без названия")}</b>\nID: <code>${c.chat_id}</code> · ${c.type}\nИгроков бота в чате: ${count ?? 0}\nДобавлен: ${date(c.added_at)} · активность ${date(c.last_seen_at)}\n\n` +
      `🎰 Ставки: ${s.casino === false ? "выкл." : "вкл."} · 🎭 Мини-игры: ${s.party === false ? "выкл." : "вкл."}`,
    kb: [[b(`🎰 ${s.casino === false ? "Включить" : "Выключить"} ставки`, `ad:cs:${chatId}:casino:${s.casino === false ? 1 : 0}`)],
      [b(`🎭 ${s.party === false ? "Включить" : "Выключить"} мини-игры`, `ad:cs:${chatId}:party:${s.party === false ? 1 : 0}`)],
      [b("✉️ Написать в чат", `ad:cm:${chatId}`), b("🚪 Выйти из чата", `ad:cl:${chatId}`)], back("ch:0")],
  };
}

async function auditScreen(ctx: Ctx, offset: number): Promise<Screen> {
  const list: any[] = await call(ctx, "admin_audit", { p_action: null, p_limit: 12, p_offset: offset });
  const total = list[0]?.total ?? 0;
  const nav = [];
  if (offset > 0) nav.push(b("◀️", `ad:au:${Math.max(0, offset - 12)}`));
  if (offset + 12 < total) nav.push(b("▶️", `ad:au:${offset + 12}`));
  return {
    text: `📜 <b>Журнал действий</b> (${total})\n\n${list.map((a) => `${date(a.created_at)} · ${esc(a.actor)} · ${esc(a.action)}${a.target_name ? ` → ${esc(a.target_name)}` : ""}`).join("\n") || "Пусто."}`,
    kb: [...(nav.length ? [nav] : []), back()],
  };
}

async function transfersScreen(ctx: Ctx): Promise<Screen> {
  const list: any[] = await call(ctx, "admin_large_transfers", { p_min: 100000, p_limit: 15 });
  return { text: `💸 <b>Крупные переводы</b> (от $100,000)\n\n${list.map((t) => `${date(t.created_at)} · ${esc(t.sender)} → ${esc(t.receiver)}: <b>${money(t.amount)}</b>`).join("\n") || "Нет."}`, kb: [back()] };
}

async function rolesScreen(): Promise<Screen> {
  const { data } = await admin().from("admin_roles").select("user_id, role");
  const ids = (data ?? []).map((r: any) => r.user_id);
  const { data: names } = ids.length ? await admin().from("profiles").select("id, game_name").in("id", ids) : { data: [] as any[] };
  const nameOf = (id: string) => names?.find((x: any) => x.id === id)?.game_name ?? id.slice(0, 8);
  return {
    text: `🛡 <b>Роли</b>\n\n${(data ?? []).map((r: any) => `• ${esc(nameOf(r.user_id))} — ${ROLE[r.role] ?? r.role}`).join("\n") || "Нет."}\n\nНазначить роль — в карточке игрока (кнопка «Роль»).`,
    kb: [...(data ?? []).map((r: any) => [b(`👤 ${nameOf(r.user_id)}`, `ad:p:${r.user_id}`)]), back()],
  };
}

// ------------------------------------------------------------- entries ----
export async function panel(ctx: Ctx) {
  if (!ctx.isPrivate) return false;
  const r = await role(ctx);
  if (!r) return false; // regular players: the command does not exist
  await clearState(ctx);
  await call(ctx, "admin_session_start").catch(() => {});
  await send(ctx.chat.id, home(r).text, home(r).kb);
  return true;
}

async function findPlayer(ctx: Ctx, q: string) {
  const list: any[] = await call(ctx, "admin_search_players", { p_query: q, p_limit: 5, p_offset: 0 });
  return list.find((p) => p.game_name.toLowerCase() === q.toLowerCase() || p.login === q.toLowerCase() || String(p.public_id) === q) ?? (list.length === 1 ? list[0] : null);
}

/** Quick text commands for admins (the panel covers the same and more). */
export async function command(ctx: Ctx, c: ChatCommand): Promise<boolean> {
  if (!ctx.isPrivate) return false;
  const r = await role(ctx);
  if (!r) return false;
  const a = c.args;
  try {
    switch (c.cmd) {
      case "admin": return await panel(ctx);
      case "a_stats": await show(ctx, await stats(ctx)); return true;
      case "a_player": {
        const p = c.rest ? await findPlayer(ctx, c.rest) : null;
        await show(ctx, p ? await card(ctx, p.id, r) : await players(ctx, 0, c.rest));
        return true;
      }
      case "a_give": case "a_take": {
        const idx = a.findIndex((w, i) => i > 0 && parseAmount(w) && !parseAmount(w)!.all);
        if (idx < 1) return await reply(ctx, "«выдать Ник 10к причина выдачи»"), true;
        const p = await findPlayer(ctx, a.slice(0, idx).join(" "));
        if (!p) return await reply(ctx, "Игрок не найден."), true;
        const amt = (parseAmount(a[idx]) as { value: number }).value * (c.cmd === "a_take" ? -1 : 1);
        const reason = a.slice(idx + 1).join(" ");
        await confirm(ctx, { op: "adjust", uid: p.id, name: p.game_name, account: "cash", amount: amt, reason },
          `${amt > 0 ? "Выдать" : "Отнять"} <b>${money(Math.abs(amt))}</b> (наличные) игроку <b>${esc(p.game_name)}</b>?\nПричина: ${esc(reason || "—")}`);
        return true;
      }
      case "a_ban": case "a_unban": {
        const p = await findPlayer(ctx, c.cmd === "a_unban" ? c.rest : a[0] ?? "");
        if (!p) return await reply(ctx, "Игрок не найден."), true;
        const status = c.cmd === "a_ban" ? "blocked" : "active";
        await confirm(ctx, { op: "status", uid: p.id, name: p.game_name, status, reason: a.slice(1).join(" ") || (status === "blocked" ? "Блокировка из бота" : "Разблокировка из бота") },
          `${status === "blocked" ? "Заблокировать" : "Разблокировать"} <b>${esc(p.game_name)}</b>?`);
        return true;
      }
      case "vip": {
        if (a.length < 3) return false; // plain "вип" is the player's own VIP status
        const p = await findPlayer(ctx, a.slice(0, -2).join(" "));
        if (!p) return await reply(ctx, "Игрок не найден."), true;
        await call(ctx, "admin_grant_vip", { p_target: p.id, p_level: Number(a[a.length - 2]), p_days: Number(a[a.length - 1]), p_reason: "VIP из бота" });
        await reply(ctx, `👑 ${esc(p.game_name)}: VIP ${a[a.length - 2]} на ${a[a.length - 1]} дн.`);
        return true;
      }
      case "promo": {
        if ((a[0] ?? "").toLowerCase() !== "создать") return false; // "промо КОД" redeems for everyone
        await promoCreate(ctx, a.slice(1).join(" "));
        return true;
      }
      case "play": {
        const on = (a[0] ?? "").toLowerCase();
        if (!["вкл", "выкл"].includes(on) || !a[1]) return false;
        await toggleGame(ctx, a[1].toLowerCase(), on === "вкл");
        await reply(ctx, `🎮 ${a[1]}: ${on === "вкл" ? "включена" : "выключена"}.`);
        return true;
      }
      case "a_broadcast":
        await confirm(ctx, { op: "broadcast", text: c.rest }, `Разослать всем игрокам (в игре и в Telegram):\n\n${esc(c.rest)}`);
        return true;
    }
  } catch (e) {
    await reply(ctx, `⚠️ ${errorText(e)}`);
    return true;
  }
  return false;
}

async function toggleGame(ctx: Ctx, game: string, on: boolean) {
  const { data } = await admin().from("game_settings").select("min_bet, max_bet").eq("game", game).maybeSingle();
  if (!data) throw new Error("not_found");
  await call(ctx, "admin_set_game", { p_game: game, p_enabled: on, p_min: n(data.min_bet), p_max: n(data.max_bet) });
}

/** "КОД 50к 100 [дней]" → promo. */
async function promoCreate(ctx: Ctx, text: string, messageId?: number) {
  const [code, sum, uses, days] = text.trim().split(/\s+/);
  const usd = parseAmount(sum);
  if (!code || !usd || usd.all) return show(ctx, { text: "Формат: <code>КОД 50к 100 7</code> — код, сумма, число активаций, дней действия (необязательно).", kb: [back("pr")] }, messageId);
  await call(ctx, "admin_create_promo", {
    p_code: code.toUpperCase(), p_usd: usd.value, p_btc: 0, p_max_uses: Number(uses ?? 100), p_starts: null,
    p_expires: days ? new Date(Date.now() + Number(days) * 86_400_000).toISOString() : null,
  });
  await show(ctx, { text: `🎟 Промокод <code>${esc(code.toUpperCase())}</code>: ${money(usd.value)}, активаций ${Number(uses ?? 100)}${days ? `, ${days} дн.` : ""}.`, kb: [back("pr")] }, messageId);
}

/** A private message while a wizard step is open. Returns true if it was consumed. */
export async function onInput(ctx: Ctx, text: string, st: { kind: string; data: any }): Promise<boolean> {
  const r = await role(ctx);
  if (!r) {
    await clearState(ctx);
    return false;
  }
  if (/^(отмена|cancel|\/cancel)$/i.test(text.trim())) {
    await clearState(ctx);
    await send(ctx.chat.id, "Отменено.", home(r).kb);
    return true;
  }
  const d = st.data ?? {};
  try {
    switch (st.kind) {
      case "search": {
        await clearState(ctx);
        const p = await findPlayer(ctx, text.trim());
        await show(ctx, p ? await card(ctx, p.id, r) : await players(ctx, 0, text.trim()));
        return true;
      }
      case "adjust": {
        const [amt, ...rest] = text.trim().split(/\s+/);
        const reason = rest.join(" ");
        const v = d.account === "btc" ? Number(amt.replace(",", ".")) : (parseAmount(amt.replace(/^[-+]/, "")) as any)?.value;
        if (!v || reason.length < 5) return await send(ctx.chat.id, "Нужно: сумма и причина от 5 символов, например <code>10к компенсация за баг</code>.\nДля списания поставьте минус: <code>-10к штраф</code>."), true;
        const sign = amt.startsWith("-") || d.sign === -1 ? -1 : 1;
        const amount = v * sign;
        const label = d.account === "btc" ? `${Math.abs(amount)} BTC` : money(Math.abs(amount));
        await confirm(ctx, { op: "adjust", uid: d.uid, name: d.name, account: d.account, amount, reason },
          `${amount > 0 ? "Начислить" : "Списать"} <b>${label}</b> (${{ cash: "наличные", bank: "банк", btc: "BTC" }[d.account as "cash"]}) игроку <b>${esc(d.name)}</b>?\nПричина: ${esc(reason)}`);
        return true;
      }
      case "setting": {
        const v = Number(text.trim().replace(",", "."));
        if (!Number.isFinite(v) || v < 0) return await send(ctx.chat.id, "Нужно неотрицательное число."), true;
        await clearState(ctx);
        await call(ctx, "admin_set_economy_setting", { p_key: d.key, p_value: v });
        await send(ctx.chat.id, `✅ <code>${esc(d.key)}</code> = ${v}`, [back("eco")]);
        return true;
      }
      case "game_limits": {
        const [mn, mx] = text.trim().split(/\s+/).map((x) => (parseAmount(x) as any)?.value);
        if (!mn || !mx || mn > mx) return await send(ctx.chat.id, "Нужно два числа: минимум и максимум, например <code>100 1кк</code>."), true;
        await clearState(ctx);
        const { data } = await admin().from("game_settings").select("enabled").eq("game", d.game).maybeSingle();
        await call(ctx, "admin_set_game", { p_game: d.game, p_enabled: data?.enabled ?? true, p_min: mn, p_max: mx });
        await send(ctx.chat.id, `✅ ${d.game}: ставка ${money(mn)} – ${money(mx)}`, [back("gm")]);
        return true;
      }
      case "job": {
        const [mn, mx, cd] = text.trim().split(/\s+/);
        const imin = (parseAmount(mn) as any)?.value, imax = (parseAmount(mx) as any)?.value, cool = Number(cd);
        if (!imin || !imax || imin > imax || !(cool > 0)) return await send(ctx.chat.id, "Нужно: мин. оплата, макс. оплата, перерыв в минутах — <code>20к 50к 30</code>."), true;
        await clearState(ctx);
        const job = ((await call<any[]>(ctx, "admin_list_jobs")) ?? []).find((j) => j.key === d.key);
        await call(ctx, "admin_set_job", { p_key: d.key, p_income_min: imin, p_income_max: imax, p_cooldown: Math.round(cool * 60), p_min_capital: n(job?.min_capital), p_xp: n(job?.xp_reward), p_active: job?.is_active ?? true });
        await send(ctx.chat.id, `✅ ${d.key}: ${money(imin)}–${money(imax)}, перерыв ${cool} мин.`, [back("jb")]);
        return true;
      }
      case "promo": {
        await clearState(ctx);
        await promoCreate(ctx, text);
        return true;
      }
      case "event": {
        const parts = text.split("|").map((x) => x.trim());
        const [title, mult, type, hours] = parts;
        if (parts.length < 4 || !["daily", "mining"].includes(type)) return await send(ctx.chat.id, "Формат: <code>Название | 2 | daily | 24</code> (тип: daily или mining, длительность в часах)."), true;
        await clearState(ctx);
        const code = `ev_${Date.now().toString(36)}`;
        await call(ctx, "admin_create_event", { p_code: code, p_title: title, p_description: title, p_type: type, p_multiplier: Number(mult.replace(",", ".")),
          p_starts: new Date().toISOString(), p_ends: new Date(Date.now() + Number(hours) * 3_600_000).toISOString() });
        await send(ctx.chat.id, `🎉 Событие «${esc(title)}» ×${mult} на ${hours} ч запущено.`, [back("ev")]);
        return true;
      }
      case "broadcast": {
        if (text.trim().length < 5) return await send(ctx.chat.id, "Текст от 5 символов."), true;
        await confirm(ctx, { op: "broadcast", text: text.trim() }, `Разослать всем игрокам (в игре и в Telegram)?\n\n${esc(text.trim())}`);
        return true;
      }
      case "news": {
        const [title, ...body] = text.trim().split("\n");
        if (!title || !body.join("\n").trim()) return await send(ctx.chat.id, "Первая строка — заголовок, дальше — текст новости."), true;
        await confirm(ctx, { op: "news", title: title.trim(), body: body.join("\n").trim() }, `Опубликовать новость с уведомлением всем?\n\n<b>${esc(title)}</b>\n${esc(body.join("\n"))}`);
        return true;
      }
      case "message": {
        await confirm(ctx, { op: "message", uid: d.uid, name: d.name, text: text.trim() }, `Отправить игроку <b>${esc(d.name)}</b>:\n\n${esc(text.trim())}`);
        return true;
      }
      case "chat_message": {
        await confirm(ctx, { op: "chat_message", chat: d.chat, text: text.trim() }, `Отправить в чат <code>${d.chat}</code>:\n\n${esc(text.trim())}`);
        return true;
      }
      case "confirm":
        // Waiting for a button: ordinary commands still work meanwhile.
        return false;
      default:
        await clearState(ctx);
        return false;
    }
  } catch (e) {
    await send(ctx.chat.id, `⚠️ ${errorText(e)}`);
    return true;
  }
}

/** Runs the confirmed action. */
async function runConfirmed(ctx: Ctx, d: any, messageId: number): Promise<string> {
  await clearState(ctx);
  switch (d.op) {
    case "adjust": {
      const res = await call(ctx, "admin_adjust_balance", { p_target_user: d.uid, p_account: d.account, p_amount: d.amount, p_reason: d.reason, p_idempotency_key: d.key });
      const r = (await role(ctx))!;
      await show(ctx, await card(ctx, d.uid, r), messageId);
      return res.status === "duplicate" ? "Уже выполнено" : `Готово: было ${n(res.before)}, стало ${n(res.after)}`;
    }
    case "status": {
      await call(ctx, "admin_set_status", { p_user: d.uid, p_status: d.status, p_reason: d.reason });
      await show(ctx, await card(ctx, d.uid, (await role(ctx))!), messageId);
      return "Статус изменён";
    }
    case "role": {
      await call(ctx, "admin_set_role", { p_user: d.uid, p_role: d.role });
      await show(ctx, await card(ctx, d.uid, (await role(ctx))!), messageId);
      return "Роль изменена";
    }
    case "vip_revoke": {
      await call(ctx, "admin_revoke_vip", { p_user: d.uid, p_reason: "Снят из Telegram-бота" });
      await show(ctx, await card(ctx, d.uid, (await role(ctx))!), messageId);
      return "VIP снят";
    }
    case "media": {
      for (const what of ["avatar", "background"]) {
        await call(ctx, "admin_clear_profile_media", { p_user: d.uid, p_what: what, p_reason: "Сброс из Telegram-бота" });
      }
      await show(ctx, await card(ctx, d.uid, (await role(ctx))!), messageId);
      return "Аватар и фон сброшены";
    }
    case "broadcast": {
      await call(ctx, "admin_broadcast", { p_title: "BAYHAN GAME", p_body: String(d.text).slice(0, 1000), p_link: null, p_target_user: null });
      const ids = await rpc<number[]>("tg_broadcast_targets", { p_admin_tg: ctx.from.id });
      await edit(ctx.chat.id, messageId, `📢 Уведомление в игре отправлено. Рассылаю в Telegram: ${ids.length} чел.…`);
      // Telegram allows about 30 messages a second: send in the background at a safe pace.
      waitUntil((async () => {
        let ok = 0;
        for (const id of ids) {
          const r = await tg("sendMessage", { chat_id: id, text: `📢 <b>BAYHAN GAME</b>\n\n${esc(d.text)}`, parse_mode: "HTML" });
          if (r?.ok) ok++;
          await new Promise((res) => setTimeout(res, 40));
        }
        await send(ctx.chat.id, `📢 Рассылка завершена: доставлено ${ok} из ${ids.length}.`, [back()]);
      })());
      return "Рассылка запущена";
    }
    case "news": {
      await call(ctx, "admin_publish_news", { p_title: d.title, p_body: d.body, p_image_path: null, p_pinned: false, p_notify: true });
      await show(ctx, await newsScreen(ctx), messageId);
      return "Новость опубликована";
    }
    case "message": {
      await call(ctx, "admin_broadcast", { p_title: "Сообщение администрации", p_body: String(d.text).slice(0, 1000), p_link: null, p_target_user: d.uid });
      const { data: t } = await admin().from("telegram_accounts").select("telegram_id").eq("user_id", d.uid).maybeSingle();
      const sent = t ? await tg("sendMessage", { chat_id: t.telegram_id, text: `✉️ <b>Сообщение администрации BAYHAN GAME</b>\n\n${esc(d.text)}`, parse_mode: "HTML" }) : null;
      await show(ctx, await card(ctx, d.uid, (await role(ctx))!), messageId);
      return sent?.ok ? "Отправлено в игру и в Telegram" : "Отправлено уведомлением в игре";
    }
    case "chat_message": {
      const r = await tg("sendMessage", { chat_id: d.chat, text: `📢 ${esc(d.text)}`, parse_mode: "HTML" });
      await show(ctx, await chatCard(Number(d.chat)), messageId);
      return r?.ok ? "Отправлено" : "Telegram не принял сообщение";
    }
    case "leave_chat": {
      await tg("leaveChat", { chat_id: d.chat });
      await rpc("tg_chat_left", { p_chat: d.chat });
      await show(ctx, await chatsScreen(0), messageId);
      return "Бот вышел из чата";
    }
  }
  return "Неизвестное действие";
}

/** Panel buttons: ad:<op>[:<a>[:<b>[:<c>]]]. Returns the alert text, if any. */
export async function button(ctx: Ctx, data: string, messageId: number): Promise<string | null> {
  const r = await role(ctx);
  if (!r) return "Недостаточно прав.";
  if (!ctx.isPrivate) return "Админ-панель работает только в личке бота.";
  const [, op, a = "", b2 = "", c3 = ""] = data.split(":");
  const editor = CAN_EDIT.has(r);
  const needEdit = () => {
    if (!editor) throw new Error("forbidden");
  };
  try {
    switch (op) {
      case "home": await clearState(ctx); await show(ctx, home(r), messageId); return null;
      case "stats": await show(ctx, await stats(ctx), messageId); return null;
      case "pl": await show(ctx, await players(ctx, Number(a) || 0), messageId); return null;
      case "ps": await ask(ctx, "search", {}, "Пришлите ник, логин или ID игрока.", messageId); return null;
      case "p": await show(ctx, await card(ctx, a, r), messageId); return null;
      case "lg": await show(ctx, await ledger(ctx, a), messageId); return null;
      case "pd": await show(ctx, await playerAudit(ctx, a), messageId); return null;
      case "pa": {
        needEdit();
        const p = await playerRow(ctx, a);
        const account = b2 === "bank" ? "bank" : b2 === "btc" ? "btc" : "cash";
        const sign = b2 === "take" ? -1 : 1;
        await ask(ctx, "adjust", { uid: a, name: p?.game_name, account, sign },
          `${b2 === "give" ? "Выдать наличные" : b2 === "take" ? "Отнять наличные" : account === "bank" ? "Изменить банк" : "Изменить BTC"} — <b>${esc(p?.game_name)}</b>.\n` +
          `Пришлите сумму и причину: <code>10к компенсация за баг</code>${b2 === "bank" || b2 === "btc" ? " (для списания — минус: <code>-10к штраф</code>)" : ""}.`, messageId);
        return null;
      }
      case "st": {
        const p = await playerRow(ctx, a);
        await confirm(ctx, { op: "status", uid: a, name: p?.game_name, status: b2, reason: `Статус «${b2}» из Telegram-бота` },
          `Сделать статус <b>${STATUS[b2] ?? b2}</b> для <b>${esc(p?.game_name)}</b>?`, messageId);
        return null;
      }
      case "vp": needEdit(); await show(ctx, { text: "👑 Уровень VIP:", kb: [[1, 2, 3, 4].map((l) => b(`VIP ${l}`, `ad:vl:${a}:${l}`)), back(`p:${a}`)] }, messageId); return null;
      case "vl": needEdit(); await show(ctx, { text: `👑 VIP ${b2} — срок:`, kb: [[7, 30, 90, 365].map((d) => b(`${d} дн.`, `ad:vd:${a}:${b2}:${d}`)), back(`p:${a}`)] }, messageId); return null;
      case "vd": {
        needEdit();
        await call(ctx, "admin_grant_vip", { p_target: a, p_level: Number(b2), p_days: Number(c3), p_reason: "VIP из Telegram-бота" });
        await show(ctx, await card(ctx, a, r), messageId);
        return `VIP ${b2} на ${c3} дн. выдан`;
      }
      case "vr": needEdit(); await confirm(ctx, { op: "vip_revoke", uid: a }, "Снять VIP с игрока?", messageId); return null;
      case "pi": await confirm(ctx, { op: "media", uid: a }, "Сбросить аватар и фон профиля игрока?", messageId); return null;
      case "pm": {
        const p = await playerRow(ctx, a);
        await ask(ctx, "message", { uid: a, name: p?.game_name }, `Текст сообщения для <b>${esc(p?.game_name)}</b> (придёт уведомлением в игре и в Telegram, если привязан):`, messageId);
        return null;
      }
      case "pr2": {
        if (r !== "owner") throw new Error("forbidden");
        await show(ctx, { text: "🛡 Роль игрока:", kb: [[b("Администратор", `ad:rs:${a}:admin`), b("Модератор", `ad:rs:${a}:moderator`)], [b("Оператор", `ad:rs:${a}:operator`), b("Без роли", `ad:rs:${a}:none`)], back(`p:${a}`)] }, messageId);
        return null;
      }
      case "rs": await confirm(ctx, { op: "role", uid: a, role: b2 === "none" ? null : b2 }, `Назначить роль: <b>${b2 === "none" ? "без роли" : ROLE[b2]}</b>?`, messageId); return null;
      case "eco": await show(ctx, await economy(ctx), messageId); return null;
      case "es": needEdit(); await ask(ctx, "setting", { key: a }, `Новое значение для <code>${esc(a)}</code>:`, messageId); return null;
      case "gm": await show(ctx, await gamesScreen(), messageId); return null;
      case "gt": {
        needEdit();
        const { data: g } = await admin().from("game_settings").select("enabled").eq("game", a).maybeSingle();
        await toggleGame(ctx, a, !g?.enabled);
        await show(ctx, await gamesScreen(), messageId);
        return `${a}: ${g?.enabled ? "выключена" : "включена"}`;
      }
      case "gl": needEdit(); await ask(ctx, "game_limits", { game: a }, `Лимиты ставки для <b>${a}</b>: минимум и максимум, например <code>100 1кк</code>.`, messageId); return null;
      case "jb": await show(ctx, await jobsScreen(ctx), messageId); return null;
      case "jt": {
        needEdit();
        const job = ((await call<any[]>(ctx, "admin_list_jobs")) ?? []).find((j) => j.key === a);
        if (!job) return "Нет такой работы";
        await call(ctx, "admin_set_job", { p_key: a, p_income_min: n(job.income_min), p_income_max: n(job.income_max), p_cooldown: job.cooldown_seconds, p_min_capital: n(job.min_capital), p_xp: job.xp_reward, p_active: !job.is_active });
        await show(ctx, await jobsScreen(ctx), messageId);
        return `${a}: ${job.is_active ? "выключена" : "включена"}`;
      }
      case "je": needEdit(); await ask(ctx, "job", { key: a }, `Оплата работы <b>${a}</b>: мин, макс, перерыв в минутах — <code>20к 50к 30</code>.`, messageId); return null;
      case "pr": await show(ctx, await promosScreen(ctx), messageId); return null;
      case "pc": needEdit(); await ask(ctx, "promo", {}, "Новый промокод: <code>КОД 50к 100 7</code> — код, сумма, число активаций, дней действия (необязательно).", messageId); return null;
      case "pt": needEdit(); await call(ctx, "admin_set_promo_active", { p_code: a, p_active: b2 === "1" }); await show(ctx, await promosScreen(ctx), messageId); return b2 === "1" ? "Включён" : "Выключен";
      case "pu": {
        const list: any[] = await call(ctx, "admin_promo_redemptions", { p_code: a });
        await show(ctx, { text: `🎟 <code>${esc(a)}</code> активировали (${list.length}):\n\n${list.slice(0, 30).map((x) => `• ${esc(x.game_name)} · ${date(x.created_at)}`).join("\n") || "Никто."}`, kb: [back("pr")] }, messageId);
        return null;
      }
      case "ev": await show(ctx, await eventsScreen(ctx), messageId); return null;
      case "ec": needEdit(); await ask(ctx, "event", {}, "Новое событие: <code>Двойной бонус | 2 | daily | 24</code> — название, множитель (до 10), тип daily или mining, часов.", messageId); return null;
      case "et": needEdit(); await call(ctx, "admin_set_event_active", { p_code: a, p_active: b2 === "1" }); await show(ctx, await eventsScreen(ctx), messageId); return b2 === "1" ? "Включено" : "Выключено";
      case "vip": await show(ctx, await vipScreen(ctx), messageId); return null;
      case "bc": needEdit(); await ask(ctx, "broadcast", {}, "Текст рассылки всем игрокам (уведомление в игре + сообщение в Telegram):", messageId); return null;
      case "nw": await show(ctx, await newsScreen(ctx), messageId); return null;
      case "nc": needEdit(); await ask(ctx, "news", {}, "Новость: первая строка — заголовок, дальше — текст.", messageId); return null;
      case "nh": {
        needEdit();
        const list: any[] = (await call(ctx, "admin_list_news", { p_limit: 20 })) ?? [];
        const x = list.find((y) => String(y.id) === a);
        if (!x) return "Новость не найдена";
        await call(ctx, "admin_update_news", { p_id: Number(a), p_title: x.title, p_body: x.body, p_pinned: x.pinned, p_hidden: b2 === "1" });
        await show(ctx, await newsScreen(ctx), messageId);
        return b2 === "1" ? "Скрыта" : "Показана";
      }
      case "nd": needEdit(); await call(ctx, "admin_delete_news", { p_id: Number(a) }); await show(ctx, await newsScreen(ctx), messageId); return "Удалена";
      case "ch": await show(ctx, await chatsScreen(Number(a) || 0), messageId); return null;
      case "cc": await show(ctx, await chatCard(Number(a)), messageId); return null;
      case "cs": needEdit(); await rpc("tg_chat_set", { p_chat: Number(a), p_key: b2, p_value: c3 === "1" }); await show(ctx, await chatCard(Number(a)), messageId); return "Сохранено";
      case "cm": needEdit(); await ask(ctx, "chat_message", { chat: Number(a) }, "Текст сообщения в этот чат:", messageId); return null;
      case "cl": needEdit(); await confirm(ctx, { op: "leave_chat", chat: Number(a) }, "Бот выйдет из этого чата. Продолжить?", messageId); return null;
      case "au": await show(ctx, await auditScreen(ctx, Number(a) || 0), messageId); return null;
      case "bt": await show(ctx, await transfersScreen(ctx), messageId); return null;
      case "rl": await show(ctx, await rolesScreen(), messageId); return null;
      case "ok": {
        const st = await getState(ctx);
        if (st?.kind !== "confirm") return "Нечего подтверждать (прошло больше 10 минут?)";
        if (["adjust", "broadcast", "news", "vip_revoke", "leave_chat", "chat_message"].includes(st.data.op)) needEdit();
        return await runConfirmed(ctx, st.data, messageId);
      }
      case "no": await clearState(ctx); await show(ctx, home(r), messageId); return "Отменено";
    }
  } catch (e) {
    return errorText(e);
  }
  return null;
}
