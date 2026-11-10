// Admin panel inside the bot (private chat only). Every action calls the same admin_* RPC as the
// web admin panel, as the admin's own account: the role check and the audit log happen on the server.
import { parseAmount, type ChatCommand } from "../_shared/bot-commands.ts";
import { admin, rpc, SITE_URL, tg } from "../_shared/telegram.ts";
import { type Buttons, call, type Ctx, edit, errorText, esc, key, money, n, reply } from "./ctx.ts";
import { waitUntil } from "./games.ts";

const ROLE: Record<string, string> = { owner: "Владелец", admin: "Администратор", moderator: "Модератор", operator: "Оператор" };

async function role(ctx: Ctx): Promise<string | null> {
  try {
    const me = await call(ctx, "admin_me");
    return me?.role ?? null;
  } catch {
    return null;
  }
}

const MENU: Buttons = [
  [{ text: "📊 Статистика", callback_data: "ad:stats" }, { text: "🎮 Игры", callback_data: "ad:games" }],
  [{ text: "🎟 Промокоды", callback_data: "ad:promos" }, { text: "❓ Команды", callback_data: "ad:help" }],
  [{ text: "🌐 Веб-админка", url: `${SITE_URL}/admin` }],
];

const HELP =
  `🛡 <b>Команды админа</b> (только в личке бота)\n\n` +
  `«игрок Ник» — карточка игрока с кнопками\n«выдать Ник 10к причина» · «отнять Ник 10к причина»\n` +
  `«бан Ник причина» · «разбан Ник»\n«вип Ник 2 30» — VIP 2 на 30 дней\n` +
  `«промо создать КОД 50к 100» — сумма и лимит активаций\n«игра выкл slots» · «игра вкл slots»\n` +
  `«рассылка текст» — уведомление в игре и сообщение всем в Telegram\n«статистика»\n\nПричина обязательна (от 5 символов): она попадает в журнал аудита.`;

export async function panel(ctx: Ctx) {
  if (!ctx.isPrivate) return false;
  const r = await role(ctx);
  if (!r) return false; // regular players: the command does not exist
  await call(ctx, "admin_session_start").catch(() => {});
  await reply(ctx, `🛡 <b>Админ-панель</b> · ${ROLE[r] ?? r}`, MENU);
  return true;
}

async function findPlayer(ctx: Ctx, q: string) {
  const list: any[] = await call(ctx, "admin_search_players", { p_query: q, p_limit: 5, p_offset: 0 });
  return list.find((p) => p.game_name.toLowerCase() === q.toLowerCase() || p.login === q.toLowerCase()) ?? (list.length === 1 ? list[0] : null);
}

async function card(ctx: Ctx, p: any, messageId?: number) {
  const full = await call(ctx, "admin_player", { p_user: p.id });
  const text = `👤 <b>${esc(p.game_name)}</b> · ID ${p.public_id} · ${esc(p.login)}\nСтатус: ${p.status}${full?.role ? ` · роль ${ROLE[full.role] ?? full.role}` : ""}\n` +
    `💵 ${money(p.cash)} · 🏦 ${money(p.bank)} · ₿ ${n(p.btc)}\n💼 Капитал: ${money(p.capital)} · ур. ${p.level}\n` +
    `VIP: ${full?.vip?.active ? full.vip.level : "нет"}\nВ игре с ${new Date(p.created_at).toLocaleDateString("ru-RU")}`;
  const kb: Buttons = [
    [{ text: p.status === "active" ? "🚫 Заблокировать" : "✅ Разблокировать", callback_data: `ad:st:${p.id}:${p.status === "active" ? "blocked" : "active"}` },
      { text: "⚠️ Ограничить", callback_data: `ad:st:${p.id}:restricted` }],
    [{ text: "🔄 Обновить", callback_data: `ad:pl:${p.id}` }],
  ];
  return messageId ? edit(ctx.chat.id, messageId, text, kb) : reply(ctx, text, kb);
}

/** Admin text commands. Returns true if handled. */
export async function command(ctx: Ctx, c: ChatCommand): Promise<boolean> {
  if (!ctx.isPrivate) return false;
  const r = await role(ctx);
  if (!r) return false;
  const a = c.args;
  try {
    switch (c.cmd) {
      case "a_stats": return await stats(ctx), true;
      case "a_player": {
        const p = await findPlayer(ctx, c.rest);
        if (!p) await reply(ctx, "Игрок не найден.");
        else await card(ctx, p);
        return true;
      }
      case "a_give": case "a_take": {
        // "выдать Ник 10к причина ..." — the amount is the first word that parses as one.
        const idx = a.findIndex((w, i) => i > 0 && parseAmount(w) && !parseAmount(w)!.all);
        if (idx < 1) return await reply(ctx, "«выдать Ник 10к причина выдачи»"), true;
        const p = await findPlayer(ctx, a.slice(0, idx).join(" "));
        if (!p) return await reply(ctx, "Игрок не найден."), true;
        const amt = (parseAmount(a[idx]) as { value: number }).value * (c.cmd === "a_take" ? -1 : 1);
        const reason = a.slice(idx + 1).join(" ");
        const res = await call(ctx, "admin_adjust_balance", { p_target_user: p.id, p_account: "cash", p_amount: amt, p_reason: reason, p_idempotency_key: key(ctx) });
        await reply(ctx, res.status === "duplicate" ? "Уже выполнено." : `✅ ${esc(p.game_name)}: ${amt > 0 ? "+" : ""}${money(amt)}. Баланс: ${money(res.after)}.`);
        return true;
      }
      case "a_ban": case "a_unban": {
        const p = await findPlayer(ctx, c.cmd === "a_unban" ? c.rest : a[0] ?? "");
        if (!p) return await reply(ctx, "Игрок не найден."), true;
        const reason = c.cmd === "a_unban" ? "Разблокировка из бота" : a.slice(1).join(" ") || "Блокировка из бота";
        await call(ctx, "admin_set_status", { p_user: p.id, p_status: c.cmd === "a_ban" ? "blocked" : "active", p_reason: reason });
        await reply(ctx, `${c.cmd === "a_ban" ? "🚫 Заблокирован" : "✅ Разблокирован"}: ${esc(p.game_name)}.`);
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
        const usd = parseAmount(a[2]);
        if (!a[1] || !usd || usd.all) return await reply(ctx, "«промо создать КОД 50к 100»"), true;
        await call(ctx, "admin_create_promo", { p_code: a[1].toUpperCase(), p_usd: usd.value, p_btc: 0, p_max_uses: Number(a[3] ?? 100), p_starts: null, p_expires: null });
        await reply(ctx, `🎟 Промокод <code>${esc(a[1].toUpperCase())}</code>: ${money(usd.value)}, активаций: ${Number(a[3] ?? 100)}.`);
        return true;
      }
      case "play": {
        // "игра выкл slots"
        const on = (a[0] ?? "").toLowerCase();
        if (!["вкл", "выкл"].includes(on) || !a[1]) return false;
        const g = a[1].toLowerCase();
        const { data } = await admin().from("game_settings").select("min_bet, max_bet").eq("game", g).maybeSingle();
        if (!data) return await reply(ctx, "Нет такой игры. Игры: casino, spin, slots, dice, basketball, darts, bowling, updown, trade, crash, mines."), true;
        await call(ctx, "admin_set_game", { p_game: g, p_enabled: on === "вкл", p_min: n(data.min_bet), p_max: n(data.max_bet) });
        await reply(ctx, `🎮 ${g}: ${on === "вкл" ? "включена" : "выключена"}.`);
        return true;
      }
      case "a_broadcast": return await broadcast(ctx, c.rest), true;
      case "admin": return await panel(ctx);
    }
  } catch (e) {
    await reply(ctx, `⚠️ ${errorText(e)}`);
    return true;
  }
  return false;
}

async function stats(ctx: Ctx, messageId?: number) {
  const d = await call(ctx, "admin_dashboard");
  const text = `📊 <b>Статистика</b>\n\nИгроков: ${d.players_total} (за сутки +${d.players_new_24h}, за неделю +${d.players_new_7d})\n` +
    `Активны за сутки: ${d.players_active_24h} · заблокировано: ${d.players_blocked}\n\nДеньги: 💵 ${money(d.money_cash)} · 🏦 ${money(d.money_bank)} · вклады ${money(d.money_deposits)}\n\n` +
    `За 24 ч: раундов ${d.rounds_24h}, ставки ${money(d.bets_24h)}, выплаты ${money(d.payouts_24h)}\nСмен ${d.shifts_24h} · переводов ${d.transfers_count_24h} на ${money(d.transfers_24h)}`;
  return messageId ? edit(ctx.chat.id, messageId, text, MENU) : reply(ctx, text, MENU);
}

async function broadcast(ctx: Ctx, text: string) {
  if (text.trim().length < 5) return reply(ctx, "«рассылка текст сообщения» (от 5 символов).");
  // 1) the in-game notification (same as the web admin's broadcast), 2) a Telegram message.
  await call(ctx, "admin_broadcast", { p_title: "BAYHAN GAME", p_body: text.slice(0, 1000), p_link: null, p_target_user: null });
  const ids = await rpc<number[]>("tg_broadcast_targets", { p_admin_tg: ctx.from.id });
  await reply(ctx, `📢 Уведомление в игре отправлено. Рассылаю в Telegram: ${ids.length} чел.…`);
  // Telegram allows ~30 messages per second: send in the background at a safe pace.
  waitUntil((async () => {
    let ok = 0;
    for (const id of ids) {
      const r = await tg("sendMessage", { chat_id: id, text: `📢 <b>BAYHAN GAME</b>\n\n${esc(text)}`, parse_mode: "HTML" });
      if (r?.ok) ok++;
      await new Promise((res) => setTimeout(res, 50));
    }
    await reply(ctx, `📢 Рассылка завершена: доставлено ${ok} из ${ids.length}.`);
  })());
}

/** Admin panel buttons (ad:...). */
export async function button(ctx: Ctx, data: string, messageId: number): Promise<string | null> {
  if (!(await role(ctx))) return "Недостаточно прав.";
  const [, op, id, extra] = data.split(":");
  try {
    if (op === "stats") return await stats(ctx, messageId), null;
    if (op === "help") return await edit(ctx.chat.id, messageId, HELP, MENU), null;
    if (op === "games") {
      const { data: gs } = await admin().from("game_settings").select("game, enabled").order("game");
      await edit(ctx.chat.id, messageId, `🎮 <b>Игры</b>\n\n${(gs ?? []).map((g: any) => `${g.enabled ? "✅" : "⛔"} ${g.game}`).join("\n")}\n\nВключить/выключить: «игра выкл slots».`, MENU);
      return null;
    }
    if (op === "promos") {
      const ps: any[] = await call(ctx, "admin_list_promos");
      await edit(ctx.chat.id, messageId, `🎟 <b>Промокоды</b>\n\n${ps.slice(0, 15).map((p) => `${p.active ? "✅" : "⛔"} <code>${esc(p.code)}</code> — ${money(p.reward_usd)} · ${p.used_count}/${p.max_uses ?? "∞"}`).join("\n") || "Нет."}\n\nСоздать: «промо создать КОД 50к 100».`, MENU);
      return null;
    }
    if (op === "pl") {
      const list: any[] = await call(ctx, "admin_search_players", { p_query: id, p_limit: 1, p_offset: 0 });
      const p = list.find((x) => x.id === id);
      if (p) await card(ctx, p, messageId);
      return null;
    }
    if (op === "st") {
      await call(ctx, "admin_set_status", { p_user: id, p_status: extra, p_reason: "Изменено из Telegram-бота" });
      const list: any[] = await call(ctx, "admin_search_players", { p_query: id, p_limit: 1, p_offset: 0 });
      const p = list.find((x) => x.id === id);
      if (p) await card(ctx, p, messageId);
      return "Статус изменён";
    }
  } catch (e) {
    return errorText(e);
  }
  return null;
}

export { HELP as ADMIN_HELP };
